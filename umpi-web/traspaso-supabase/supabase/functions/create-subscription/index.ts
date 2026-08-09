import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rate-limit.ts'
import {
  PENDING_STALE_MS,
  cancelPreapproval,
  fetchPreapproval,
  selectLiveSubscription,
} from '../_shared/subscription.ts'
import type { SubscriptionRow } from '../_shared/subscription.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Checkout guard (design D2: create-subscription state machine) ---
//
// The guard runs BEFORE any MP POST / before deciding to create. It selects
// the newest live (active|pending) row for (user, plan) and lets MercadoPago
// arbitrate what to do with it — MP is the authority, so every non-orphan
// PUT-cancel below is preceded by a GET of the preapproval: a paid
// preapproval is recovered to active, never blindly cancelled.
//
//   active, expires_at NULL or >= now   → 409 (real subscription; NULL expiry
//                                           treated live)
//   active, expires_at < now (stale)    → GET: authorized → recover (refresh
//                                           row) + 409; else PUT-cancel +
//                                           conditional expired → create
//   pending, fresh (< PENDING_STALE_MS) → GET: pending → RESUME 200 (live
//                                           init_point, same preapproval — NO
//                                           new row); authorized → recover +
//                                           409; cancelled/expired/paused →
//                                           mark cancelled (no PUT) → create
//                                           (spec-drift: never resume a row
//                                           whose MP truth changed)
//   pending, stale (>= PENDING_STALE_MS)→ GET: pending → PUT-cancel
//                                           (fail → 5xx, stop) + conditional
//                                           cancelled → create
//   none                                 → create flow (POST → INSERT)
//
// Orphan exception (documented, design D2): the preapproval POSTed by THIS
// request is cancelled WITHOUT a GET when its INSERT fails (23505 race or DB
// error) — we just created it, its init_point is never returned, so it can
// never be paid through the app.

