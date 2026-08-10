// Expiry cron: expire-pending-subscriptions (design D6)
//
// Hourly slow-path reconciler for subscription duplicate prevention. The
// checkout guard (create-subscription) is the fast path; this function is the
// slow path that cleans up what the guard/webhook leave behind:
//
//   Row set A — stale pendings (status='pending' AND created_at <= now()-24h):
//     GET the MP preapproval FIRST — never blind-cancel a paid 24h-old
//     preapproval (the incident's exact failure mode was a webhook-delayed
//     payment on a stale pending row):
//       * GET fails            → keep pending, count deferred, next run.
//       * MP authorized        → recover the row to active with a real expiry
//                                (webhook-delay payment recovery). NO profile
//                                write — the spec says the cron SHALL NOT
//                                modify profiles; mp-webhook / sync-subscription
//                                complete the profile.
//       * MP pending           → PUT-cancel (tolerates already-cancelled) →
//                                conditional UPDATE status='cancelled' WHERE
//                                status='pending' AND created_at <= cutoff
//                                (0 rows → concurrent replace, no-op).
//                                Cancel fails → keep pending + alert, next run.
//       * MP cancelled/expired → conditional UPDATE to match MP, no PUT.
//       * MP paused            → local 'cancelled' (CHECK has no 'paused';
//                                the checkout guard settles paused the same
//                                way — MP truth moved away from pending).
//       * no MP id (anomaly)   → conditional local 'cancelled': there is no
//                                preapproval to charge and no MP authority to
//                                consult, so GET-first is vacuous; marking the
//                                row cancelled frees the (user, plan) live
//                                slot. Loud log — writers always set the id.
//
//   Row set B — conflict markers (status='cancelled' AND
//     conflict_resolution_pending = true) — NO age filter; the ONLY sanctioned
//     authorized-cancel (duplicate cleanup from mp-webhook's conflict path):
//       * GET fails                 → keep marker + alert, deferred, next run.
//       * MP authorized/pending     → PUT-cancel (the sanctioned
//                                     authorized-cancel) → clear marker on
//                                     success; failure keeps marker + alert.
//       * MP cancelled/expired      → clear marker, no PUT.
//       * MP paused/unknown         → charge state is not provably dead: keep
//                                     marker + alert (never clear a marker on
//                                     an ambiguous MP state).
//
// TOCTOU doctrine (design): every DB write below is conditional on status
// (+ staleness for set A), so a concurrent writer (webhook activation, guard
// replace, sync) can never be clobbered. The cron only ever resolves markers
// or >= 24h pendings — resume (< 24h) is the guard's domain, never the cron's.
//
// Escalation (gate 1b): a marker stuck > 6h triggers a console.error
// escalation log. subscriptions has NO updated_at column (dump-only table —
// only created_at is guaranteed), so the age signal is created_at: for marker
// rows created by the webhook conflict path it equals "marker set since"; for
// a reused row it may overstate age — the escalation is a conservative
// monitoring signal, never an action.
//
// Auth (gate 1a): the dashboard cron POSTs with
// Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>. The function compares the
// bearer against the env value with a timing-safe byte compare (constant
// time, no external dependency) and returns 401 on any mismatch. 405 on
// non-POST. CORS is kept minimal (server-to-server cron) but consistent with
// the other functions.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  PENDING_STALE_MS,
  cancelPreapproval,
  fetchPreapproval,
} from '../_shared/subscription.ts'
import type { SubscriptionRow } from '../_shared/subscription.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** A conflict marker that stays unresolved past this age is escalated (gate 1b). */
const MARKER_STUCK_MS = 6 * 60 * 60 * 1000

/**
 * Constant-time byte comparison (no external crypto dependency).
 *
 * Lengths are compared first (a length leak on a high-entropy bearer token is
 * standard practice for this pattern); the byte loop runs to completion so
 * early byte mismatches cannot be observed through timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false

  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    // Indices are in-bounds by the length check above; the assertions are
    // for strict-mode (noUncheckedIndexedAccess) typing of Uint8Array.
    diff |= aBytes[i]! ^ bBytes[i]!
  }
  return diff === 0
}

/**
 * Gate 1a: the cron must present the service_role key as a bearer token.
 * Fails closed — a missing env value, missing header, or any mismatch is 401.
 */
