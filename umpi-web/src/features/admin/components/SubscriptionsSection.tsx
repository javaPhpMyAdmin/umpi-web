/**
 * SubscriptionsSection — Active subscriptions overview for the admin panel.
 *
 * Lists the rows the admin_list_users RPC ships for active subscriptions:
 * payer email, plan name, status, start and expiry dates (es-AR).
 *
 * The RPC only returns rows with status = 'active', so an empty array is a
 * legit empty state (no active subscriptions yet, or a migrations-only
 * replay where the subscriptions tables are absent) — never treated as a
 * bug. Both started_at (dump schema: DEFAULT now(), no NOT NULL) and
 * expires_at are nullable at runtime, so those cells degrade to a muted
 * dash. Status labels come from the shared SUBSCRIPTION_STATUS_LABELS map
 * (src/lib/subscription.ts); the badge derives its color from the actual
 * status instead of assuming active.
 */

import { formatDate } from '../../../lib/utils'
import { subscriptionStatusLabel } from '../../../lib/subscription'
import type { AdminSubscription } from '../../../types'

interface SubscriptionsSectionProps {
  subscriptions: AdminSubscription[]
}

const COLUMNS = ['Pagador', 'Plan', 'Estado', 'Inicio', 'Vence'] as const

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
                    <span
                      className={`inline-flex items-center gap-1 text-[12px] font-label-bold px-2 py-0.5 rounded-full ${
                        subscription.status === 'active'
                          ? 'bg-green-50 text-green-600'
                          : 'bg-surface-container-low text-text-secondary'
                      }`}
                    >
                      {subscriptionStatusLabel(subscription.status)}
                    </span>
                  </td>

                  {/* Inicio */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary whitespace-nowrap">
                    {subscription.started_at ? (
                      formatDate(subscription.started_at)
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
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
