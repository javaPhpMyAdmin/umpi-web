import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  cancelPreapproval,
  clearProfileSubscription,
  selectLiveSubscription,
} from '../_shared/subscription.ts'
import type { SubscriptionRow } from '../_shared/subscription.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

const textEncoder = new TextEncoder()

function parseSignatureHeader(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null
  let ts = ''
  let v1 = ''
  for (const part of header.split(',')) {
    const [key, ...rest] = part.split('=')
    const value = rest.join('=').trim()
    if (key?.trim() === 'ts') ts = value
    if (key?.trim() === 'v1') v1 = value
  }
  return ts && v1 ? { ts, v1 } : null
}

async function sha256HmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// MP signs the manifest `id:{data.id};request-id:{x-request-id};ts:{ts};` with
// HMAC-SHA256 using the webhook secret (sections with missing values are omitted).
// data.id is taken from query params (IPN) with body fallback (Webhooks JSON),
// and must be lowercased when alphanumeric (MP docs).
async function isSignatureValid(
  req: Request,
  dataId: string | null,
  body: Record<string, unknown>,
): Promise<boolean> {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET')
  if (!secret) return false

  const parts = parseSignatureHeader(req.headers.get('x-signature'))
  if (!parts) return false

  const bodyDataId = (body as any).data?.id
  const rawDataId = String(dataId || (typeof bodyDataId === 'string' ? bodyDataId : '') || '')
  const manifestDataId = rawDataId.toLowerCase()
  const requestId = req.headers.get('x-request-id') || ''

  const sections: string[] = []
  if (manifestDataId) sections.push(`id:${manifestDataId}`)
  if (requestId) sections.push(`request-id:${requestId}`)
  sections.push(`ts:${parts.ts}`)
  const manifest = sections.join(';') + ';'

  const expected = await sha256HmacHex(secret, manifest)
  return expected === parts.v1.toLowerCase()
}

// --- Conflict resolution (design D3 + product decision 6.2) ---
//
// Conflict = a webhook event that would create a second live (active|pending)
// row for the same (user_id, plan_id): preapproval P resolves to a user/plan
// that already has a live row on a DIFFERENT preapproval ("the winner"). The
// winner row and the profile are NEVER modified in the conflict path — only
// the loser (P) or the unpaid pending winner is cancelled, so the user can
// never end up billed by two preapprovals for one plan.
//
// Resolution branches (spec "Webhook conflict resolution" + decision 6.2):
//   - winner still `pending` AND P `authorized`  → PROMOTE P: the user paid
//     through P, so P becomes the active row and the unpaid pending winner is
//     cancelled in MP + DB (preserves the user's payment).
//   - otherwise (winner `active`, or P not `authorized`) → PUT-cancel P and
//     ensure P's row is `cancelled` with the conflict marker per outcome.
//
// Failure responses are always 200 — never 5xx for conflict outcomes — so MP
// does not retry the event forever. When a cancellation fails, the
// `conflict_resolution_pending` marker makes the hourly
// expire-pending-subscriptions cron converge later (GET P → PUT-cancel while
// authorized/pending → clear marker).

interface ConflictContext {
  winner: SubscriptionRow
  preapprovalId: string
  externalReference: string
  userId: string
  planId: string
  preapproval: any
  mpStatus: string
  mpAccessToken: string
}

