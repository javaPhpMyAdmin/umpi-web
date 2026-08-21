import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'
import { isDisposableEmail } from '../../../lib/blockedEmails'

const CONSENT_REQUIRED_ERROR =
  'Tenés que aceptar los términos y condiciones y la política de privacidad para continuar'

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  // Honeypot — bots auto-fill this, humans never see it
  const [website, setWebsite] = useState('')
  // Legal consent — required before creating the account
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const { sendMagicLink, isSendingMagicLink, loginWithGoogle, isLoggingInWithGoogle } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Honeypot: bots auto-fill hidden fields, humans never touch them
    if (website) return

    if (!acceptedTerms) {
      setError(CONSENT_REQUIRED_ERROR)
      return
    }

    if (isDisposableEmail(email)) {
      setError('No se permiten emails temporales. Usá tu correo real.')
      return
    }

    try {
      await sendMagicLink({ email, fullName })
      setMagicLinkSent(true)
    } catch (err: any) {
      setError(err.message || 'Error al enviar el link mágico')
    }
  }

  const handleGoogle = async () => {
    setError('')

    if (!acceptedTerms) {
      setError(CONSENT_REQUIRED_ERROR)
      return
    }

    try {
      await loginWithGoogle()
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión con Google')
    }
  }

  return (
    <div className="font-body-base text-body-base text-on-surface antialiased min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative overflow-hidden bg-background">
        {/* Decorative Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden flex justify-center items-center opacity-40">
          <div className="w-[800px] h-[800px] bg-primary-fixed-dim rounded-full blur-[120px] mix-blend-multiply translate-x-1/4 translate-y-1/4"></div>
          <div className="w-[600px] h-[600px] bg-primary-fixed rounded-full blur-[100px] mix-blend-multiply -translate-x-1/4 -translate-y-1/4"></div>
        </div>

        {/* Registration Card */}
        <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md p-8 sm:p-10 relative z-10 border border-border-light/50">
          {magicLinkSent ? (
            /* ── Magic link sent state ─────────────────────── */
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[56px] text-primary-container mb-4 block">
                mark_email_read
              </span>
              <h1 className="font-title-lg text-title-lg text-text-deep mb-2">Revisá tu email</h1>
              <p className="font-body-base text-body-base text-text-secondary mb-6">
                Te enviamos un link mágico a <strong className="text-on-surface">{email}</strong>. Hacé click en el link para crear tu cuenta.
              </p>

              {error && (
                <div className="text-error-red text-sm text-center mb-4">
                  {error}
                </div>
              )}

              <button
                onClick={() => { setMagicLinkSent(false); setEmail(''); setFullName(''); setError('') }}
                className="text-primary-container font-label-bold text-[14px] hover:underline"
              >
                Volver al registro
              </button>
            </div>
          ) : (
            /* ── Registration form ─────────────────────────────── */
            <>
              <div className="text-center mb-8">
                <h1 className="font-title-lg text-title-lg text-text-deep mb-2">Crear cuenta</h1>
                <p className="font-body-base text-body-base text-text-secondary">
                  Únete a tu comunidad de Umpi
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {/* Full Name */}
                <div className="flex flex-col gap-sm">
                  <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="fullname">
                    Nombre Completo
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                      person
                    </span>
                    <input
                      className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none"
                      id="fullname"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ej. María López"
                      required
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="flex flex-col gap-sm">
                  <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="email">
                    Correo electrónico
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                      mail
                    </span>
                    <input
                      className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none"
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@correo.com"
                      required
                    />
                  </div>
                </div>

                {/* Honeypot — invisible to humans, bots auto-fill it */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    height: 0,
                    width: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                {/* Legal consent checkbox */}
                <div className="flex items-start gap-3">
                  <input
                    id="accepted-terms"
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary-container cursor-pointer"
                  />
                  <label
                    htmlFor="accepted-terms"
                    className="font-body-base text-body-base text-text-secondary leading-relaxed cursor-pointer select-none"
                  >
                    Acepto los{' '}
                    <Link
                      to="/terminos"
                      className="text-primary-container font-label-bold hover:underline"
                    >
                      Términos y Condiciones
                    </Link>{' '}
                    y la{' '}
                    <Link
                      to="/privacidad"
                      className="text-primary-container font-label-bold hover:underline"
                    >
                      Política de Privacidad
                    </Link>
                  </label>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSendingMagicLink}
                  className="mt-4 w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,107,53,0.25)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSendingMagicLink ? 'Enviando...' : 'Enviar link mágico'}
                  <span className="material-symbols-outlined text-[20px]">mail</span>
                </button>

                {error && (
                  <div className="text-error-red text-sm text-center">
                    {error}
                  </div>
                )}
              </form>

              {/* Divider */}
              <div className="mt-6 flex flex-col gap-4">
                <div className="relative flex items-center justify-center">
                  <div className="flex-grow border-t border-border-light"></div>
                  <span className="px-3 text-text-muted text-[12px] font-medium bg-surface">O regístrate con</span>
                  <div className="flex-grow border-t border-border-light"></div>
                </div>

                {/* Google Button */}
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isLoggingInWithGoogle}
                  className="w-full h-[48px] rounded-lg border border-border-light bg-surface flex items-center justify-center gap-3 hover:bg-surface-container-low transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"></path>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                  </svg>
                  <span className="text-on-surface font-label-bold text-[15px]">Continuar con Google</span>
                </button>
              </div>

              {/* Login Link */}
              <div className="mt-6 text-center">
                <p className="text-sm text-text-secondary">
                  ¿Ya tienes una cuenta?{' '}
                  <Link className="text-primary-container font-label-bold hover:underline ml-1" to="/login">
                    Inicia sesión
                  </Link>
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
