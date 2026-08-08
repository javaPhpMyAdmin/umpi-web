/**
 * useAdminUsers — Admin panel data via the admin_list_users RPC.
 *
 * WHY: the RPC is SECURITY DEFINER and reads auth.users (email + registration
 * date) plus subscription/listing joins — none of that is client-queryable
 * through PostgREST. Access control lives entirely server-side: the RPC raises
 * for unauthenticated callers and non-admins, so this hook never retries
 * (retry: false — a denial shouldn't be re-attempted).
 *
 * The query is gated by `enabled: !!session?.user?.id` so it never runs
 * without a session (AdminRoute already guarantees admin access at render
 * time; the gate is a belt-and-suspenders guard for the query layer).
 */

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import type { AdminUsersResponse } from '../types'

export function useAdminUsers() {
  const { session } = useAuth()

  return useQuery<AdminUsersResponse>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_users')

      if (error) throw error
      return data as AdminUsersResponse
    },
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    retry: false,
  })
}
