/**
 * SubscriptionsSection — Active subscriptions overview for the admin panel.
 *
 * Lists the rows the admin_list_users RPC ships for active subscriptions:
 * payer email, plan name, status, start and expiry dates (es-AR).
 *
 * The RPC only returns rows with status = 'active', so an empty array is a
 * legit empty state (no active subscriptions yet, or a migrations-only
 * replay where the subscriptions tables are absent) — never treated as a
 * bug. expires_at is nullable, so the cell degrades to a muted dash.
 */

import { formatDate } from '../../../lib/utils'
import type { AdminSubscription } from '../../../types'

interface SubscriptionsSectionProps {
  subscriptions: AdminSubscription[]
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  pending: 'Pendiente',
}

const COLUMNS = ['Pagador', 'Plan', 'Estado', 'Inicio', 'Vence'] as const

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export default function SubscriptionsSection({ subscriptions }: SubscriptionsSectionProps) {
  return (
    <section className="mt-xxl">
      <div className="mb-lg">
        <h2 className="font-section-title text-section-title text-text-deep">
          Suscripciones activas
        </h2>
        <p className="font-body-base text-body-base text-text-secondary">
          Solo se muestran las suscripciones con estado activo
        </p>
      </div>

      {subscriptions.length === 0 ? (
        /* ── Empty state ─────────────────────────────────────────────── */
        <div className="bg-surface rounded-xl shadow-card p-xxl flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[56px] text-text-muted mb-4">
            membership
          </span>
          <h3 className="font-title-lg text-title-lg text-text-deep mb-1">
            No hay suscripciones activas
          </h3>
          <p className="font-body-base text-body-base text-text-secondary">
            Cuando alguien active un plan, la suscripción va a aparecer acá.
          </p>
        </div>
      ) : (
        /* ── Table ───────────────────────────────────────────────────── */
        <div className="bg-surface rounded-xl shadow-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-border-light">
                {COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="px-lg py-md font-small-subtext text-small-subtext text-text-muted uppercase tracking-wider whitespace-nowrap"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr
                  key={subscription.id}
                  className="border-b border-border-light/50 last:border-0 hover:bg-surface-container-low/50 transition-colors"
                >
                  {/* Pagador */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary">
                    {subscription.payer_email}
                  </td>

                  {/* Plan */}
                  <td className="px-lg py-md align-middle font-label-bold text-label-bold text-on-surface">
                    {subscription.plan_name}
                  </td>

                  {/* Estado */}
                  <td className="px-lg py-md align-middle">
                    <span className="inline-flex items-center gap-1 text-[12px] font-label-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                      {statusLabel(subscription.status)}
                    </span>
                  </td>

                  {/* Inicio */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary whitespace-nowrap">
                    {formatDate(subscription.started_at)}
                  </td>

                  {/* Vence */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary whitespace-nowrap">
                    {subscription.expires_at ? (
                      formatDate(subscription.expires_at)
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
