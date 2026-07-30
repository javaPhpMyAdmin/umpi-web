import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'

/**
 * ConfirmEmailPage — handles the Magic Link callback.
 *
 * When user clicks the magic link in their email, Supabase redirects here
 * with auth tokens in the URL hash. detectSessionInURL (configured in supabase.ts)
 * extracts the session automatically.
 *
 * This page:
 * 1. Waits for the session to be available
 * 2. Creates the profile if it doesn't exist (new user)
 * 3. Redirects to home
 */
export default function ConfirmEmailPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const { session } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!session?.user) return

    const ensureProfile = async () => {
      try {
        // Check if profile already exists
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', session.user!.id)
          .single()

        if (!existing) {
          // New user — create profile from stored name or metadata
          const pendingName = localStorage.getItem('pending_profile_name')
          const fullName = pendingName
            || (session.user!.user_metadata?.full_name as string)
            || session.user!.email?.split('@')[0]
            || 'Usuario'

          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: session.user!.id,
              full_name: fullName,
              subscription_status: 'trial',
              trial_ends_at: (() => {
                const d = new Date();
                d.setDate(d.getDate() + 30);
                return d.toISOString();
              })(),
            })

          if (insertError && insertError.code !== '23505') {
            // 23505 = duplicate key (profile already exists, race condition)
            console.error('Error creating profile:', insertError)
          }

          localStorage.removeItem('pending_profile_name')
        }

        setStatus('success')
        setMessage('Cuenta verificada. Redirigiendo...')

        // Redirect to home after a brief delay
        setTimeout(() => navigate('/', { replace: true }), 1500)
      } catch (err: any) {
        console.error('Error in confirm-email:', err)
        setStatus('error')
        setMessage(err.message || 'Error al verificar tu cuenta')
      }
    }

    ensureProfile()
  }, [session, navigate])

  return (
    <div className="font-body-base text-body-base text-on-surface antialiased min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative overflow-hidden bg-background">
        {/* Decorative Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden flex justify-center items-center opacity-40">
          <div className="w-[800px] h-[800px] bg-primary-fixed-dim rounded-full blur-[120px] mix-blend-multiply translate-x-1/4 translate-y-1/4"></div>
          <div className="w-[600px] h-[600px] bg-primary-fixed rounded-full blur-[100px] mix-blend-multiply -translate-x-1/4 -translate-y-1/4"></div>
        </div>

        <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md p-8 sm:p-10 relative z-10 border border-border-light/50 text-center">
          {status === 'loading' && (
            <>
              <div className="w-10 h-10 border-2 border-primary-container border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h1 className="font-title-lg text-title-lg text-text-deep mb-2">Verificando tu email...</h1>
              <p className="font-body-base text-body-base text-text-secondary">
                Un momento mientras confirmamos tu cuenta.
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <span className="material-symbols-outlined text-[56px] text-green-500 mb-4 block">
                check_circle
              </span>
              <h1 className="font-title-lg text-title-lg text-text-deep mb-2">¡Cuenta verificada!</h1>
              <p className="font-body-base text-body-base text-text-secondary">
                {message}
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <span className="material-symbols-outlined text-[56px] text-error-red mb-4 block">
                error
              </span>
              <h1 className="font-title-lg text-title-lg text-text-deep mb-2">Error al verificar</h1>
              <p className="font-body-base text-body-base text-text-secondary mb-6">
                {message}
              </p>
              <button
                onClick={() => navigate('/registro', { replace: true })}
                className="w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors active:scale-[0.98]"
              >
                Intentar de nuevo
              </button>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}
