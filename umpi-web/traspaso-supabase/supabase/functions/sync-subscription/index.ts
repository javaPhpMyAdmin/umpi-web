import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import { selectLiveSubscription, fetchPreapproval, clearProfileSubscription } from '../_shared/subscription.ts'

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

    // --- 2. Deterministic row selection: the newest live row ---
    // Only the newest active|pending row is synced against MP (spec
    // "Deterministic row selection") — legacy duplicates are ignored and
    // reconciled by the migration. Shared helper so cancel-subscription
    // (PR 3) and the checkout guard pick the same row.
    const subscription = await selectLiveSubscription(supabaseAdmin, user.id)

    if (!subscription) {
      return new Response(JSON.stringify({
        ok: true,
        synced: false,
        reason: 'No active subscription found for this user',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const preapprovalId = subscription.mp_preapproval_id
    if (!preapprovalId) {
      // Unreachable in practice — selectLiveSubscription filters out rows
      // without an MP preapproval id. Kept as a defensive type guard.
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

    let preapproval: any
    try {
      preapproval = await fetchPreapproval(mpAccessToken, preapprovalId)
    } catch (mpError) {
      console.error('sync-subscription: MP API error:', mpError)
      return new Response(JSON.stringify({ error: 'Error al consultar MercadoPago' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const mpStatus: string = preapproval.status

    // --- 4. Sync status to DB ---
    let dbStatusChanged = false

    if (mpStatus === 'authorized') {
      // Fetch plan to get slug. If the plan cannot be resolved, fail: the
      // profile would stay 'trial' while the subscription is active — the
      // trial branch of feature_listing would win and the user would keep
      // trial benefits with the trial never consumed.
      const { data: plan, error: planError } = await supabaseAdmin
        .from('subscription_plans')
        .select('slug, listing_priority')
        .eq('id', subscription.plan_id)
        .single()

      if (planError || !plan?.slug) {
        console.error('Failed to resolve plan on sync:', planError ?? `plan ${subscription.plan_id} not found`)
        return new Response(
          JSON.stringify({ error: 'Plan not found for subscription' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // MP test mode returns next_billing_date: null (or ''). Anchor to the
      // subscription's existing expires_at so repeated user-invoked syncs in
      // TEST can't slide the expiry window forward (rate limit is 5/60s);
      // only a real MP event resets the period. Fall back to +30 days only
      // when there is no prior expiry. The "30 days" backup period must stay
      // aligned with subscription_plans.featured_duration_days (both plans
      // are 30 today).
      const nextBillingDate = preapproval.next_billing_date ||
        subscription.expires_at ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      // Update subscription
      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'active',
          expires_at: nextBillingDate,
        })
        .eq('id', subscription.id)

      // Update profile (plan resolved above — required, not optional)
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({
          subscription_type: plan.slug,
          subscription_expires_at: nextBillingDate,
          // W2: purchasing consumes the trial — a later cancel/expire
          // (subscription_type -> 'none') must NOT re-grant trial benefits.
          subscription_status: 'paid',
          trial_ends_at: null,
        })
        .eq('id', user.id)

      if (profileError) {
        // The client surfaces this error and the profile keeps its previous
        // state (e.g. still 'trial') — the user can retry the sync.
        console.error('Failed to update profile on sync:', profileError)
        return new Response(
          JSON.stringify({ error: 'Database error during profile update' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      // Feature listings
      const priority = plan.listing_priority ?? 1
      await supabaseAdmin
        .from('listings')
        .update({ is_featured: true, listing_priority: priority })
        .eq('user_id', user.id)

      dbStatusChanged = true
    } else if (mpStatus === 'cancelled') {
      // Result-checked update: the row must be marked cancelled BEFORE the
      // conditional profile clear runs — never clear on a failed update.
      const { data, error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', subscription.id)
        .select('id')

      if (updateError) {
        console.error('Failed to mark subscription cancelled on sync:', updateError)
        return new Response(
          JSON.stringify({ error: 'Database error during subscription update' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (!data || data.length === 0) {
        // No row was updated — a concurrent writer already moved it out of
        // the live slot. The conditional clear below stays safe because the
        // RPC re-checks active rows atomically.
        console.log(`sync-subscription: row ${subscription.id} already updated by another writer`)
      }

      // NOTE: cancel does NOT un-feature listings — featured_until governs
      // active features and the expire_featured_listings cron (01:03 UTC)
      // cleans them up. Keeps parity with mp-webhook and cancel-subscription.

      // Conditional profile clear: only when the user has NO remaining
      // active row across all plans (spec "Conditional profile clear"). The
      // RPC returns false when another active plan remains — the profile
      // intentionally keeps its subscription fields.
      const cleared = await clearProfileSubscription(supabaseAdmin, user.id)
      if (!cleared) {
        console.log(`sync-subscription: profile kept for user=${user.id} (another active plan remains)`)
      }

      dbStatusChanged = true
    } else if (mpStatus === 'expired') {
      // Result-checked update, same contract as the cancelled branch.
      const { data, error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('id', subscription.id)
        .select('id')

      if (updateError) {
        console.error('Failed to mark subscription expired on sync:', updateError)
        return new Response(
          JSON.stringify({ error: 'Database error during subscription update' }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }

      if (!data || data.length === 0) {
        console.log(`sync-subscription: row ${subscription.id} already updated by another writer`)
      }

      // NOTE: same as cancel — no un-feature here, featured_until + cron wins.

      const cleared = await clearProfileSubscription(supabaseAdmin, user.id)
      if (!cleared) {
        console.log(`sync-subscription: profile kept for user=${user.id} (another active plan remains)`)
      }

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
