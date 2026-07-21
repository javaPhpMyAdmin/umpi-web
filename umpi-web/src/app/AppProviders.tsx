/**
 * AppProviders — Root composition of all providers and routes.
 *
 * ARCHITECTURE (outermost → innermost):
 * 1. QueryClientProvider — TanStack Query cache for all data fetching
 * 2. AuthProvider — Global auth state (session, profile, mutations)
 * 3. BrowserRouter — Client-side routing
 * 4. Routes — Page composition with lazy loading per route
 *
 * ROUTE GUARDS:
 * - <GuestRoute>     → only for unauthenticated users (login, register)
 * - <ProtectedRoute> → only for authenticated users (publish, profile, messages)
 * - No guard          → public pages (home, explore, product detail)
 *
 * PERFORMANCE:
 * - React.lazy() splits each page into its own chunk
 * - Only the current route's code is downloaded on initial load
 * - Suspense shows a minimal shell while the chunk loads
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { lazy, Suspense, useState } from 'react'

import { AuthProvider } from '../contexts/AuthContext'
import ProtectedRoute from '../components/auth/ProtectedRoute'
import GuestRoute from '../components/auth/GuestRoute'
import Navbar from '../components/layout/Navbar'
import Footer from '../components/layout/Footer'

// Lazy-loaded page chunks
const HomePage = lazy(() => import('../features/listings/pages/HomePage'))
const ExplorePage = lazy(() => import('../features/listings/pages/ExplorePage'))
const ProductDetailPage = lazy(() => import('../features/listings/pages/ProductDetailPage'))
const FeaturedPage = lazy(() => import('../features/listings/pages/FeaturedPage'))
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage'))
const RegisterPage = lazy(() => import('../features/auth/pages/RegisterPage'))
const AuthCallbackPage = lazy(() => import('../features/auth/pages/AuthCallbackPage'))
const ProfilePage = lazy(() => import('../features/profile/pages/ProfilePage'))
const PlansPage = lazy(() => import('../features/subscriptions/pages/PlansPage'))
const PublishPage = lazy(() => import('../features/listings/pages/PublishPage'))
const EditPage = lazy(() => import('../features/listings/pages/EditPage'))
const MessagesPage = lazy(() => import('../features/messages/pages/MessagesPage'))
const NotificationsPage = lazy(() => import('../features/notifications/pages/NotificationsPage'))

// Minimal loading shell — renders instantly while chunks download
function PageShell() {
  return (
    <div className="bg-surface-container-low min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
      </main>
      <Footer />
    </div>
  )
}

export default function AppProviders() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutos
            gcTime: 1000 * 60 * 30, // 30 minutos
            retry: 2,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageShell />}>
            <Routes>
              {/* ── Public pages ─────────────────────────────────────────── */}
              <Route path="/" element={<HomePage />} />
              <Route path="/explorar" element={<ExplorePage />} />
              <Route path="/destacados" element={<FeaturedPage />} />
              <Route path="/producto/:id" element={<ProductDetailPage />} />

              {/* ── Guest-only pages (redirect to / if already logged in) ── */}
              <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
              <Route path="/registro" element={<GuestRoute><RegisterPage /></GuestRoute>} />

              {/* ── OAuth callback (no guard — Supabase handles the flow) ── */}
              <Route path="/auth/callback" element={<AuthCallbackPage />} />

              {/* ── Protected pages (redirect to /login if not authenticated) */}
              <Route path="/perfil" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/publicar" element={<ProtectedRoute><PublishPage /></ProtectedRoute>} />
              <Route path="/editar/:id" element={<ProtectedRoute><EditPage /></ProtectedRoute>} />
              <Route path="/mensajes" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
              <Route path="/notificaciones" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />

              {/* ── Semi-public (visible to all, but plans page may show CTA) */}
              <Route path="/planes" element={<PlansPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
