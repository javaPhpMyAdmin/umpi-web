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

      const [{ data: plan, error: planError }, { count, error: countError }] = await Promise.all([
        supabase
          .from('subscription_plans')
          .select('max_featured')
          .eq('slug', planSlug)
          .single(),
        supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .eq('is_featured', true),
      ])

      if (planError) throw planError
      if (countError) throw countError

      const maxFeatured = plan?.max_featured ?? 0
      const activeFeatured = count ?? 0

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