function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!expected) return false

  const header = req.headers.get('Authorization')
  if (!header || !header.startsWith('Bearer ')) return false

  return timingSafeEqual(header.slice('Bearer '.length), expected)
}

/**
 * MP test mode returns next_billing_date: null (or ''). Fall back to +30 days
 * so recovered rows always carry a real expiry (same policy as mp-webhook and
 * create-subscription). The "30 days" backup period must stay aligned with
 * subscription_plans.featured_duration_days (both plans are 30 today).
 */
function resolveNextBillingDate(preapproval: any): string {
  return preapproval.next_billing_date ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Gate 1b escalation signal: is this marker row older than MARKER_STUCK_MS?
 * Uses created_at — the only guaranteed timestamp column (no updated_at on
 * the dump-only subscriptions table).
 */
function isMarkerStuck(row: SubscriptionRow): boolean {
  const createdAtMs = row.created_at ? new Date(row.created_at).getTime() : 0
  return Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= MARKER_STUCK_MS
}

/** Log the gate 1b escalation for a marker that could not be resolved this run. */
function escalateIfStuck(row: SubscriptionRow, reason: string): void {
  if (isMarkerStuck(row)) {
    console.error(
      `expire-pending-subscriptions: ESCALATION — conflict marker row ${row.id} (mp=${row.mp_preapproval_id}) stuck >6h (created_at=${row.created_at}); still conflict_resolution_pending=true — ${reason}`,
    )
  }
}

/** Result counters returned to the dashboard cron (design D6 return shape). */
interface ExpiryCounts {
  cancelled: number
  activated: number
  markersCleared: number
  deferred: number
}

/**
 * Row set A — stale pendings. Sequential processing (hourly, low volume):
 * no Promise.all, keeps MP rate limits and ordering sane.
 */
async function processStalePendings(
  mpAccessToken: string,
  cutoffIso: string,
): Promise<Pick<ExpiryCounts, 'cancelled' | 'activated' | 'deferred'>> {
  const counts = { cancelled: 0, activated: 0, deferred: 0 }

  const { data: stalePendings, error: queryError } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('status', 'pending')
    .lte('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (queryError) throw queryError

  for (const row of stalePendings ?? []) {
    if (!row.mp_preapproval_id) {
      // Anomaly (writers always set the id): nothing to GET or cancel on MP,
      // so GET-first is vacuous — marking the row cancelled frees the live
      // (user, plan) slot the guard would otherwise 23505 against. Loud:
      // this should not happen.
      console.error(
        `expire-pending-subscriptions: stale pending row ${row.id} has no MP preapproval id — marking cancelled locally`,
      )
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', row.id)
        .eq('status', 'pending')
        .lte('created_at', cutoffIso)
        .select('id')
      if (error) {
        console.error(`expire-pending-subscriptions: no-id pending row ${row.id} update failed:`, error)
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        console.log(`expire-pending-subscriptions: no-id pending row ${row.id} moved by another writer`)
      } else {
        counts.cancelled++
      }
      continue
    }

    // GET-first: MP is the authority — never blind-cancel a paid 24h-old
    // preapproval (webhook-delay payment recovery is the incident mode).
    let preapproval: any
    try {
      preapproval = await fetchPreapproval(mpAccessToken, row.mp_preapproval_id)
    } catch (mpError) {
      console.error(
        `expire-pending-subscriptions: GET failed for stale pending ${row.id} (mp=${row.mp_preapproval_id}) — keeping pending:`,
        mpError,
      )
      counts.deferred++
      continue
    }

    const mpStatus: string = preapproval?.status

    if (mpStatus === 'authorized') {
      // Webhook-delay payment recovery: the user paid after the row went
      // stale. Recover to active with a real expiry. NO profile write —
      // mp-webhook / sync-subscription complete the profile (spec).
      const nextBillingDate = resolveNextBillingDate(preapproval)
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'active', expires_at: nextBillingDate })
        .eq('id', row.id)
        .eq('status', 'pending')
        .lte('created_at', cutoffIso)
        .select('id')

      if (error) {
        console.error(`expire-pending-subscriptions: failed to activate stale pending ${row.id}:`, error)
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        // Concurrent writer moved the row (e.g. webhook already activated it
        // or the guard replaced it) — nothing to count; the row is no longer
        // a stale pending.
        console.log(`expire-pending-subscriptions: stale pending ${row.id} moved by another writer — activation no-op`)
      } else {
        counts.activated++
        console.log(`expire-pending-subscriptions: recovered stale pending ${row.id} to active (MP authorized, webhook-delay payment)`)
      }
      continue
    }

    if (mpStatus === 'pending') {
      // Still pending at MP after 24h — dead checkout. PUT-cancel first, then
      // conditionally mark cancelled (never clear the slot before MP stops
      // expecting payment).
      try {
        await cancelPreapproval(mpAccessToken, row.mp_preapproval_id)
      } catch (mpError) {
        // Alert + keep pending: the next run retries (spec "MP failure defers
        // the row").
        console.error(
          `expire-pending-subscriptions: MP cancel of stale pending ${row.id} (mp=${row.mp_preapproval_id}) failed — keeping pending:`,
          mpError,
        )
        counts.deferred++
        continue
      }

      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', row.id)
        .eq('status', 'pending')
        .lte('created_at', cutoffIso)
        .select('id')

      if (error) {
        console.error(`expire-pending-subscriptions: failed to mark stale pending ${row.id} cancelled:`, error)
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        // Concurrent replace (e.g. the guard created a fresh row in the same
        // slot) — no-op by design (TOCTOU).
        console.log(`expire-pending-subscriptions: stale pending ${row.id} replaced by another writer — cancel no-op`)
      } else {
        counts.cancelled++
        console.log(`expire-pending-subscriptions: cancelled stale pending ${row.id} (mp=${row.mp_preapproval_id})`)
      }
      continue
    }

    if (mpStatus === 'cancelled' || mpStatus === 'expired' || mpStatus === 'paused') {
      // MP truth already moved away from pending — match it locally, no PUT.
      // 'paused' has no local status (CHECK: active/pending/cancelled/expired)
      // and the checkout guard settles paused rows as cancelled — same here.
      const targetStatus = mpStatus === 'expired' ? 'expired' : 'cancelled'
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: targetStatus })
        .eq('id', row.id)
        .eq('status', 'pending')
        .lte('created_at', cutoffIso)
        .select('id')

      if (error) {
        console.error(`expire-pending-subscriptions: failed to settle stale pending ${row.id} (MP ${mpStatus}):`, error)
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        console.log(`expire-pending-subscriptions: stale pending ${row.id} moved by another writer — ${targetStatus} no-op`)
      } else {
        counts.cancelled++
        console.log(`expire-pending-subscriptions: settled stale pending ${row.id} to ${targetStatus} (MP ${mpStatus})`)
      }
      continue
    }

    // Unknown MP status — cannot decide safely; keep pending for the next run.
    console.error(
      `expire-pending-subscriptions: unexpected MP status "${mpStatus}" on stale pending ${row.id} — keeping pending`,
    )
    counts.deferred++
  }

  return counts
}

