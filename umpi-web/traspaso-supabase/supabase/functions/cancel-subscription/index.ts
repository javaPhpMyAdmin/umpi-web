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

    // --- RATE LIMIT: max 3 cancel attempts per 60 seconds ---
    const rateLimit = await checkRateLimit(user.id, {
      functionName: 'cancel-subscription',
      maxRequests: 3,
      windowSeconds: 60,
    })
    if (!rateLimit.allowed) {
      console.log(`Rate limited: user=${user.id} function=cancel-subscription`)
      return rateLimitResponse(rateLimit)
    }

    // --- 2. Get user's active subscription ---
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .not('mp_preapproval_id', 'is', null)
      .not('mp_preapproval_id', 'eq', '')
      .order('started_at', { ascending: false })

    if (subError || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({
        error: 'No se encontró una suscripción activa',
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`cancel-subscription: found ${subscriptions.length} active subscription(s)`)
    subscriptions.forEach((s, i) => console.log(`  [${i}] id=${s.id} mp_preapproval_id=${s.mp_preapproval_id} plan_id=${s.plan_id} started_at=${s.started_at}`))

    const activeSub = subscriptions[0]

    // --- 3. Call MercadoPago API to cancel preapproval ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const preapprovalId = activeSub.mp_preapproval_id
    console.log(`cancel-subscription: attempting to cancel preapproval ${preapprovalId} for user ${user.id}`)
    if (!preapprovalId) {
      return new Response(JSON.stringify({ error: 'No se encontró el ID de preaprobación en MP' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      },
    )

    const mpResponseText = await mpResponse.text()
    console.log(`cancel-subscription: MP response ${mpResponse.status}: ${mpResponseText}`)

    if (!mpResponse.ok) {
      return new Response(JSON.stringify({
        error: `MercadoPago rechazó la cancelación (HTTP ${mpResponse.status})`,
        mp_status: mpResponse.status,
        mp_body: mpResponseText,
        preapproval_id: preapprovalId,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 4. Update local DB (only after successful MP cancellation) ---
    // Update subscription status to cancelled
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', activeSub.id)

    // Unfeature all user's listings
    await supabaseAdmin
      .from('listings')
      .update({ is_featured: false, listing_priority: 0 })
      .eq('user_id', user.id)

    // Reset profile subscription
    await supabaseAdmin
      .from('profiles')
      .update({ subscription_type: 'none', subscription_expires_at: null })
      .eq('id', user.id)

    console.log(`Subscription cancelled: user=${user.id} mp_id=${preapprovalId}`)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('cancel-subscription error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
