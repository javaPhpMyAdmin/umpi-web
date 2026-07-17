/**
 * AuthContext — Global authentication state for the app.
 *
 * WHY: Avoid prop drilling and redundant Supabase calls across components.
 * Uses TanStack Query for cache + Supabase onAuthStateChange for real-time sync.
 *
 * ARCHITECTURE:
 * - Session & profile are fetched via useQuery (cached, deduplicated)
 * - Mutations (login, register, google, logout) use useMutation
 * - onAuthStateChange keeps the query cache in sync across browser tabs
 * - AuthProvider wraps the app and exposes state via React Context
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** Current Supabase session (null if not logged in) */
  session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null
  /** User profile from the profiles table (null if not loaded or not logged in) */
  profile: Profile | null
  /** True while the initial session is being loaded */
  isLoading: boolean
  /** Email + password login */
  login: (params: { email: string; password: string }) => Promise<void>
  /** Email + password registration */
  register: (params: { email: string; password: string; fullName: string }) => Promise<void>
  /** Google OAuth login */
  loginWithGoogle: () => Promise<void>
  /** Sign out and clear all cached data */
  logout: () => Promise<void>
  /** Mutation states */
  isLoggingIn: boolean
  isRegistering: boolean
  isLoggingInWithGoogle: boolean
  isLoggingOut: boolean
  /** Mutation errors */
  loginError: Error | null
  registerError: Error | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient()

  // ── Session query ──────────────────────────────────────────────────────────
  // Fetches the current session on mount and when invalidated.
  // staleTime: 0 → always revalidates on refocus (keeps auth fresh).
  const { data: session, isLoading } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      return session
    },
    staleTime: 0, // Auth should always be fresh
  })

  // ── Profile query ──────────────────────────────────────────────────────────
  // Only fetches when we have a logged-in user with an ID.
  // Uses the session user ID as a query key dependency — auto-refetches on login.
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

  // ── Auth state change listener ─────────────────────────────────────────────
  // Keeps the query cache in sync across browser tabs and after OAuth redirects.
  // Without this, the session query would be stale after login/logout.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Update the session query cache directly — avoids a network round-trip
        queryClient.setQueryData(['auth', 'session'], session)

        // Invalidate profile to refetch with the new user ID
        queryClient.invalidateQueries({ queryKey: ['auth', 'profile'] })
      }
    )

    return () => subscription.unsubscribe()
  }, [queryClient])

  // ── Login mutation ─────────────────────────────────────────────────────────
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

  // ── Register mutation ──────────────────────────────────────────────────────
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

      // Crear perfil (will be handled by DB trigger in production,
      // but kept here as fallback for backward compatibility)
      if (data.user) {
        const avatarUrl = (data.user.user_metadata?.avatar_url as string | undefined) || null
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: data.user.id,
            full_name: fullName,
            avatar_url: avatarUrl,
          })

        // Ignore duplicate key error (trigger already created the profile)
        if (profileError && profileError.code !== '23505') throw profileError
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
    },
  })

  // ── Google OAuth mutation ──────────────────────────────────────────────────
  // Redirects to Google's consent screen. After auth, Supabase redirects back
  // to /auth/callback which exchanges the code for a session.
  const googleMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      })
      if (error) throw error
      return data
    },
  })

  // ── Logout mutation ────────────────────────────────────────────────────────
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
    onSuccess: () => {
      // Clear all cached data — ensures no stale auth state leaks
      queryClient.clear()
    },
  })

  // ── Context value ──────────────────────────────────────────────────────────
  // Wrap mutateAsync calls to return void — consumers don't need mutation data
  const value: AuthContextValue = {
    session: session ?? null,
    profile,
    isLoading,
    login: async (params) => { await loginMutation.mutateAsync(params) },
    register: async (params) => { await registerMutation.mutateAsync(params) },
    loginWithGoogle: async () => { await googleMutation.mutateAsync() },
    logout: async () => { await logoutMutation.mutateAsync() },
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingInWithGoogle: googleMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAuth — Access global auth state from any component.
 *
 * MUST be used inside <AuthProvider>.
 * Throws if used outside the provider (fail-fast in development).
 *
 * @example
 * const { session, profile, login, logout } = useAuth()
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>')
  }
  return context
}
