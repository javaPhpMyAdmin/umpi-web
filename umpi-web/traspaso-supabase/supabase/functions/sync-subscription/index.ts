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

    // --- RATE LIMIT: max 5 sync attempts per 60 seconds ---
    const rateLimit = await checkRateLimit(user.id, {
      functionName: 'sync-subscription',
      maxRequests: 5,
      windowSeconds: 60,
    })
    if (!rateLimit.allowed) {
      console.log(`Rate limited: user=${user.id} function=sync-subscription`)
      return rateLimitResponse(rateLimit)
    }

    // --- 2. Find user's subscription with MP preapproval ID (any status) ---
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .not('mp_preapproval_id', 'is', null)
      .not('mp_preapproval_id', 'eq', '')
      .order('started_at', { ascending: false })

    if (subError || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        synced: false,
        reason: 'No active subscription found for this user',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const subscription = subscriptions[0]
    const preapprovalId = subscription.mp_preapproval_id

    if (!preapprovalId) {
      return new Response(JSON.stringify({
        ok: true,
        synced: false,
        reason: 'Subscription has no MP preapproval ID',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 3. Fetch preapproval from MP ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const mpResponse = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
        },
      },
    )

    if (!mpResponse.ok) {
      const mpError = await mpResponse.text()
      console.error('sync-subscription: MP API error:', mpError)
      return new Response(JSON.stringify({ error: 'Error al consultar MercadoPago' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const preapproval = await mpResponse.json()
    const mpStatus: string = preapproval.status

    // --- 4. Sync status to DB ---
    let dbStatusChanged = false

    if (mpStatus === 'authorized') {
      // Fetch plan to get slug
      const { data: plan } = await supabaseAdmin
        .from('subscription_plans')
        .select('slug, listing_priority')
        .eq('id', subscription.plan_id)
        .single()

      // Update subscription
      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'active',
          expires_at: preapproval.next_billing_date,
        })
        .eq('id', subscription.id)

      // Update profile
      if (plan?.slug) {
        await supabaseAdmin
          .from('profiles')
          .update({
            subscription_type: plan.slug,
            subscription_expires_at: preapproval.next_billing_date,
          })
          .eq('id', user.id)
      }

      // Feature listings
      const priority = plan?.listing_priority ?? 1
      await supabaseAdmin
        .from('listings')
        .update({ is_featured: true, listing_priority: priority })
        .eq('user_id', user.id)

      dbStatusChanged = true
    } else if (mpStatus === 'cancelled') {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', subscription.id)

      await supabaseAdmin
        .from('listings')
        .update({ is_featured: false, listing_priority: 0 })
        .eq('user_id', user.id)

      await supabaseAdmin
        .from('profiles')
        .update({ subscription_type: 'none', subscription_expires_at: null })
        .eq('id', user.id)

      dbStatusChanged = true
    } else if (mpStatus === 'expired') {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('id', subscription.id)

      await supabaseAdmin
        .from('listings')
        .update({ is_featured: false, listing_priority: 0 })
        .eq('user_id', user.id)

      await supabaseAdmin
        .from('profiles')
        .update({ subscription_type: 'none', subscription_expires_at: null })
        .eq('id', user.id)

      dbStatusChanged = true
    }

    console.log(`sync-subscription: user=${user.id} preapproval=${preapprovalId} mp_status=${mpStatus} synced=${dbStatusChanged}`)

    return new Response(JSON.stringify({
      ok: true,
      synced: dbStatusChanged,
      mp_status: mpStatus,
      preapproval_status: preapproval.status,
      next_billing_date: preapproval.next_billing_date,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('sync-subscription error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