function alreadySubscribedResponse(): Response {
  // Client-facing shape preserved from the pre-guard code (status 400 → 409
  // per the checkout spec). PlansPage only branches on error presence.
  return new Response(
    JSON.stringify({ error: 'User already has an active subscription' }),
    {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

function jsonErrorResponse(status: number, error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

/**
 * MP test mode returns next_billing_date: null (or ''). Fall back to +30 days
 * so recovered rows always carry a real expiry (same policy as mp-webhook).
 * The "30 days" backup period must stay aligned with
 * subscription_plans.featured_duration_days (both plans are 30 today).
 */
function resolveNextBillingDate(preapproval: any): string {
  return preapproval.next_billing_date ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Recover a live row whose preapproval is `authorized` at MP: refresh the row
 * to active with a real expiry (design D2: `expires_at = next_billing_date ||
 * +30d`). The user is still billed — the row is recovered, NOT cancelled.
 * Profile convergence is left to mp-webhook / sync-subscription (design D2:
 * "webhook/sync complete profile").
 *
 * Throws on DB failure so the caller maps it to its 5xx; the caller then 409s
 * (MP says authorized — the user is billed, never create a duplicate).
 */
async function recoverAuthorizedRow(
  admin: SupabaseClient,
  row: SubscriptionRow,
  preapproval: any,
): Promise<void> {
  const nextBillingDate = resolveNextBillingDate(preapproval)

  const { error } = await admin
    .from('subscriptions')
    .update({ status: 'active', expires_at: nextBillingDate })
    .eq('id', row.id)

  if (error) throw error

  console.log(`create-subscription: recovered row ${row.id} (MP authorized)`)
}

type GuardOutcome =
  | { action: 'respond'; response: Response }
  | { action: 'proceed' }

async function runCheckoutGuard(
  admin: SupabaseClient,
  userId: string,
  planId: string,
  mpAccessToken: string,
): Promise<GuardOutcome> {
  // 1. Guard query — the newest live row for (user, plan), same
  //    created_at DESC, id DESC tie-break as the migration reconcile.
  //    Masked like every other DB error in this file (Slice 2 convention):
  //    the raw PostgrestError never reaches the client.
  let row: Awaited<ReturnType<typeof selectLiveSubscription>>
  try {
    row = await selectLiveSubscription(admin, userId, planId)
  } catch (error) {
    console.error('create-subscription: guard select failed:', error)
    return {
      action: 'respond',
      response: jsonErrorResponse(500, 'Database error during subscription check'),
    }
  }

  if (!row) {
    // No live row — create flow.
    return { action: 'proceed' }
  }

  const preapprovalId = row.mp_preapproval_id
  if (!preapprovalId) {
    // Unreachable in practice — selectLiveSubscription filters out rows
    // without an MP preapproval id. Kept as a defensive type guard.
    console.error(`create-subscription: live row ${row.id} has no MP preapproval id`)
    return {
      action: 'respond',
      response: jsonErrorResponse(500, 'Subscription is missing its MP preapproval ID'),
    }
  }

  // --- 2. Active row ---
  if (row.status === 'active') {
    // Fresh active: expires_at NULL (treated live — closes today's
    // pass-on-NULL bug) or still in the future. The user is billed; cancel
    // would forfeit the payment. No MP call needed.
    const isStale = row.expires_at !== null && new Date(row.expires_at).getTime() < Date.now()

    if (!isStale) {
      return { action: 'respond', response: alreadySubscribedResponse() }
    }

    // Stale-active: the row lapsed locally, but the user may still be billed
    // (webhook delay — the incident's exact failure mode). GET-first: never
    // PUT-cancel a preapproval without knowing its MP state.
    let preapproval: any
    try {
      preapproval = await fetchPreapproval(mpAccessToken, preapprovalId)
    } catch (mpError) {
      console.error('create-subscription: MP preapproval fetch failed:', mpError)
      return {
        action: 'respond',
        response: jsonErrorResponse(500, 'Failed to fetch preapproval from MercadoPago'),
      }
    }

    const mpStatus: string = preapproval.status

    if (mpStatus === 'authorized') {
      // User still billed — recover (refresh the row) and 409; cancel would
      // be money-loss.
      try {
        await recoverAuthorizedRow(admin, row, preapproval)
      } catch (dbError) {
        console.error('create-subscription: failed to recover stale-active row:', dbError)
        return {
          action: 'respond',
          response: jsonErrorResponse(500, 'Database error during subscription update'),
        }
      }
      return { action: 'respond', response: alreadySubscribedResponse() }
    }

    // Not authorized (pending/cancelled/expired/paused): the row is dead at
    // MP. PUT-cancel (fail → 5xx, stop) then conditionally mark the row
    // expired, then fall through to create.
    try {
      await cancelPreapproval(mpAccessToken, preapprovalId)
    } catch (mpError) {
      console.error('create-subscription: MP cancel of stale-active preapproval failed:', mpError)
      return {
        action: 'respond',
        response: jsonErrorResponse(500, 'MercadoPago cancel failed'),
      }
    }

    const { data: expiredRows, error: expireError } = await admin
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('id', row.id)
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString())
      .select('id')

    if (expireError) {
      console.error('create-subscription: failed to mark stale-active row expired:', expireError)
      return {
        action: 'respond',
        response: jsonErrorResponse(500, 'Database error during subscription update'),
      }
    }

    if (!expiredRows || expiredRows.length === 0) {
      // A concurrent writer moved the row (e.g. webhook re-activated it with
      // a fresh expiry) — the slot is live again; do not create.
      console.log(`create-subscription: stale-active row ${row.id} moved by another writer — 409`)
      return { action: 'respond', response: alreadySubscribedResponse() }
    }

    return { action: 'proceed' }
  }

  // --- 3. Pending row (status === 'pending'; LIVE_STATUSES is active|pending)
  // GET-first: MP truth arbitrates resume vs recover vs replace.
  let preapproval: any
  try {
    preapproval = await fetchPreapproval(mpAccessToken, preapprovalId)
  } catch (mpError) {
    console.error('create-subscription: MP preapproval fetch failed:', mpError)
    return {
      action: 'respond',
      response: jsonErrorResponse(500, 'Failed to fetch preapproval from MercadoPago'),
    }
  }

  const mpStatus: string = preapproval.status

  if (mpStatus === 'authorized') {
    // The user paid after all (webhook delayed) — recover the row and 409.
    // Profile convergence is left to mp-webhook / sync-subscription.
    try {
      await recoverAuthorizedRow(admin, row, preapproval)
    } catch (dbError) {
      console.error('create-subscription: failed to recover authorized pending row:', dbError)
      return {
        action: 'respond',
        response: jsonErrorResponse(500, 'Database error during subscription update'),
      }
    }
    return { action: 'respond', response: alreadySubscribedResponse() }
  }

  if (mpStatus !== 'pending') {
    // MP truth moved away from pending (cancelled/expired/paused) — the row
    // must not stay live. Mark it cancelled locally (NO PUT — MP already
    // settled; there is nothing to cancel) and fall through to create. The
    // status guard prevents clobbering a row a concurrent writer activated.
    const { error: settleError } = await admin
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')

    if (settleError) {
      console.error('create-subscription: failed to settle pending row:', settleError)
      return {
        action: 'respond',
        response: jsonErrorResponse(500, 'Database error during subscription update'),
      }
    }

    // 0 rows → a concurrent writer already moved it (activated/cancelled);
    // proceed — a leftover live row will 23505 on insert and converge to 409
    // with the orphan cleanup.
    return { action: 'proceed' }
  }

  // --- MP status is pending — staleness decides resume vs replace ---
  const createdAtMs = row.created_at ? new Date(row.created_at).getTime() : 0
  const isFresh = Number.isFinite(createdAtMs) && Date.now() - createdAtMs < PENDING_STALE_MS

  if (isFresh) {
    // Resume (spec "Resume pending checkout under 24 hours"): return the LIVE
    // init_point re-fetched from the existing preapproval — same preapproval,
    // NO new MP preapproval, NO new row.
    //
    // SPEC-DRIFT CONTRACT (design rev. 3): resume ONLY when MP status is
    // `pending`. A row whose MP truth changed (authorized / cancelled /
    // expired / paused) is never resumed — the dead-init_point contract
    // guarantees the client is never handed a checkout URL for a preapproval
    // MP no longer expects.
    if (!preapproval.init_point) {
      // MP violated its own pending-preapproval shape (no checkout URL).
      // A 200 without init_point would silently re-enable the client button
      // with no redirect and no error — an invisible retry loop. Fail loud:
      // the client shows the error, and the row goes stale after
      // PENDING_STALE_MS, freeing the slot via the replace path below.
      console.error(
        `create-subscription: resume blocked — preapproval ${preapprovalId} is pending but has no init_point`,
      )
      return {
        action: 'respond',
        response: jsonErrorResponse(502, 'MercadoPago returned a pending preapproval without a checkout URL'),
      }
    }
    return {
      action: 'respond',
      response: new Response(
        JSON.stringify({
          init_point: preapproval.init_point,
          preapproval_id: preapprovalId,
          external_reference: preapproval.external_reference ?? row.external_reference,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      ),
    }
  }

  // --- Stale pending — fail-closed replace ---
  // PUT-cancel first (fail → 5xx, stop: spec "Stale pending is replaced" —
  // never create while the old preapproval can still be charged), then
  // conditionally mark the row cancelled, then create.
  try {
    await cancelPreapproval(mpAccessToken, preapprovalId)
  } catch (mpError) {
    console.error('create-subscription: MP cancel of stale pending preapproval failed:', mpError)
    return {
      action: 'respond',
      response: jsonErrorResponse(500, 'MercadoPago cancel failed'),
    }
  }

  const { data: settledRows, error: settleError } = await admin
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')

  if (settleError) {
    console.error('create-subscription: failed to mark stale pending row cancelled:', settleError)
    return {
      action: 'respond',
      response: jsonErrorResponse(500, 'Database error during subscription update'),
    }
  }

  if (!settledRows || settledRows.length === 0) {
    // A concurrent writer moved the row (e.g. webhook activated it) — the
    // slot is live; do not create.
    console.log(`create-subscription: stale pending row ${row.id} moved by another writer — 409`)
    return { action: 'respond', response: alreadySubscribedResponse() }
  }

  return { action: 'proceed' }
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

    // --- 3. MP access token (needed by the guard AND the create flow) ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- 4. Checkout guard (design D2) ---
    // Runs BEFORE any MP POST / before deciding to create: active → 409 or
    // stale-replace; pending → resume (MP pending only) or replace; none →
    // create flow. Every non-orphan PUT-cancel is GET-first.
    const guard = await runCheckoutGuard(supabaseAdmin, user.id, planId, mpAccessToken)
    if (guard.action === 'respond') return guard.response

    // --- 5. Create flow: plan fetch → POST /preapproval → INSERT pending ---

    // Fetch the subscription plan
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

    // Generate external reference
    const externalReference = `sub_${user.id}_${planId}`

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
      notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
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

    // Save subscription row in DB so sync-subscription can find it
    try {
      const { error: insertError } = await supabaseAdmin
        .from('subscriptions')
        .insert({
          user_id: user.id,
          plan_id: planId,
          mp_preapproval_id: mpData.id,
          external_reference: externalReference,
          status: 'pending',
          started_at: new Date().toISOString(),
        })

      if (insertError) throw insertError
    } catch (insertError) {
      // The INSERT failed after the MP preapproval was created. The
      // preapproval is an ORPHAN: its init_point is never returned, so the
      // client can never pay it through the app. PUT-cancel it (documented
      // orphan exception — created by THIS request, its state is known, no
      // GET needed; design D2: "init_point is never stored").
      try {
        await cancelPreapproval(mpAccessToken, mpData.id)
        console.log(`create-subscription: cancelled orphan preapproval ${mpData.id}`)
      } catch (orphanError) {
        // Best-effort: never mask the primary error. A surviving orphan stays
        // pending at MP without a reachable init_point; if it ever pays, the
        // mp-webhook conflict path converges it.
        console.error('create-subscription: orphan preapproval cancel failed:', orphanError)
      }

      if ((insertError as { code?: string })?.code === '23505') {
        // Concurrent checkout won the race (spec "Concurrent checkout
        // arbitration"): the winning row is untouched — 409 like every other
        // live-row outcome.
        console.warn(`create-subscription: 23505 on insert — another checkout won (user=${user.id} plan=${planId})`)
        return alreadySubscribedResponse()
      }

      // Any other insert failure (spec "Insert failures are surfaced"): 5xx
      // with NO init_point — never return 200-without-row.
      console.error('create-subscription: failed to insert subscription row:', insertError)
      return new Response(
        JSON.stringify({ error: 'Failed to create subscription' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      )
    }

    // --- Return init_point, preapproval_id, and external_reference ---
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
