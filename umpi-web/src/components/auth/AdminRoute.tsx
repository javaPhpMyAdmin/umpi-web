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
 * - Auth session or profile still loading → spinner (no flash of wrong page)
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
  const { session, profile, isLoading } = useAuth()

  // Show spinner while checking auth AND while the profile loads — a legit
  // admin must never see a flash of the non-admin redirect.
  if (isLoading || (session && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    )
  }

  // Not logged in → redirect to login, preserve intended destination
  if (!session) {
    return <Navigate to="/login" state={{ from: '/administrador' }} replace />
  }

  // Logged in but not an admin → back to profile
  if (profile?.is_admin !== true) {
    return <Navigate to="/perfil" replace />
  }

  // Admin → render the protected content
  return <>{children}</>
}
