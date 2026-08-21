import { useEffect, useState } from 'react'

/**
 * MobileBridgePage — lightweight bridge for mobile magic link auth.
 *
 * Does NOT load the Supabase client (no detectSessionInUrl), so the PKCE
 * code is never consumed by the web. Simply shows a button that opens the
 * native app's deep link when tapped.
 *
 * Flow:
 * 1. Mobile app calls signInWithOtp with emailRedirectTo pointing here
 * 2. User clicks magic link → browser opens this page with ?code=XXX
 * 3. Page shows "Abrir en Umpi" button
 * 4. User taps button → native app opens via umpi:// deep link
 * 5. Native app exchanges the code with its own PKCE verifier
 */
export default function MobileBridgePage() {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCode(params.get('code'))
  }, [])

  const deepLink = code
    ? `umpi://confirm-email?code=${encodeURIComponent(code)}`
    : null

  if (code === null) {
    // Still loading params
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

  if (!code || !deepLink) {
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
