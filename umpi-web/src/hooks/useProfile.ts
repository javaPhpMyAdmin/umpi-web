import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profiles', userId],
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)

      if (error) throw error
      return (data?.[0] as Profile) || null
    },
    enabled: !!userId,
  })
}
