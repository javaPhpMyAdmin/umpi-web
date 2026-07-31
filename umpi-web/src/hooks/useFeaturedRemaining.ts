import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { isInTrial } from '../lib/subscription'

export interface FeaturedRemaining {
  remaining: number
  maxFeatured: number
  activeFeatured: number
}

// Mirrors the trial branch of the feature_listing RPC (v_max_featured := 10).
// Trial users are NOT in the subscriptions table; their counter lives on the
// profile (trial_featured_used, written by the RPC).
const TRIAL_MAX_FEATURED = 10

export function useFeaturedRemaining(planSlug: string | null | undefined) {
  const { session, profile } = useAuth()
  const inTrial = isInTrial(profile)

  return useQuery<FeaturedRemaining>({
    // trial_featured_used in the key: after feature_listing bumps the counter
    // server-side and the profile refetches, the key changes and the query
    // re-runs with a fresh profile instead of serving the stale cached value.
    queryKey: [
      'featured-remaining',
      session?.user?.id,
      planSlug,
      inTrial ? profile?.trial_featured_used ?? 0 : null,
    ],
    queryFn: async () => {
      if (!session?.user?.id) {
        return { remaining: 0, maxFeatured: 0, activeFeatured: 0 }
      }

      // Trial branch first — it wins over any paid plan, exactly like the
      // feature_listing RPC (trial check happens before the subscription
      // lookup).
      if (inTrial) {
        const activeFeatured = profile?.trial_featured_used ?? 0
        return {
          remaining: Math.max(0, TRIAL_MAX_FEATURED - activeFeatured),
          maxFeatured: TRIAL_MAX_FEATURED,
          activeFeatured,
        }
      }

      if (!planSlug) {
        return { remaining: 0, maxFeatured: 0, activeFeatured: 0 }
      }

      const [{ data: plan, error: planError }, { data: subscription, error: subscriptionError }] =
        await Promise.all([
          supabase
            .from('subscription_plans')
            .select('max_featured, featured_duration_days')
            .eq('slug', planSlug)
            .single(),
          supabase
            .from('subscriptions')
            .select('featured_used, period_start')
            .eq('user_id', session.user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

      if (planError) throw planError
      if (subscriptionError) throw subscriptionError

      const maxFeatured = plan?.max_featured ?? 0
      const durationDays = plan?.featured_duration_days ?? 0

      // Same period logic as the feature_listing RPC: once the billing period
      // rolls over, the used quota resets to 0. Featured listings from a
      // previous period stay active until featured_until but do NOT consume
      // credits from the new period.
      let activeFeatured = subscription?.featured_used ?? 0
      if (subscription?.period_start && durationDays > 0) {
        const periodEnds = new Date(subscription.period_start)
        periodEnds.setDate(periodEnds.getDate() + durationDays)
        if (periodEnds < new Date()) activeFeatured = 0
      }

      return {
        remaining: Math.max(0, maxFeatured - activeFeatured),
        maxFeatured,
        activeFeatured,
      }
    },
    enabled: !!session?.user?.id && (inTrial || !!planSlug),
    staleTime: 30_000,
  })
}
