import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()
  const { updatePassword, isUpdatingPassword, session } = useAuth()

  // If user lands here without a session (no recovery token), redirect to login
  useEffect(() => {
    if (!session && !window.location.hash.includes('access_token')) {
      navigate('/login')
    }
  }, [session, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    try {
      await updatePassword({ password })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: any) {
      setError(err.message || 'Error al actualizar la contraseña')
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
          {success ? (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[56px] text-green-500 mb-4 block">
                check_circle
              </span>
              <h1 className="text-title-lg font-title-lg text-text-deep mb-2">Contraseña actualizada</h1>
              <p className="text-body-base font-body-base text-text-secondary">
                Tu contraseña se cambió correctamente. Redirigiendo al login...
              </p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-title-lg font-title-lg text-text-deep mb-2">Nueva contraseña</h1>
                <p className="text-body-base font-body-base text-text-secondary">
                  Ingresá tu nueva contraseña.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex flex-col gap-sm">
                  <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="password">
                    Nueva contraseña
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                      lock
                    </span>
                    <input
                      className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none shadow-sm"
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-sm">
                  <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="confirm-password">
                    Confirmar contraseña
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                      lock
                    </span>
                    <input
                      className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none shadow-sm"
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isUpdatingPassword}
                  className="w-full h-[48px] flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-[0_4px_12px_rgba(255,107,53,0.25)] text-[15px] font-label-bold text-white bg-primary-container hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-container transition-colors items-center active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpdatingPassword ? 'Actualizando...' : 'Actualizar contraseña'}
                </button>

                {error && (
                  <div className="text-error-red text-sm text-center">{error}</div>
                )}
              </form>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
