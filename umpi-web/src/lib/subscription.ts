import type { Profile } from '../types'

// ─── Plan limits (matching subscription_plans table) ────────────────────────
const PLAN_LIMITS = {
  premium: { maxImages: 20, maxFeatured: 10 },
  estandar: { maxImages: 10, maxFeatured: 1 },
} as const

const DEFAULT_LIMITS = { maxImages: 3, maxFeatured: 0 }

// ─── Core checks ───────────────────────────────────────────────────────────

/**
 * Returns true if the user has active benefits (trial OR paid plan).
 * This is the single source of truth for "can this user do premium stuff?"
 */
export function hasActiveBenefits(profile: Profile | null | undefined): boolean {
  if (!profile) return false

  // Trial active
  if (
    profile.subscription_status === 'trial' &&
    profile.trial_ends_at &&
    new Date(profile.trial_ends_at) > new Date()
  ) return true

  // Paid plan active
  if (
    profile.subscription_type &&
    profile.subscription_type !== '' &&
    profile.subscription_type !== 'none' &&
    (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())
  ) return true

  return false
}

/**
 * Returns true if the user has a paid subscription (not trial).
 * Use this when you need to distinguish trial from paid.
 */
export function hasPaidPlan(profile: Profile | null | undefined): boolean {
  if (!profile) return false
  return (
    profile.subscription_type != null &&
    profile.subscription_type !== '' &&
    profile.subscription_type !== 'none' &&
    (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date())
  )
}

/**
 * Returns true if the user is currently in trial period.
 *
 * Accepts any shape exposing subscription_status + trial_ends_at (a full
 * Profile or a read-only subset like the admin RPC payload), so the trial
 * boundary can't drift between surfaces.
 */
export function isInTrial(
  profile: Pick<Profile, 'subscription_status' | 'trial_ends_at'> | null | undefined
): boolean {
  if (!profile) return false
  return (
    profile.subscription_status === 'trial' &&
    profile.trial_ends_at != null &&
    new Date(profile.trial_ends_at) > new Date()
  )
}

// ─── Effective plan resolution ──────────────────────────────────────────────

type PlanSlug = 'premium' | 'estandar' | 'none'

/**
 * Returns the effective plan slug for feature calculations.
 * Paid plan wins over trial — mirrors the server-side guard (20260801000004)
 * and feature_listing, so the UI never promises more than the server enforces.
 * Falls back to the user's actual paid plan, then trial → premium, then none.
 */
export function getEffectivePlan(profile: Profile | null | undefined): PlanSlug {
  if (!profile) return 'none'

  // Paid plan (active subscription wins even if the profile still says trial)
  if (hasPaidPlan(profile)) {
    return (profile.subscription_type as PlanSlug) || 'none'
  }

  // Trial → behaves as premium
  if (isInTrial(profile)) return 'premium'

  return 'none'
}

// ─── Limit getters ──────────────────────────────────────────────────────────

/**
 * Max images per listing based on effective plan.
 * Trial = premium = 20, estándar = 10, free = 3.
 */
export function getMaxImages(profile: Profile | null | undefined): number {
  const plan = getEffectivePlan(profile)
  if (plan === 'none') return DEFAULT_LIMITS.maxImages
  return PLAN_LIMITS[plan]?.maxImages ?? DEFAULT_LIMITS.maxImages
}

/**
 * Max featured listings per billing period.
 * Trial = premium = 10, estándar = 1, free = 0.
 */
export function getMaxFeatured(profile: Profile | null | undefined): number {
  const plan = getEffectivePlan(profile)
  if (plan === 'none') return DEFAULT_LIMITS.maxFeatured
  return PLAN_LIMITS[plan]?.maxFeatured ?? DEFAULT_LIMITS.maxFeatured
}

/**
 * Days remaining in trial, or null if not in trial.
 */
export function getTrialDaysLeft(profile: Profile | null | undefined): number | null {
  if (!isInTrial(profile) || !profile?.trial_ends_at) return null
  return Math.max(0, Math.ceil(
    (new Date(profile.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ))
}

// ─── Status labels (shared by the admin panel) ──────────────────────────────
// Single source of truth for subscription status → Spanish label, consumed by
// both admin components (UsersTable, SubscriptionsSection). Values mirror the
// profile subscription_status values (trial / active / paid — paid is written
// by the payment webhook and sync-subscription, see 20260731000002) and the
// subscriptions table status values (active / cancelled / expired / pending).

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trial: 'Prueba',
  active: 'Activa',
  paid: 'Pagada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending: 'Pendiente',
}

export function subscriptionStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status
}
