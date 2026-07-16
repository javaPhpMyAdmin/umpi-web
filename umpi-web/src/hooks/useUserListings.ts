import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Listing } from '../types'

export function useUserListings(userId: string) {
  return useQuery({
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
}