function conflictOk(): Response {
  return new Response(JSON.stringify({ ok: true, skipped: 'duplicate_conflict' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function conflictRetryViaCron(): Response {
  // 200 + resolution hint: MP must not retry; the hourly cron converges from
  // the marker (contract: no 5xx for conflict outcomes).
  return new Response(JSON.stringify({ skipped: 'duplicate_conflict', resolution: 'retry_via_cron' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Resolve the expiry anchor for an authorized preapproval.
 *
 * MP test mode returns next_billing_date: null (or ''). Fall back to +30 days
 * so expires_at / subscription_expires_at always carry a real expiry date and
 * the expire_subscriptions cron can actually expire people. A webhook is a
 * real MP event, so re-anchoring the period here is legitimate (unlike
 * sync-subscription). The "30 days" backup period must stay aligned with
 * subscription_plans.featured_duration_days (both plans are 30 today).
 */
function resolveNextBillingDate(preapproval: any): string {
  return preapproval.next_billing_date ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Build the payload that (re)activates a subscription row from an authorized
 * preapproval. Used by the happy path and by the promote-P resolution.
 */
function buildActiveRow(
  preapproval: any,
  preapprovalId: string,
  userId: string,
  planId: string,
  externalReference: string,
): Record<string, unknown> {
  const nextBillingDate = resolveNextBillingDate(preapproval)

  return {
    user_id: userId,
    plan_id: planId,
    mp_preapproval_id: preapprovalId,
    external_reference: externalReference,
    status: 'active',
    started_at: preapproval.date_created,
    expires_at: nextBillingDate,
    featured_used: 0,
    period_start: new Date().toISOString(),
  }
}

/**
 * Ensure P's row is `cancelled` with the conflict marker set to `marker`.
 * Upserts keyed by mp_preapproval_id (unique index): an existing row is
 * updated, a missing one is created — cancelled rows never trip the live
 * (user_id, plan_id) index, so P never stays live.
 *
 * HARD CONTRACT (task 3.3 / spec): a marker ensure-write failure must NEVER
 * turn into a 5xx — the webhook must always ack MP or MP retries forever.
 * Log it and let the caller return its 200.
 */
async function ensureConflictMarker(ctx: ConflictContext, marker: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: ctx.userId,
      plan_id: ctx.planId,
      mp_preapproval_id: ctx.preapprovalId,
      external_reference: ctx.externalReference,
      status: 'cancelled',
      conflict_resolution_pending: marker,
      started_at: ctx.preapproval.date_created || new Date().toISOString(),
    }, { onConflict: 'mp_preapproval_id' })

  if (error) {
    console.error('mp-webhook: conflict marker ensure-write failed:', error)
  }
}

/**
 * Cancel-P resolution: PUT-cancel P on MP, then ensure P's row is `cancelled`
 * with the marker reflecting the outcome (false = converged, true = the cron
 * must retry the cancellation). Winner row and profile untouched.
 */
async function cancelPAndMark(ctx: ConflictContext): Promise<Response> {
  let cancelledAtMp = false
  try {
    // Shared helper: PUT status='cancelled', tolerates already-cancelled
    // (400 + GET-confirm). Throws on any real failure.
    await cancelPreapproval(ctx.mpAccessToken, ctx.preapprovalId)
    cancelledAtMp = true
  } catch (mpError) {
    console.error('mp-webhook: conflict — MP cancel of P failed:', mpError)
  }

  await ensureConflictMarker(ctx, !cancelledAtMp)

  return cancelledAtMp ? conflictOk() : conflictRetryViaCron()
}

/**
 * Promote-P resolution (product decision 6.2 — RESOLVED: preserve the user's
 * payment). The winner row is still `pending` while conflicting preapproval P
 * is `authorized`: the user paid through P, so P is promoted to `active` and
 * the unpaid pending winner is cancelled in MP + DB.
 *
 * Ordering note: the winner is cancelled BEFORE P is activated — the pending
 * winner occupies the (user_id, plan_id) live slot, and activating P first
 * would trip the unique partial index (23505). Task bullet order lists promote
 * first, but cancelling the winner first is the only sequence that satisfies
 * the index invariant; the end state matches the contract (winner cancelled in
 * MP + DB, P active).
 *
 * The profile is NOT touched (conflict contract "winner/profile untouched"):
 * after promotion the user HAS an active row (P), so a conditional clear would
 * be a no-op and a direct write could clobber another plan's profile state.
 */
async function promoteP(ctx: ConflictContext): Promise<Response> {
  const winnerMpId = ctx.winner.mp_preapproval_id
  if (!winnerMpId) {
    // Unreachable — selectLiveSubscription filters out rows without an MP id.
    console.error('mp-webhook: promote — winner has no MP preapproval id')
    return new Response(JSON.stringify({ error: 'Database error during conflict resolution' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 1. Cancel the pending winner on MP (tolerates already-cancelled). On
  //    failure the winner still occupies the slot, so P cannot be promoted:
  //    mark P cancelled + conflict_resolution_pending and let the hourly cron
  //    converge (it GETs P → authorized → PUT-cancel → clears marker). No
  //    perpetual charge, no silent loss.
  try {
    await cancelPreapproval(ctx.mpAccessToken, winnerMpId)
  } catch (mpError) {
    console.error('mp-webhook: promote — winner MP cancel failed:', mpError)
    await ensureConflictMarker(ctx, true)
    return conflictRetryViaCron()
  }

  // 2. Result-checked update: winner row → cancelled (frees the live slot).
  const { data: winnerUpdate, error: winnerUpdateError } = await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', ctx.winner.id)
    .select('id')

  if (winnerUpdateError) {
    console.error('mp-webhook: promote — winner DB update failed:', winnerUpdateError)
    await ensureConflictMarker(ctx, true)
    return conflictRetryViaCron()
  }

  if (!winnerUpdate || winnerUpdate.length === 0) {
    // A concurrent writer already moved the winner out of the live slot —
    // proceed; the P upsert's 23505 backstop covers a concurrent occupant.
    console.log(`mp-webhook: promote — winner ${ctx.winner.id} already updated by another writer`)
  }

  // 3. Promote P → active. Upsert keyed by mp_preapproval_id handles both an
  //    existing P row (cancelled/expired from an earlier replace) and a
  //    missing one (e.g. the checkout insert never committed).
  const { error: promoteError } = await supabaseAdmin
    .from('subscriptions')
    .upsert(
      buildActiveRow(ctx.preapproval, ctx.preapprovalId, ctx.userId, ctx.planId, ctx.externalReference),
      { onConflict: 'mp_preapproval_id' },
    )

  if (promoteError?.code === '23505') {
    // A concurrent writer grabbed the slot between the winner cancel and this
    // upsert. P loses the race — converge like the cancel-P path (new winner
    // untouched, P cancelled, marker per outcome). Re-entering promote here
    // could ping-pong against the concurrent writer.
    console.warn('mp-webhook: promote — live slot re-grabbed concurrently, cancelling P')
    return await cancelPAndMark(ctx)
  }

  if (promoteError) {
    console.error('mp-webhook: promote — P activate failed:', promoteError)
    return new Response(JSON.stringify({ error: 'Database error during upsert' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log(`mp-webhook: conflict promoted P — user=${ctx.userId} plan=${ctx.planId} mp_id=${ctx.preapprovalId} winner=${ctx.winner.id} cancelled`)
  return conflictOk()
}

/**
 * Conflict resolution entry. Winner row and profile are never modified.
 *  - winner still `pending` AND P `authorized` → PROMOTE P (decision 6.2).
 *  - otherwise → PUT-cancel P + marker (cancel-P path).
 */
async function resolveConflict(ctx: ConflictContext): Promise<Response> {
  if (ctx.winner.status === 'pending' && ctx.mpStatus === 'authorized') {
    return promoteP(ctx)
  }
  return cancelPAndMark(ctx)
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // --- 1. Parse payload (JSON or form-encoded) ---
    const contentType = req.headers.get('content-type') || ''
    let body: Record<string, unknown> = {}

    if (contentType.includes('application/json')) {
      body = await req.json()
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      for (const [k, v] of form.entries()) {
        body[k] = v
      }
    } else {
      // Try JSON as fallback
      try {
        body = await req.json()
      } catch {
        // ignore parse errors
      }
    }

    // --- 2. Log full payload for debugging ---
    console.log('mp-webhook received:', JSON.stringify({ headers: Object.fromEntries(req.headers.entries()), body }, null, 2))

    // --- 3. Extract event ID and type from query params (IPN) or body (Webhooks) ---
    const url = new URL(req.url)
    const queryType = url.searchParams.get('type') || url.searchParams.get('topic')
    const queryDataId = url.searchParams.get('data.id') || url.searchParams.get('id')
    const bodyDataId = (body as any).data?.id
    const bodyId = (body as any).id
    const eventType = (body as any).type || (body as any).action || queryType

    let dataId: string | null = queryDataId || bodyDataId || bodyId
    let preapprovalId: string | null = null

    // --- 2.5 Verify webhook signature (fail closed) ---
    const webhookSecret = Deno.env.get('MP_WEBHOOK_SECRET')
    if (!webhookSecret) {
      console.error('mp-webhook: MP_WEBHOOK_SECRET not configured — refusing unsigned webhooks')
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!(await isSignatureValid(req, dataId, body))) {
      console.error('mp-webhook: invalid webhook signature — rejecting request')
      return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!dataId) {
      console.log('mp-webhook: no event ID found in payload — acking anyway')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- 3.25 Ack-and-ignore events we don't handle (payment, plan events, etc.) ---
    // Prevents MP retry loops (MP retries every 15 min until 200/201).
    const isHandledEvent =
      eventType === 'subscription_authorized_payment' ||
      (typeof eventType === 'string' &&
        eventType.includes('preapproval') &&
        !eventType.includes('plan'))

    if (!isHandledEvent) {
      console.log(`mp-webhook: ignoring unhandled event type=${eventType} id=${dataId}`)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- 3.5 Resolve the preapproval ID from the event ---
    // subscription_authorized_payment: data.id is the AUTHORIZED PAYMENT (invoice) id,
    // NOT the preapproval id. Fetch the invoice to get preapproval_id + external_reference.
    // subscription_preapproval / preapproval.*: data.id IS the preapproval id.
    if (eventType === 'subscription_authorized_payment') {
      const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const invoiceResponse = await fetch(
        `https://api.mercadopago.com/authorized_payments/${dataId}`,
        {
          headers: { Authorization: `Bearer ${mpAccessToken}` },
        },
      )

      if (!invoiceResponse.ok) {
        const mpError = await invoiceResponse.text()
        console.error('Failed to fetch invoice from MP:', mpError)
        return new Response(JSON.stringify({ error: 'Failed to fetch invoice from MP' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const invoice = await invoiceResponse.json()
      preapprovalId = invoice.preapproval_id || null
      if (!preapprovalId) {
        console.error('Invoice has no preapproval_id:', JSON.stringify(invoice))
        return new Response(JSON.stringify({ error: 'Invoice has no preapproval_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      console.log(`mp-webhook: resolved invoice ${dataId} -> preapproval ${preapprovalId}`)
    } else {
      preapprovalId = dataId
    }

    if (!preapprovalId) {
      console.log('mp-webhook: no preapproval ID found in payload — acking anyway')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- 4. Fetch preapproval from MercadoPago to get authoritative status ---
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
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
      console.error('Failed to fetch preapproval from MP:', mpError)
      return new Response(JSON.stringify({ error: 'Failed to fetch preapproval from MP' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const preapproval = await mpResponse.json()

    // --- 5. Parse external_reference to identify user and plan ---
    // Format: sub_{user_id}_{plan_id}
    const externalReference: string | undefined = preapproval.external_reference
    if (!externalReference || !externalReference.startsWith('sub_')) {
      console.error('Invalid or missing external_reference:', externalReference)
      return new Response(JSON.stringify({ error: 'Invalid external_reference' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const parts = externalReference.split('_')
    if (parts.length !== 3) {
      console.error('Unexpected external_reference format:', externalReference)
      return new Response(JSON.stringify({ error: 'Invalid external_reference format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const [, userId, planId] = parts

    // --- 6. Process status change ---
    const mpStatus: string = preapproval.status

    // --- 6.5 Conflict pre-check (design D3 + spec "Webhook conflict
    // resolution") ---
    // A webhook that would create a second live row for (user, plan) — a
    // different preapproval already occupies the slot — must resolve the
    // conflict instead of writing (the unique partial index would 23505). The
    // existing live row is "the winner": it is never modified. The check
    // excludes P itself (same mp_preapproval_id) so event re-delivery of P
    // stays on the happy path (idempotent activate).
    const liveRow = await selectLiveSubscription(supabaseAdmin, userId, planId)
    const winner = liveRow && liveRow.mp_preapproval_id !== preapprovalId
      ? liveRow
      : null

    if (winner) {
      return await resolveConflict({
        winner,
        preapprovalId,
        externalReference,
        userId,
        planId,
        preapproval,
        mpStatus,
        mpAccessToken,
      })
    }

    if (mpStatus === 'authorized') {
      // Upsert subscription
      const nextBillingDate = resolveNextBillingDate(preapproval)

      const { error: upsertError } = await supabaseAdmin
        .from('subscriptions')
        .upsert(
          buildActiveRow(preapproval, preapprovalId, userId, planId, externalReference),
          { onConflict: 'mp_preapproval_id' },
        )

      if (upsertError?.code === '23505') {
        // 23505 backstop (spec "Webhook conflict resolution"): a DIFFERENT
        // live row grabbed the (user_id, plan_id) slot between the pre-check
        // and this insert (race). Re-select the winner and resolve the
        // conflict against it.
        console.warn('mp-webhook: unique violation on activate — resolving conflict')
        const racer = await selectLiveSubscription(supabaseAdmin, userId, planId)
        if (racer && racer.mp_preapproval_id !== preapprovalId) {
          return await resolveConflict({
            winner: racer,
            preapprovalId,
            externalReference,
            userId,
            planId,
            preapproval,
            mpStatus,
            mpAccessToken,
          })
        }
        // No live winner found (the racer already left the slot) — DB
        // inconsistency; 500 lets MP retry and the retry activates normally.
        console.error('mp-webhook: 23505 on activate without a live winner')
        return new Response(JSON.stringify({ error: 'Database error during upsert' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (upsertError) {
        console.error('Failed to upsert subscription:', upsertError)
        return new Response(JSON.stringify({ error: 'Database error during upsert' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fetch plan slug for profile update. If the plan cannot be resolved,
      // DO NOT ack: the profile would stay 'trial' while the subscription is
      // active — the trial branch of feature_listing would win and the user
      // would keep trial benefits with the trial never consumed. Returning
      // 500 makes MP retry the event (idempotent upsert on retry).
      const { data: plan, error: planError } = await supabaseAdmin
        .from('subscription_plans')
        .select('slug')
        .eq('id', planId)
        .single()

      if (planError || !plan?.slug) {
        console.error('Failed to resolve plan on authorize:', planError ?? `plan ${planId} not found`)
        return new Response(JSON.stringify({ error: 'Plan not found for subscription' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Update profile (no listings touched — toggle + RPC handle featuring)
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
        .eq('id', userId)

      if (profileError) {
        // Do NOT ack the webhook: MP retries the event, and the retry
        // re-runs the idempotent upsert + profile update.
        console.error('Failed to update profile on authorize:', profileError)
        return new Response(JSON.stringify({ error: 'Database error during profile update' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      console.log(`Subscription authorized: user=${userId} plan=${planId} mp_id=${preapprovalId}`)
    } else if (mpStatus === 'cancelled') {
      // Result-checked update, keyed by mp_preapproval_id (unique index —
      // deterministic by identity). The row must be marked cancelled BEFORE
      // the conditional profile clear runs — never clear on a failed update.
      // Mirrors sync-subscription's cancelled branch.
      const { data, error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('mp_preapproval_id', preapprovalId)
        .select('id')

      if (updateError) {
        console.error('Failed to mark subscription cancelled on webhook:', updateError)
        return new Response(JSON.stringify({ error: 'Database error during subscription update' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!data || data.length === 0) {
        // No row was updated — a concurrent writer already moved it out of
        // the live slot. The conditional clear below stays safe because the
        // RPC re-checks active rows atomically.
        console.log(`mp-webhook: row for mp_id=${preapprovalId} already updated by another writer`)
      }

      // NOTE: cancel does NOT un-feature listings — featured_until governs
      // active features and the expire_featured_listings cron cleans them up.

      // Conditional profile clear: only when the user has NO remaining active
      // row across all plans (spec "Conditional profile clear"). The RPC
      // returns false when another active plan remains — the profile
      // intentionally keeps its subscription fields.
      const cleared = await clearProfileSubscription(supabaseAdmin, userId)
      if (!cleared) {
        console.log(`mp-webhook: profile kept for user=${userId} (another active plan remains)`)
      }

      console.log(`Subscription cancelled: user=${userId} mp_id=${preapprovalId}`)
    } else if (mpStatus === 'expired') {
      // Result-checked update, same contract as the cancelled branch.
      const { data, error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('mp_preapproval_id', preapprovalId)
        .select('id')

      if (updateError) {
        console.error('Failed to mark subscription expired on webhook:', updateError)
        return new Response(JSON.stringify({ error: 'Database error during subscription update' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (!data || data.length === 0) {
        console.log(`mp-webhook: row for mp_id=${preapprovalId} already updated by another writer`)
      }

      // NOTE: same as cancel — no un-feature here, featured_until + cron wins.

      const cleared = await clearProfileSubscription(supabaseAdmin, userId)
      if (!cleared) {
        console.log(`mp-webhook: profile kept for user=${userId} (another active plan remains)`)
      }

      console.log(`Subscription expired: user=${userId} mp_id=${preapprovalId}`)
    } else {
      console.log(`Unhandled preapproval status: ${mpStatus} for id=${preapprovalId}`)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('mp-webhook error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
})
