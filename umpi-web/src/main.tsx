import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/**
 * Mobile bridge shortcut: when a mobile user clicks a magic link, Supabase
 * redirects to /mobile-bridge with auth data. We render a tiny bridge page
 * WITHOUT importing AppProviders (and therefore without the Supabase client),
 * so detectSessionInUrl never tries to consume the tokens/code.
 *
 * Detects both formats:
 * - PKCE:   ?code=XXX (query string)
 * - Implicit: #access_token=... (hash fragment)
 */
const isMobileBridge = window.location.pathname === '/mobile-bridge'
  && (window.location.search.includes('code=')
      || window.location.hash.includes('access_token'))

if (isMobileBridge) {
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
