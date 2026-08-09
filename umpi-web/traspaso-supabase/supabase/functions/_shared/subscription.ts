// Shared MercadoPago + subscription helpers (design D5).
//
// Single source of truth for the deterministic "live subscription" row
// selection and the MP API calls used across writers: sync-subscription,
// cancel-subscription, mp-webhook, create-subscription and the expiry cron.
// Kept here instead of per-function duplication — duplicated selection
// logic is the bug class this change eliminates (every writer must agree on
// which row is "the" subscription).
//
// Row-selection contract (spec "Deterministic row selection"): the newest
// row with status IN ('active','pending'), ordered by created_at DESC, id
// DESC — the same tie-break the migration reconcile uses and the checkout
// guard relies on.
//
// Profile-clear contract (spec "Conditional profile clear"): the profile
// subscription fields are cleared ONLY when the user has no remaining
// active row across all plans. Enforced atomically in the
// clear_profile_subscription_if_no_active RPC (20260809000001), not in
// application code.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Statuses that occupy the one-live-row-per-(user, plan) slot. */
export const LIVE_STATUSES = ['active', 'pending'] as const

/**
 * A pending subscription is stale after 24 hours. Must match the spec
 * staleness `created_at <= now() - 24h` used by the checkout guard and the
 * expiry cron.
 */
export const PENDING_STALE_MS = 24 * 60 * 60 * 1000

/** Minimal row shape the writers rely on (columns from the existing dump). */
export interface SubscriptionRow {
  id: string
  user_id: string
  plan_id: string | null
  status: string
  mp_preapproval_id: string | null
  external_reference: string | null
  created_at: string | null
  started_at: string | null
  expires_at: string | null
  period_start: string | null
  featured_used: number | null
  conflict_resolution_pending: boolean | null
}

/**
 * Select the newest live (active|pending) subscription for a user —
 * deterministically, matching the reconcile tie-break and the checkout
 * guard: ORDER BY created_at DESC, id DESC. Rows without an MP preapproval
 * id are excluded (they can never be synced or cancelled against MP).
 *
 * @param admin - Service-role Supabase client (bypasses RLS).
 * @param userId - The subscription owner.
 * @param planId - Optional plan filter (used by the checkout guard).
 * @returns The row, or null when the user has no live subscription.
 */
export async function selectLiveSubscription(
  admin: SupabaseClient,
  userId: string,
  planId?: string,
): Promise<SubscriptionRow | null> {
  let query = admin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', [...LIVE_STATUSES])
    .not('mp_preapproval_id', 'is', null)
    .not('mp_preapproval_id', 'eq', '')

  if (planId) {
    query = query.eq('plan_id', planId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return data ?? null
}

/**
 * Fetch a preapproval from MercadoPago.
 *
 * Returns the parsed JSON body on success (callers read `status`,
 * `next_billing_date`, ...). Throws with the HTTP status + response body on
 * failure so callers can log context and map to their user-facing error.
 */
export async function fetchPreapproval(
  mpAccessToken: string,
  preapprovalId: string,
): Promise<any> {
  const mpResponse = await fetch(
    `https://api.mercadopago.com/preapproval/${preapprovalId}`,
    {
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
      },
    },
  )

  if (!mpResponse.ok) {
    const mpBody = await mpResponse.text()
    throw new Error(
      `MercadoPago preapproval fetch failed (HTTP ${mpResponse.status}): ${mpBody}`,
    )
  }

  return await mpResponse.json()
}

/**
 * Cancel a preapproval on MercadoPago (PUT status: 'cancelled').
 *
 * Tolerates the already-cancelled state: MP rejects the PUT with HTTP 400
 * when the preapproval is already cancelled — we confirm the current status
 * via GET and report success so callers converge instead of erroring. Any
 * other failure throws with the MP response text.
 *
 * @returns `{ cancelled: true, alreadyCancelled }` — `alreadyCancelled` is
 *   true when the preapproval was already cancelled at MP.
 */
export async function cancelPreapproval(
  mpAccessToken: string,
  preapprovalId: string,
): Promise<{ cancelled: true; alreadyCancelled: boolean }> {
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

  const mpBody = await mpResponse.text()

  if (mpResponse.ok) {
    return { cancelled: true, alreadyCancelled: false }
  }

  if (mpResponse.status === 400) {
    // Design open question "MP error shape for PUT-cancel of an
    // already-cancelled preapproval": treated as success. Verify the
    // current status really is cancelled before claiming it.
    const current = await fetchPreapproval(mpAccessToken, preapprovalId)
    if (current?.status === 'cancelled') {
      return { cancelled: true, alreadyCancelled: true }
    }
    throw new Error(
      `MercadoPago cancel rejected (HTTP 400, current status: ${current?.status ?? 'unknown'}): ${mpBody}`,
    )
  }

  throw new Error(
    `MercadoPago cancel failed (HTTP ${mpResponse.status}): ${mpBody}`,
  )
}

/**
 * Conditionally clear the user's profile subscription fields.
 *
 * Wraps the `clear_profile_subscription_if_no_active` RPC
 * (20260809000001): one atomic UPDATE that sets `subscription_type` →
 * 'none' and `subscription_expires_at` → NULL only when the user has no
 * remaining row with status 'active' across all plans. RPC errors are
 * logged and rethrown — callers must not clear the profile when the RPC
 * cannot be evaluated.
 *
 * @returns true when the profile was cleared; false when the user still has
 *   an active row (another plan) and the profile was intentionally kept.
 */
export async function clearProfileSubscription(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc(
    'clear_profile_subscription_if_no_active',
    { p_user: userId },
  )

  if (error) {
    // Log the PostgrestError server-side but rethrow a GENERIC error: the
    // raw message can leak schema/SQL wording to the client (e.g. the RPC
    // missing until the migration ships). Callers map it to a user-facing
    // 500. The row is already committed to cancelled/expired at this point,
    // so a client retry converges — no state corruption.
    console.error('clear_profile_subscription_if_no_active RPC failed:', error)
    throw new Error('Database error during profile update')
  }

  return Boolean(data)
}
