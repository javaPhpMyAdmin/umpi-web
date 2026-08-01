/**
 * LegalConsentGate — full-screen consent wall for logged-in users who have
 * not accepted the current legal version (see useLegalConsents hook).
 *
 * BEHAVIOR:
 * - Auth session still loading (not resolved) OR consents still loading →
 *   full-screen spinner (never flash gated content before the gate decides)
 * - Logged out (auth resolved, no session) → render children as-is
 * - Logged in + NOT accepted current version → full-screen gate: Navbar +
 *   centered card with a plain-language summary and "Aceptar y continuar".
 *   The legal pages (/terminos, /privacidad) are EXEMPT so the user can read
 *   the full documents before accepting — see EXEMPT_PATHS below.
 * - Logged in + accepted → render children as-is
 *
 * The gate renders a full screen, NOT a modal: the app is unusable until the
 * user decides, which is intentional for a legal requirement.
 *
 * SCOPE DECISION (documented): this gate is UX-level usage gating. The
 * server enforces the INTEGRITY of the acceptance record (version validated
 * against legal_consent_versions, accepted_at stamped server-side — see
 * record_legal_consent), but a modified client bundle could skip this wall
 * and still call the API. Full server-side usage enforcement (RLS checks on
 * core write tables) is a documented follow-up, deliberately not shipped
 * with this change.
 */
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Navbar from '../layout/Navbar'
import Footer from '../layout/Footer'
import { LEGAL_GATE_SUMMARY } from '../../features/legal/legalContent'
import { useLegalConsentGate } from '../../hooks/useLegalConsents'

/**
 * Paths the gate must NOT block. The legal pages need to be readable before
 * accepting; /auth/callback and /confirmar-email are Supabase redirect
 * landing pages that establish the session and navigate away themselves
 * (blocking them would trap the OAuth/magic-link flow in a loop); and
 * /actualizar-contrasenia is the password-recovery landing, where a user
 * following a reset link must not hit a consent wall mid-recovery.
 */
const EXEMPT_PATHS = new Set([
  '/terminos',
  '/privacidad',
  '/auth/callback',
  '/confirmar-email',
  '/actualizar-contrasenia',
])

export default function LegalConsentGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const {
    needsConsent,
    isChecking,
    queryError,
    refetch,
    recordConsent,
    isRecording,
    recordError,
  } = useLegalConsentGate()

  // react-router v7 matches '/terminos/' against route '/terminos', but the
  // exact-match Set misses the trailing slash — normalize before comparing.
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  if (EXEMPT_PATHS.has(pathname)) return <>{children}</>
  if (!needsConsent && !isChecking) return <>{children}</>

  return (
    <div className="font-body-base text-body-base text-on-surface antialiased min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-grow flex items-center justify-center p-margin-mobile md:p-margin-desktop relative bg-background">
        {isChecking ? (
          /* ── Loading: auth session and/or consents still loading ──────── */
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-10 h-10 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
            <p className="text-text-secondary">Verificando tu cuenta...</p>
          </div>
        ) : queryError ? (
          /* ── Error: consent records could not be fetched ─────────────── */
          <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md p-8 sm:p-10 relative border border-border-light/50 text-center">
            <span className="material-symbols-outlined text-[56px] text-error-red mb-4 block">
              error
            </span>
            <h1 className="font-title-lg text-title-lg text-text-deep mb-2">
              No pudimos verificar tus datos
            </h1>
            <p className="font-body-base text-body-base text-text-secondary mb-6">
              Ocurrió un error al consultar tu cuenta. Intentalo de nuevo.
            </p>
            <button
              onClick={() => refetch()}
              className="w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors active:scale-[0.98]"
            >
              Reintentar
            </button>
          </div>
        ) : (
          /* ── Gate: user must accept the current legal version ────────── */
          <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-lg p-8 sm:p-10 relative border border-border-light/50">
            <span className="material-symbols-outlined text-[48px] text-primary-container mb-4 block">
              verified_user
            </span>
            <h1 className="font-title-lg text-title-lg text-text-deep mb-3">
              Aceptá los términos para continuar
            </h1>
            <p className="font-body-base text-body-base text-text-secondary leading-relaxed mb-4">
              {LEGAL_GATE_SUMMARY}
            </p>
            <p className="font-body-base text-body-base text-text-secondary leading-relaxed mb-6">
              Podés leer los{' '}
              <Link to="/terminos" className="text-primary-container font-label-bold hover:underline">
                Términos y Condiciones
              </Link>{' '}
              y la{' '}
              <Link to="/privacidad" className="text-primary-container font-label-bold hover:underline">
                Política de Privacidad
              </Link>{' '}
              completos antes de continuar.
            </p>

            <button
              onClick={() => {
                // Error surfaces via recordError below; catch avoids an
                // unhandled promise rejection.
                void recordConsent().catch(() => {})
              }}
              disabled={isRecording}
              className="w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(255,107,53,0.25)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRecording ? (
                <>
                  Guardando...
                  <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
                </>
              ) : (
                <>
                  Aceptar y continuar
                  <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
                </>
              )}
            </button>

            {recordError && (
              <div className="text-error-red text-sm text-center mt-4">
                No se pudo guardar tu aceptación. Intentalo de nuevo.
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
