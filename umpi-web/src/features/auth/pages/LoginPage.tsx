import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { login, loginWithGoogle, isLoggingIn, isLoggingInWithGoogle, loginError } = useAuth()

  // Where to redirect after login — preserves the intended destination
  // when user was redirected from a protected route
  const redirectTo = (location.state as { from?: string })?.from || '/'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login({ email, password })
      navigate(redirectTo)
    } catch (error) {
      console.error('Error al iniciar sesión:', error)
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

        {/* Auth Card */}
        <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md p-8 sm:p-10 relative z-10 border border-border-light/50">
          <div className="text-center mb-8">
            <h1 className="text-title-lg font-title-lg text-text-deep mb-2">Iniciar Sesión</h1>
            <p className="text-body-base font-body-base text-text-secondary">
              Bienvenido de nuevo a tu barrio.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
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
                  className="w-full h-[48px] rounded-lg border border-border-light pl-11 pr-4 bg-surface font-body-base text-body-base text-on-surface placeholder:text-text-muted focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all outline-none shadow-sm"
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {/* Remember & Forgot */}
            <div className="flex items-center justify-between mt-4 mb-6">
              <div className="flex items-center gap-3 h-5">
                <input
                  className="w-5 h-5 rounded-[4px] border-border-light text-primary-container focus:ring-primary-container focus:ring-offset-surface cursor-pointer"
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <label className="font-body-base text-[13px] leading-tight text-text-secondary cursor-pointer" htmlFor="remember-me">
                  Recuérdame
                </label>
              </div>
              <div className="text-sm">
                <a className="font-label-bold text-[13px] text-primary-container hover:underline transition-colors" href="#">
                  ¿Olvidé mi contraseña?
                </a>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="mt-4 w-full h-[48px] flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-[0_4px_12px_rgba(255,107,53,0.25)] text-[15px] font-label-bold text-white bg-primary-container hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-container transition-colors items-center active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>

            {loginError && (
              <div className="text-error-red text-sm text-center">
                {loginError.message}
              </div>
            )}
          </form>

          {/* Divider */}
          <div className="mt-6 flex flex-col gap-4">
            <div className="relative flex items-center justify-center">
              <div className="flex-grow border-t border-border-light"></div>
              <span className="px-3 text-text-muted text-[12px] font-medium bg-surface">O continuar con</span>
              <div className="flex-grow border-t border-border-light"></div>
            </div>

            {/* Google Button */}
            <button
              type="button"
              onClick={() => loginWithGoogle()}
              disabled={isLoggingInWithGoogle}
              className="w-full h-[48px] rounded-lg border border-border-light bg-surface flex items-center justify-center gap-3 hover:bg-surface-container-low transition-all active:scale-[0.98] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Register Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-text-secondary">
              ¿No tienes cuenta?{' '}
              <Link className="text-primary-container font-label-bold hover:underline ml-1" to="/registro">
                Regístrate
              </Link>
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
