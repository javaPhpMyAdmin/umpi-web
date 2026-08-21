import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/**
 * Mobile bridge shortcut: when a mobile user clicks a magic link, Supabase
 * redirects to /mobile-bridge?code=XXX. We render a tiny redirect page
 * WITHOUT importing AppProviders (and therefore without the Supabase client),
 * so detectSessionInUrl never tries to exchange the PKCE code. The bridge
 * page immediately redirects to umpi://confirm-email?code=XXX.
 */
if (window.location.pathname === '/mobile-bridge' && window.location.search.includes('code=')) {
  import('./features/auth/pages/MobileBridgePage').then(({ default: MobileBridgePage }) => {
    createRoot(document.getElementById('root')!).render(<MobileBridgePage />)
  })
} else {
  import('./app/AppProviders').then(({ default: AppProviders }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AppProviders />
      </StrictMode>,
    )
  })
}
