import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    // --- 1. Validate JWT and get user ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- RATE LIMIT: max 3 subscription attempts per 60 seconds ---
    const rateLimit = await checkRateLimit(user.id, {
      functionName: 'create-subscription',
      maxRequests: 3,
      windowSeconds: 60,
    })
    if (!rateLimit.allowed) {
      console.log(`Rate limited: user=${user.id} function=create-subscription`)
      return rateLimitResponse(rateLimit)
    }

    const userEmail = user.email
    if (!userEmail) {
      return new Response(JSON.stringify({ error: 'User email not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 2. Parse request body ---
    const { plan_id: planId, payer_email: overrideEmail, back_url: overrideBackUrl } = await req.json()
    if (!planId) {
      return new Response(JSON.stringify({ error: 'plan_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Allow overriding payer_email for testing (e.g. with MP test buyer email)
    const payerEmail = overrideEmail || userEmail

    // Use the back_url from the app (deep link) or fall back to placeholder
    const backUrl = overrideBackUrl || 'https://umpi.app/subscription/success'

    // --- 3. Check if user already has an active subscription ---
    const { data: existingSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existingSub) {
      return new Response(
        JSON.stringify({ error: 'User already has an active subscription' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // --- 4. Fetch the subscription plan ---
    const { data: plan, error: planError } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single()

    if (planError || !plan) {
      return new Response(JSON.stringify({ error: 'Plan not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 5. Generate external reference ---
    const externalReference = `sub_${user.id}_${planId}`

    // --- 6. POST to MercadoPago PreApproval API ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Calculate dates for auto_recurring (required by current MP API)
    const startDate = new Date().toISOString()
    const endDate = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString() // +2 years

    // Use a short UUID as idempotency key (MP max 64 chars)
    const idempotencyKey = crypto.randomUUID()

    const mpBody = {
      reason: `Umpi - ${plan.name}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        start_date: startDate,
        end_date: endDate,
        transaction_amount: Number(plan.price),
        currency_id: 'UYU',
      },
      payer_email: payerEmail,
      external_reference: externalReference,
      back_url: backUrl,
      notification_url: 'https://tvwtwnltgakbvgldiocb.supabase.co/functions/v1/mp-webhook',
    }

    console.error('MP request body:', JSON.stringify(mpBody, null, 2))
    console.error('MP idempotency key length:', idempotencyKey.length)

    const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(mpBody),
    })

    const mpData = await mpResponse.json()

    if (!mpResponse.ok) {
      console.error('MP API error full:', JSON.stringify({ status: mpResponse.status, body: mpData, headers: Object.fromEntries(mpResponse.headers.entries()) }, null, 2))
      return new Response(JSON.stringify({
        error: 'MercadoPago API error',
        details: mpData,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 7. Save subscription row in DB so sync-subscription can find it ---
    const { error: insertError } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan_id: planId,
        mp_preapproval_id: mpData.id,
        status: 'pending',
        started_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error('create-subscription: failed to insert subscription row:', insertError)
    }

    // --- 8. Return init_point, preapproval_id, and external_reference ---
    return new Response(
      JSON.stringify({
        init_point: mpData.init_point,
        preapproval_id: mpData.id,
        external_reference: externalReference,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('create-subscription error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
