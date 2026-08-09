/**
 * AdminRoute — Guard for the admin panel (/administrador).
 *
 * WHY STANDALONE (not wrapping ProtectedRoute): a wrapper would render the
 * page children while the profile is still loading, flashing a wrong redirect
 * for a legit admin (e.g. /perfil before profile.is_admin resolves). This
 * guard makes the admin check explicit and renders nothing until both the
 * session and the profile have resolved.
 *
 * BEHAVIOR:
 * - Auth session still loading → spinner (no flash of wrong page)
 * - Profile query failed (profileError) → error card with logout escape
 *   (never an infinite spinner — the profile is required to decide)
 * - Session present but profile still loading → spinner
 * - Not logged in → redirects to /login with the admin path in state
 * - Logged in but profile.is_admin !== true → redirects to /perfil
 * - Logged in admin → renders children
 *
 * The server remains the source of truth: admin_list_users() itself raises
 * for non-admins, so this guard is UX-level gating only.
 *
 * @example
 * <Route path="/administrador" element={<AdminRoute><AdminPage /></AdminRoute>} />
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { session, profile, profileError, isLoading, logout, isLoggingOut } =
    useAuth()

  // Show spinner only while the SESSION is being established.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    )
  }

  // Profile failed to load (network, missing row) — we cannot decide the
  // admin check, so give the user an explicit escape instead of a dead-end.
  // profileError can only be non-null when a session exists (the query is
  // enabled only with a user id).
  if (profileError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-on-surface">No pudimos cargar tu perfil.</p>
        <button
          onClick={() => void logout()}
          disabled={isLoggingOut}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {isLoggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </button>
      </div>
    )
  }

  // Not logged in → redirect to login, preserve intended destination
  if (!session) {
    return <Navigate to="/login" state={{ from: '/administrador' }} replace />
  }

  // Profile still loading (session exists) → spinner. A legit admin must
  // never see a flash of the non-admin redirect.
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    )
  }

  // Logged in but not an admin → back to profile
  if (profile.is_admin !== true) {
    return <Navigate to="/perfil" replace />
  }

  // Admin → render the protected content
  return <>{children}</>
}
