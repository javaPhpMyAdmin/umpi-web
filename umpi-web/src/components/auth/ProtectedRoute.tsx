/**
 * ProtectedRoute — Auth guard for routes that require authentication.
 *
 * WHY: Centralizes the "is user logged in?" check so every protected page
 * doesn't need to repeat this logic. Handles loading state gracefully.
 *
 * BEHAVIOR:
 * - Loading → shows spinner (no flash of login page)
 * - Not authenticated → redirects to /login with return path in state
 * - Authenticated → renders children
 *
 * The return path is stored in location.state so the login page can redirect
 * back after successful auth (deep link preservation).
 *
 * @example
 * <Route path="/publicar" element={<ProtectedRoute><PublishPage /></ProtectedRoute>} />
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  // Show spinner while checking auth — prevents flash of login page
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary-container border-t-transparent rounded-full" />
      </div>
    )
  }

  // Not logged in → redirect to login, preserve intended destination
  if (!session) {
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname }}
        replace
      />
    )
  }

  // Authenticated → render the protected content
  return <>{children}</>
}
