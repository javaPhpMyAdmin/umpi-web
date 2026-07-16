import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState } from 'react'

import HomePage from '../features/listings/pages/HomePage'
import ExplorePage from '../features/listings/pages/ExplorePage'
import ProductDetailPage from '../features/listings/pages/ProductDetailPage'
import FeaturedPage from '../features/listings/pages/FeaturedPage'
import LoginPage from '../features/auth/pages/LoginPage'
import RegisterPage from '../features/auth/pages/RegisterPage'
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
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/explorar" element={<ExplorePage />} />
          <Route path="/destacados" element={<FeaturedPage />} />
          <Route path="/producto/:id" element={<ProductDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registro" element={<RegisterPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/planes" element={<PlansPage />} />
          <Route path="/publicar" element={<PublishPage />} />
          <Route path="/mensajes" element={<MessagesPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
