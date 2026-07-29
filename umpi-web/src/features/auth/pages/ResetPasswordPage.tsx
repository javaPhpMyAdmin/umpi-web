import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const { resetPassword, isResettingPassword } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      await resetPassword({ email })
      setSent(true)
    } catch (err: any) {
      setError(err.message || 'Error al enviar el correo')
    }
  }

  return (
    <div className="font-body-base text-body-base text-on-surface antialiased min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative overflow-hidden bg-background min-h-[calc(100vh-64px-104px)]">
        {/* Decorative Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden flex justify-center items-center opacity-40">
          <div className="w-[800px] h-[800px] bg-primary-fixed-dim rounded-full blur-[120px] mix-blend-multiply translate-x-1/4 translate-y-1/4"></div>
          <div className="w-[600px] h-[600px] bg-primary-fixed rounded-full blur-[100px] mix-blend-multiply -translate-x-1/4 -translate-y-1/4"></div>
        </div>

        <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md p-8 sm:p-10 relative z-10 border border-border-light/50">
          {sent ? (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[56px] text-primary-container mb-4 block">
                mark_email_read
              </span>
              <h1 className="text-title-lg font-title-lg text-text-deep mb-2">Revisa tu email</h1>
              <p className="text-body-base font-body-base text-text-secondary mb-6">
                Te enviamos un link para restablecer tu contraseña a <strong className="text-on-surface">{email}</strong>.
              </p>
              <Link
                to="/login"
                className="text-primary-container font-label-bold text-[14px] hover:underline"
              >
                Volver al login
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-title-lg font-title-lg text-text-deep mb-2">Restablecer contraseña</h1>
                <p className="text-body-base font-body-base text-text-secondary">
                  Ingresá tu email y te enviamos un link para cambiarla.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex flex-col gap-sm">
                  <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="email">
                    Email
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                      mail
                    </span>
                    <input
                      className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none shadow-sm"
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@email.com"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isResettingPassword}
                  className="w-full h-[48px] flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-[0_4px_12px_rgba(255,107,53,0.25)] text-[15px] font-label-bold text-white bg-primary-container hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-container transition-colors items-center active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResettingPassword ? 'Enviando...' : 'Enviar link'}
                </button>

                {error && (
                  <div className="text-error-red text-sm text-center">{error}</div>
                )}
              </form>

              <div className="mt-6 text-center">
                <Link className="text-primary-container font-label-bold hover:underline text-[14px]" to="/login">
                  Volver al login
                </Link>
              </div>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
