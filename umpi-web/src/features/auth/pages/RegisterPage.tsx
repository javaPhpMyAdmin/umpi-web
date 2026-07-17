import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'

export default function RegisterPage() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { register, loginWithGoogle, isRegistering, isLoggingInWithGoogle, registerError } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    if (!acceptTerms) {
      setError('Debes aceptar los términos y condiciones')
      return
    }

    try {
      await register({ email, password, fullName })
      navigate('/')
    } catch (err) {
      console.error('Error al registrarse:', err)
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

            {/* Password */}
            <div className="flex flex-col gap-sm">
              <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="password">
                Contraseña
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                  lock
                </span>
                <input
                  className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none"
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-sm">
              <label className="font-label-bold text-label-bold text-on-surface-variant" htmlFor="confirm_password">
                Confirmar contraseña
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
                  lock_reset
                </span>
                <input
                  className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none"
                  id="confirm_password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {/* Terms */}
            <div className="flex items-start gap-3 mt-2">
              <div className="flex items-center h-5">
                <input
                  className="w-5 h-5 rounded-[4px] border-border-light text-primary-container focus:ring-primary-container focus:ring-offset-surface cursor-pointer"
                  id="terms"
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  required
                />
              </div>
              <label className="font-body-base text-[13px] leading-tight text-text-secondary cursor-pointer" htmlFor="terms">
                Acepto los{' '}
                <a className="text-primary-container hover:underline font-medium" href="#">
                  Términos y Condiciones
                </a>{' '}
                y la{' '}
                <a className="text-primary-container hover:underline font-medium" href="#">
                  Política de Privacidad
                </a>{' '}
                de Umpi.
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isRegistering}
              className="mt-4 w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,107,53,0.25)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRegistering ? 'Creando cuenta...' : 'Crear cuenta'}
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>

            {(error || registerError) && (
              <div className="text-error-red text-sm text-center">
                {error || registerError?.message}
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
              onClick={() => loginWithGoogle()}
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
        </div>
      </main>

      <Footer />
    </div>
  )
}