/**
 * Row set B — conflict markers (no age filter; the ONLY sanctioned
 * authorized-cancel, design D3/D6). Sequential processing like set A.
 */
async function processMarkers(
  mpAccessToken: string,
): Promise<Pick<ExpiryCounts, 'markersCleared' | 'deferred'>> {
  const counts = { markersCleared: 0, deferred: 0 }

  const { data: markers, error: queryError } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('status', 'cancelled')
    .eq('conflict_resolution_pending', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (queryError) throw queryError

  for (const row of markers ?? []) {
    if (!row.mp_preapproval_id) {
      // Anomaly — the webhook always sets the id on marker upserts. A marker
      // without an id cannot be resolved against MP: keep it + alert.
      console.error(
        `expire-pending-subscriptions: conflict marker row ${row.id} has no MP preapproval id — keeping marker`,
      )
      escalateIfStuck(row, 'marker has no MP preapproval id')
      counts.deferred++
      continue
    }

    let preapproval: any
    try {
      preapproval = await fetchPreapproval(mpAccessToken, row.mp_preapproval_id)
    } catch (mpError) {
      console.error(
        `expire-pending-subscriptions: GET failed for conflict marker ${row.id} (mp=${row.mp_preapproval_id}) — keeping marker:`,
        mpError,
      )
      escalateIfStuck(row, 'GET failed')
      counts.deferred++
      continue
    }

    const mpStatus: string = preapproval?.status

    if (mpStatus === 'authorized' || mpStatus === 'pending') {
      // Sanctioned authorized-cancel: P is a proven duplicate (the conflict
      // winner occupies the slot). Failure keeps the marker for the next run.
      try {
        await cancelPreapproval(mpAccessToken, row.mp_preapproval_id)
      } catch (mpError) {
        console.error(
          `expire-pending-subscriptions: MP cancel of conflict marker ${row.id} (mp=${row.mp_preapproval_id}) failed — keeping marker:`,
          mpError,
        )
        escalateIfStuck(row, 'MP cancel failed')
        counts.deferred++
        continue
      }

      // Clear the marker (row stays cancelled). 0 rows → a concurrent writer
      // already cleared it — converged either way.
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ conflict_resolution_pending: false })
        .eq('id', row.id)
        .eq('status', 'cancelled')
        .eq('conflict_resolution_pending', true)
        .select('id')

      if (error) {
        console.error(`expire-pending-subscriptions: failed to clear conflict marker ${row.id}:`, error)
        escalateIfStuck(row, 'marker clear failed after MP cancel')
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        console.log(`expire-pending-subscriptions: conflict marker ${row.id} already cleared by another writer`)
      } else {
        counts.markersCleared++
        console.log(`expire-pending-subscriptions: cleared conflict marker ${row.id} (mp=${row.mp_preapproval_id} cancelled)`)
      }
      continue
    }

    if (mpStatus === 'cancelled' || mpStatus === 'expired') {
      // MP already dead — nothing to cancel, just clear the marker (no PUT).
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({ conflict_resolution_pending: false })
        .eq('id', row.id)
        .eq('status', 'cancelled')
        .eq('conflict_resolution_pending', true)
        .select('id')

      if (error) {
        console.error(`expire-pending-subscriptions: failed to clear conflict marker ${row.id} (MP ${mpStatus}):`, error)
        escalateIfStuck(row, 'marker clear failed')
        counts.deferred++
        continue
      }
      if (!data || data.length === 0) {
        console.log(`expire-pending-subscriptions: conflict marker ${row.id} already cleared by another writer`)
      } else {
        counts.markersCleared++
        console.log(`expire-pending-subscriptions: cleared conflict marker ${row.id} (MP ${mpStatus})`)
      }
      continue
    }

    // paused or unknown: the charge state is not provably dead — never clear
    // the marker on an ambiguous MP state. Keep + alert.
    console.error(
      `expire-pending-subscriptions: unexpected MP status "${mpStatus}" on conflict marker ${row.id} — keeping marker`,
    )
    escalateIfStuck(row, `unexpected MP status "${mpStatus}"`)
    counts.deferred++
  }

  return counts
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

  // Gate 1a: timing-safe service_role bearer check BEFORE any work.
  if (!isAuthorized(req)) {
    console.error('expire-pending-subscriptions: unauthorized invocation (missing or invalid service_role bearer)')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      console.error('expire-pending-subscriptions: MP_ACCESS_TOKEN not configured')
      return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Staleness cutoff, computed once per run: rows older than 24h. Resume
    // (< 24h) is the guard's domain, never the cron's.
    const cutoffIso = new Date(Date.now() - PENDING_STALE_MS).toISOString()

    const stale = await processStalePendings(mpAccessToken, cutoffIso)
    const markers = await processMarkers(mpAccessToken)

    const counts = {
      cancelled: stale.cancelled,
      activated: stale.activated,
      markers_cleared: markers.markersCleared,
      deferred: stale.deferred + markers.deferred,
    }

    console.log(`expire-pending-subscriptions: run complete — ${JSON.stringify(counts)}`)

    return new Response(JSON.stringify(counts), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('expire-pending-subscriptions error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }
})
