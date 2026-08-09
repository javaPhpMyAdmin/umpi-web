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

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  /** Current Supabase session (null if not logged in) */
  session:
    | Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']
    | null;
  /** User profile from the profiles table (null if not loaded or not logged in) */
  profile: Profile | null;
  /** Profile query error — non-null when the profiles row failed to load
   *  (e.g. network failure, missing row). Consumers can use this to render
   *  an escape path instead of an infinite spinner. */
  profileError: Error | null;
  /** True while the initial session is being loaded */
  isLoading: boolean;
  /** Send reset password email */
  resetPassword: (params: { email: string }) => Promise<void>;
  /** Update password after recovery link */
  updatePassword: (params: { password: string }) => Promise<void>;
  /** Email + password login */
  login: (params: { email: string; password: string }) => Promise<void>;
  /** Email + password registration */
  register: (params: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<void>;
  /** Magic link — sends OTP email for passwordless login/registration */
  sendMagicLink: (params: {
    email: string;
    fullName?: string;
  }) => Promise<void>;
  /** Google OAuth login */
  loginWithGoogle: () => Promise<void>;
  /** Sign out and clear all cached data */
  logout: () => Promise<void>;
  /** Mutation states */
  isLoggingIn: boolean;
  isRegistering: boolean;
  isLoggingInWithGoogle: boolean;
  isLoggingOut: boolean;
  isSendingMagicLink: boolean;
  isResettingPassword: boolean;
  isUpdatingPassword: boolean;
  /** Mutation errors */
  loginError: Error | null;
  registerError: Error | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient();

  // ── Session query ──────────────────────────────────────────────────────────
  // Fetches the current session on mount and when invalidated.
  // staleTime: 0 → always revalidates on refocus (keeps auth fresh).
  const { data: session, isLoading } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session;
    },
    staleTime: 0, // Auth should always be fresh
  });

  // ── Profile query ──────────────────────────────────────────────────────────
  // Only fetches when we have a logged-in user with an ID.
  // Uses the session user ID as a query key dependency — auto-refetches on login.
  const { data: rawProfile, error: profileError } = useQuery({
    queryKey: ['auth', 'profile', session?.user?.id],
    queryFn: async () => {
      if (!session?.user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (error) throw error;
      return data as Profile;
    },
    enabled: !!session?.user?.id,
  });

  // Fallback to Google avatar if profiles row lacks one
  const profile: Profile | null = rawProfile
    ? {
        ...rawProfile,
        avatar_url:
          rawProfile.avatar_url ||
          (session?.user?.user_metadata?.avatar_url as string | undefined) ||
          null,
      }
    : null;

  // ── Auth state change listener ─────────────────────────────────────────────
  // Keeps the query cache in sync across browser tabs and after OAuth redirects.
  // Without this, the session query would be stale after login/logout.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Update the session query cache directly — avoids a network round-trip
      queryClient.setQueryData(['auth', 'session'], session);

      // Invalidate profile to refetch with the new user ID
      queryClient.invalidateQueries({ queryKey: ['auth', 'profile'] });
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  // ── Login mutation ─────────────────────────────────────────────────────────
  const loginMutation = useMutation({
    mutationFn: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      // Sync Google avatar into profiles if missing
      const avatarUrl = data.user?.user_metadata?.avatar_url as
        | string
        | undefined;
      if (avatarUrl && data.user?.id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('avatar_url')
          .eq('id', data.user.id)
          .single();
        if (profileData && !profileData.avatar_url) {
          await supabase
            .from('profiles')
            .update({ avatar_url: avatarUrl })
            .eq('id', data.user.id);
        }
      }
    },
  });

  // ── Register mutation ──────────────────────────────────────────────────────
  const registerMutation = useMutation({
    mutationFn: async ({
      email,
      password,
      fullName,
    }: {
      email: string;
      password: string;
      fullName: string;
    }) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });
      if (error) throw error;

      // Profile creation is handled by the handle_new_user DB trigger
      // (AFTER INSERT on auth.users). The client is NOT allowed to insert
      // into profiles anymore (RLS) — fullName travels via user metadata
      // and the trigger persists it together with the trial assignment.
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

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
      });
      if (error) throw error;
      return data;
    },
  });

  // ── Magic Link mutation ──────────────────────────────────────────────────
  // Sends a one-time password link via email. Works for both new and existing users.
  // For new users the name travels via signUp user metadata; the
  // handle_new_user trigger creates the profile — nothing is stored
  // client-side anymore.
  const sendMagicLinkMutation = useMutation({
    mutationFn: async ({
      email,
      fullName,
    }: {
      email: string;
      fullName?: string;
    }) => {
      // Try signInWithOtp first (works for existing users)
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/confirmar-email`,
          data: { full_name: fullName },
        },
      });

      if (error) {
        // If user doesn't exist, create account first then send OTP
        if (
          error.message.includes('not found') ||
          error.message.includes('invalid')
        ) {
          const tempPassword = crypto.randomUUID();
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password: tempPassword,
            options: {
              data: { full_name: fullName },
            },
          });
          if (
            signUpError &&
            !signUpError.message.includes('already registered')
          ) {
            throw signUpError;
          }

          // Now send the OTP
          const { error: otpError } = await supabase.auth.signInWithOtp({
            email,
            options: {
              emailRedirectTo: `${window.location.origin}/confirmar-email`,
              data: { full_name: fullName },
            },
          });
          if (otpError) throw otpError;
          return;
        }
        throw error;
      }
    },
  });

  // ── Reset password mutation ──────────────────────────────────────────────
  // Sends a password reset email with a recovery link.
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/actualizar-contrasenia`,
      });
      if (error) throw error;
    },
  });

  // ── Update password mutation ─────────────────────────────────────────────
  // Called after user clicks the recovery link and sets a new password.
  const updatePasswordMutation = useMutation({
    mutationFn: async ({ password }: { password: string }) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  // ── Logout mutation ────────────────────────────────────────────────────────
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      // Clear all cached data — ensures no stale auth state leaks
      queryClient.clear();
    },
  });

  // ── Context value ──────────────────────────────────────────────────────────
  // Wrap mutateAsync calls to return void — consumers don't need mutation data
  const value: AuthContextValue = {
    session: session ?? null,
    profile,
    profileError,
    isLoading,
    login: async (params) => {
      await loginMutation.mutateAsync(params);
    },
    register: async (params) => {
      await registerMutation.mutateAsync(params);
    },
    sendMagicLink: async (params) => {
      await sendMagicLinkMutation.mutateAsync(params);
    },
    loginWithGoogle: async () => {
      await googleMutation.mutateAsync();
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    resetPassword: async (params) => {
      await resetPasswordMutation.mutateAsync(params);
    },
    updatePassword: async (params) => {
      await updatePasswordMutation.mutateAsync(params);
    },
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingInWithGoogle: googleMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
    isSendingMagicLink: sendMagicLinkMutation.isPending,
    isResettingPassword: resetPasswordMutation.isPending,
    isUpdatingPassword: updatePasswordMutation.isPending,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}
