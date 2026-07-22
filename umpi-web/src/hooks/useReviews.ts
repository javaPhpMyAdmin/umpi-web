import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
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

export function useHasReviewed(listingId: string | undefined) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['has-reviewed', listingId, session?.user?.id],
    queryFn: async () => {
      if (!listingId || !session?.user?.id) return false
      const { data } = await supabase
        .from('reviews')
        .select('id')
        .eq('listing_id', listingId)
        .eq('reviewer_id', session.user.id)
        .maybeSingle()
      return !!data
    },
    enabled: !!listingId && !!session?.user?.id,
  })
}

export function useCreateReview() {
  const queryClient = useQueryClient()
  const { session } = useAuth()

  return useMutation({
    mutationFn: async ({ listingId, rating }: { listingId: string; rating: number }) => {
      if (!session?.user?.id) throw new Error('Debes iniciar sesión')
      const { error } = await supabase.from('reviews').insert({
        listing_id: listingId,
        reviewer_id: session.user.id,
        rating,
      })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', variables.listingId] })
      queryClient.invalidateQueries({ queryKey: ['has-reviewed', variables.listingId] })
      queryClient.invalidateQueries({ queryKey: ['listing', variables.listingId] })
    },
  })
}
