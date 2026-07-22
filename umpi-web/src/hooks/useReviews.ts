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
    mutationFn: async ({ listingId, sellerId, rating }: { listingId: string; sellerId: string; rating: number }) => {
      if (!session?.user?.id) throw new Error('Debes iniciar sesión')

      // Find existing conversation between current user and seller for this listing
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('listing_id', listingId)
        .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
        .or(`user1_id.eq.${sellerId},user2_id.eq.${sellerId}`)
        .limit(1)
        .maybeSingle()

      if (convError || !conv?.id) {
        throw new Error('Debes haber contactado al publicador antes de calificar')
      }

      const { error } = await supabase.from('reviews').insert({
        listing_id: listingId,
        reviewer_id: session.user.id,
        conversation_id: conv.id,
        rating,
      })
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', variables.listingId] })
      queryClient.invalidateQueries({ queryKey: ['has-reviewed', variables.listingId] })
      queryClient.invalidateQueries({ queryKey: ['listings', variables.listingId] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
    },
  })
}
