/**
 * useCities — Fetches active cities for location selection.
 *
 * WHY: Avoid hardcoding city names in the UI. Cities are managed in the
 * database and can be updated without code changes.
 *
 * CACHING: Uses TanStack Query default staleTime (5 min from QueryClient).
 * Cities rarely change, so this is effectively cached for the session.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { City } from '../types'

export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cities')
        .select('*')
        .order('name')

      if (error) throw error
      return data as City[]
    },
  })
}
