/**
 * GuestRoute — Auth guard for routes only guests can access (login, register).
 *
 * WHY: Prevents logged-in users from seeing the login/register pages.
 * If a user navigates to /login while authenticated, redirect them to /.
 *
 * BEHAVIOR:
 * - Loading → shows spinner
 * - Authenticated → redirects to / (or to the "from" path if provided)
 * - Not authenticated → renders children
 *
 * @example
 * <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface GuestRouteProps {
  children: React.ReactNode
}

export default function GuestRoute({ children }: GuestRouteProps) {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  // Where to redirect if already logged in
  const redirectTo = (location.state as { from?: string })?.from || '/'

  // Show spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    )
  }

  // Already logged in → redirect away from login/register
  if (session) {
    return <Navigate to={redirectTo} replace />
  }

  // Guest → render the login/register page
  return <>{children}</>
}
