/**
 * AppProviders — Root composition of all providers and routes.
 *
 * ARCHITECTURE (outermost → innermost):
 * 1. QueryClientProvider — TanStack Query cache for all data fetching
 * 2. AuthProvider — Global auth state (session, profile, mutations)
 * 3. BrowserRouter — Client-side routing
 * 4. Routes — Page composition with auth guards
 *
 * ROUTE GUARDS:
 * - <GuestRoute>     → only for unauthenticated users (login, register)
 * - <ProtectedRoute> → only for authenticated users (publish, profile, messages)
 * - No guard          → public pages (home, explore, product detail)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState } from 'react'

import { AuthProvider } from '../contexts/AuthContext'
import ProtectedRoute from '../components/auth/ProtectedRoute'
import GuestRoute from '../components/auth/GuestRoute'

import HomePage from '../features/listings/pages/HomePage'
import ExplorePage from '../features/listings/pages/ExplorePage'
import ProductDetailPage from '../features/listings/pages/ProductDetailPage'
import FeaturedPage from '../features/listings/pages/FeaturedPage'
import LoginPage from '../features/auth/pages/LoginPage'
import RegisterPage from '../features/auth/pages/RegisterPage'
import AuthCallbackPage from '../features/auth/pages/AuthCallbackPage'
import ProfilePage from '../features/profile/pages/ProfilePage'
import PlansPage from '../features/subscriptions/pages/PlansPage'
import PublishPage from '../features/listings/pages/PublishPage'
import MessagesPage from '../features/messages/pages/MessagesPage'

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
            <Route path="/mensajes" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />

            {/* ── Semi-public (visible to all, but plans page may show CTA) */}
            <Route path="/planes" element={<PlansPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
