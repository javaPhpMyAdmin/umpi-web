import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface FeaturedRemaining {
  remaining: number
  maxFeatured: number
  activeFeatured: number
}

export function useFeaturedRemaining(planSlug: string | null | undefined) {
  const { session } = useAuth()

  return useQuery<FeaturedRemaining>({
    queryKey: ['featured-remaining', session?.user?.id, planSlug],
    queryFn: async () => {
      if (!session?.user?.id || !planSlug) {
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
    enabled: !!session?.user?.id && !!planSlug,
    staleTime: 30_000,
  })
}
