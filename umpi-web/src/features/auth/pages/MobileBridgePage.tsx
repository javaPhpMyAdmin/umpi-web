import { useEffect, useState } from 'react'

/**
 * MobileBridgePage — lightweight bridge for mobile magic link auth.
 *
 * Does NOT load the Supabase client (no detectSessionInUrl), so auth
 * tokens/code are never consumed by the web.
 *
 * Handles two Supabase redirect formats:
 * 1. PKCE:  ?code=XXX              → passes code to native app
 * 2. Implicit: #access_token=...&refresh_token=... → passes tokens to native app
 *
 * The native app's confirm-email.tsx handles both via resolveUrl().
 */
export default function MobileBridgePage() {
  const [deepLink, setDeepLink] = useState<string | null | undefined>(undefined) // undefined = loading

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hash = window.location.hash

    // 1. PKCE: ?code=XXX
    const code = params.get('code')
    if (code) {
      setDeepLink(`umpi://confirm-email?code=${encodeURIComponent(code)}`)
      return
    }

    // 2. Implicit: #access_token=...&refresh_token=...
    if (hash && hash.includes('access_token')) {
      const fragment = hash.substring(1) // remove #
      setDeepLink(`umpi://confirm-email?${fragment}`)
      return
    }

    // No auth data found
    setDeepLink(null)
  }, [])

  // Still loading
  if (deepLink === undefined) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ width: 40, height: 40, border: '3px solid #FF6B35', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>Cargando...</h1>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // Invalid link
  if (!deepLink) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>Link inválido</h1>
          <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
            No se encontró el código de verificación. Volvé a intentar desde la app.
          </p>
          <p style={{ fontSize: 14, marginTop: 16 }}>
            <a href="https://umpi.com.ar" style={{ color: '#FF6B35', fontWeight: 700 }}>Volver a Umpi</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ textAlign: 'center', padding: 32, maxWidth: 400 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>Abrí la app de Umpi</h1>
        <p style={{ fontSize: 14, color: '#666', marginTop: 8, marginBottom: 24 }}>
          Tocá el botón para iniciar sesión en la aplicación.
        </p>
        <a
          href={deepLink}
          style={{
            display: 'inline-block',
            background: '#FF6B35',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            textDecoration: 'none',
            padding: '14px 48px',
            borderRadius: 12,
          }}
        >
          Abrir en Umpi
        </a>
        <p style={{ fontSize: 12, color: '#999', marginTop: 24 }}>
          Si no tenés la app instalada, descargala desde tu tienda.
        </p>
      </div>
    </div>
  )
}
