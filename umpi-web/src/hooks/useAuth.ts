import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: session, isLoading } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      return session
    },
  })

  const { data: rawProfile } = useQuery({
    queryKey: ['auth', 'profile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (error) throw error
      return data as Profile
    },
    enabled: !!session?.user?.id,
  })

  // Fallback to Google avatar if profiles row lacks one
  const profile: Profile | null = rawProfile
    ? {
        ...rawProfile,
        avatar_url:
          rawProfile.avatar_url ||
          (session?.user?.user_metadata?.avatar_url as string | undefined) ||
          null,
      }
    : null

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return data
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
      // Sync Google avatar into profiles if missing
      const avatarUrl = data.user?.user_metadata?.avatar_url as string | undefined
      if (avatarUrl && data.user?.id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', data.user.id)
          .single()
        if (profileData && !profileData.avatar_url) {
          await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', data.user.id)
        }
      }
    },
  })

  const registerMutation = useMutation({
    mutationFn: async ({ email, password, fullName }: { email: string; password: string; fullName: string }) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      })
      if (error) throw error

      // Crear perfil
      if (data.user) {
        const avatarUrl = (data.user.user_metadata?.avatar_url as string | undefined) || null
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            full_name: fullName,
            avatar_url: avatarUrl,
          })

        if (profileError) throw profileError
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.clear()
    },
  })

  return {
    session,
    profile,
    isLoading,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
  }
}
