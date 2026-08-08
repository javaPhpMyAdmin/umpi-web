/**
 * UsersTable — Registered users overview for the admin panel.
 *
 * Renders every column the admin_list_users RPC ships for a user: email,
 * full name, registration date, subscription state (plan + status + expiry),
 * trial window and active listings count. Hand-built Tailwind table (no
 * Table primitive per design) with Spanish UI strings.
 *
 * Null-safety: full_name, subscription_status, subscription_expires_at and
 * trial_ends_at are nullable, so every cell degrades to a muted dash or
 * label instead of crashing. The RPC can also return an empty array (e.g.
 * a migrations-only replay), which is a legit empty state, not a bug.
 */

import { formatDate } from '../../../lib/utils'
import type { AdminUser } from '../../../types'

interface UsersTableProps {
  users: AdminUser[]
}

const PLAN_LABELS: Record<string, string> = {
  premium: 'Premium',
  estandar: 'Estándar',
}

const STATUS_LABELS: Record<string, string> = {
  trial: 'Prueba',
  active: 'Activa',
  expired: 'Expirada',
  cancelled: 'Cancelada',
  pending: 'Pendiente',
}

const COLUMNS = ['Email', 'Nombre', 'Registro', 'Suscripción', 'Prueba', 'Avisos activos'] as const

function planLabel(type: string): string | null {
  if (!type) return null
  return PLAN_LABELS[type] ?? null
}

function statusLabel(status: string | null): string | null {
  if (!status) return null
  return STATUS_LABELS[status] ?? status
}

export default function UsersTable({ users }: UsersTableProps) {
  return (
    <section className="mt-xxl">
      <div className="flex items-center justify-between mb-lg">
        <div>
          <h2 className="font-section-title text-section-title text-text-deep">
            Usuarios
          </h2>
          <p className="font-body-base text-body-base text-text-secondary">
            {users.length} usuarios registrados
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        /* ── Empty state ─────────────────────────────────────────────── */
        <div className="bg-surface rounded-xl shadow-card p-xxl flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[56px] text-text-muted mb-4">
            group_off
          </span>
          <h3 className="font-title-lg text-title-lg text-text-deep mb-1">
            No hay usuarios para mostrar
          </h3>
          <p className="font-body-base text-body-base text-text-secondary">
            Cuando haya usuarios registrados, vas a verlos en esta tabla.
          </p>
        </div>
      ) : (
        /* ── Table ───────────────────────────────────────────────────── */
        <div className="bg-surface rounded-xl shadow-card overflow-x-auto">
          <table className="w-full min-w-[800px] text-left">
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
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border-light/50 last:border-0 hover:bg-surface-container-low/50 transition-colors"
                >
                  {/* Email */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary">
                    {user.email}
                  </td>

                  {/* Nombre */}
                  <td className="px-lg py-md align-middle font-label-bold text-label-bold text-on-surface">
                    {user.full_name || <span className="font-body-base text-text-muted">—</span>}
                  </td>

                  {/* Registro */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base text-text-secondary whitespace-nowrap">
                    {formatDate(user.created_at)}
                  </td>

                  {/* Suscripción */}
                  <td className="px-lg py-md align-middle">
                    {planLabel(user.subscription_type) ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-label-bold text-label-bold text-on-surface">
                          {planLabel(user.subscription_type)}
                        </span>
                        {statusLabel(user.subscription_status) && (
                          <span className="inline-flex w-fit items-center gap-1 text-[12px] font-label-bold px-2 py-0.5 rounded-full bg-bg-peach-soft text-primary-container">
                            {statusLabel(user.subscription_status)}
                          </span>
                        )}
                        {user.subscription_expires_at && (
                          <span className="font-small-subtext text-small-subtext text-text-muted whitespace-nowrap">
                            Vence {formatDate(user.subscription_expires_at)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="font-body-base text-body-base text-text-muted">
                        Sin plan
                      </span>
                    )}
                  </td>

                  {/* Prueba */}
                  <td className="px-lg py-md align-middle font-body-base text-body-base whitespace-nowrap">
                    {user.trial_ends_at ? (
                      <span
                        className={
                          new Date(user.trial_ends_at) > new Date()
                            ? 'text-text-secondary'
                            : 'text-text-muted'
                        }
                      >
                        {new Date(user.trial_ends_at) > new Date()
                          ? 'Prueba hasta'
                          : 'Finalizó'}{' '}
                        {formatDate(user.trial_ends_at)}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>

                  {/* Avisos activos */}
                  <td className="px-lg py-md align-middle font-label-bold text-label-bold text-on-surface">
                    {user.active_listings_count.toLocaleString('es-AR')}
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
