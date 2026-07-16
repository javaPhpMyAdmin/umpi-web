import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Review } from '../types'

export function useReviews(listingId: string | undefined) {
  return useQuery({
    queryKey: ['reviews', listingId],
    queryFn: async () => {
      if (!listingId) return []
      const { data, error } = await supabase
        .from('reviews')
        .select('*, reviewer:reviewer_id(*)')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data as Review[]) || []
    },
    enabled: !!listingId,
  })
}
