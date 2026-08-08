/**
 * AdminPage — Panel de Administración (owners only, see AdminRoute).
 *
 * Renders the admin surface for registered users and subscription/trial
 * state, backed by the admin_list_users RPC (SECURITY DEFINER — the
 * auth.users data it reads is not client-queryable).
 *
 * PHASE 2 (PR 2): page shell + StatsCards. The users table and subscriptions
 * overview mount in Phase 3 (PR 3) — see the TODO markers below.
 */

import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import { useAdminUsers } from '../../../hooks/useAdminUsers'
import StatsCards from '../components/StatsCards'

export default function AdminPage() {
  const { data, isLoading, isError, refetch } = useAdminUsers()

  return (
    <div className="bg-background min-h-screen flex flex-col font-body-base text-body-base text-on-surface">
      <Navbar />

      <main className="flex-grow w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl">
        {/* ── Page header ─────────────────────────────────────────────── */}
        <header className="mb-xxl">
          <h1 className="font-title-lg text-title-lg text-text-deep mb-sm">
            Panel de Administración
          </h1>
          <p className="font-body-base text-body-base text-text-secondary">
            Resumen de usuarios registrados y suscripciones
          </p>
        </header>

        {isLoading ? (
          /* ── Loading state ─────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-xxl gap-4 text-center">
            <div className="w-10 h-10 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
            <p className="text-text-secondary">Cargando datos del panel...</p>
          </div>
        ) : isError ? (
          /* ── Error state ───────────────────────────────────────────── */
          <div className="bg-surface rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] w-full max-w-md mx-auto p-8 sm:p-10 relative border border-border-light/50 text-center">
            <span className="material-symbols-outlined text-[56px] text-error-red mb-4 block">
              error
            </span>
            <h2 className="font-title-lg text-title-lg text-text-deep mb-2">
              No pudimos cargar el panel
            </h2>
            <p className="font-body-base text-body-base text-text-secondary mb-6">
              Ocurrió un error al consultar los datos. Intentá de nuevo.
            </p>
            <button
              onClick={() => refetch()}
              className="w-full h-[48px] rounded-lg bg-primary-container text-surface font-label-bold text-[15px] hover:bg-primary-dark transition-colors active:scale-[0.98]"
            >
              Reintentar
            </button>
          </div>
        ) : !data || data.stats.total_users === 0 ? (
          /* ── Empty state ───────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-xxl text-center">
            <span className="material-symbols-outlined text-[56px] text-text-muted mb-4">
              group_off
            </span>
            <h2 className="font-title-lg text-title-lg text-text-deep mb-1">
              Todavía no hay usuarios registrados
            </h2>
            <p className="font-body-base text-body-base text-text-secondary">
              Cuando alguien se registre, vas a ver las estadísticas acá.
            </p>
          </div>
        ) : (
          /* ── Data state ────────────────────────────────────────────── */
          <>
            {/* Stats overview */}
            <StatsCards stats={data.stats} />

            {/*
              PHASE 3 (PR 3) — panel detail mounts here:
              <UsersTable users={data.users} />
              <SubscriptionsSection subscriptions={data.subscriptions} />
            */}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}
