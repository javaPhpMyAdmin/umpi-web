import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Listing } from '../types'

export function useUserListings(userId: string) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['listings', 'user', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Listing[]
    },
    enabled: !!userId,
  })

  const deleteMutation = useMutation({
    mutationFn: async (listingId: string) => {
      const { error } = await supabase
        .from('listings')
        .delete()
        .eq('id', listingId)
        .eq('user_id', userId) // Seguridad: solo borrar si es del usuario

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings', 'user', userId] })
    },
  })

  return {
    ...query,
    deleteListing: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  }
}
