/**
 * StatsCards — Admin overview stat cards (totales / hoy / esta semana).
 *
 * Renders the three headline numbers from AdminStats. Hand-built Tailwind
 * following the dashboard stat-card idiom used across the app (icon chip,
 * big number, small label) — no Table/shared primitive.
 */

import type { AdminStats } from '../../../types'

interface StatsCardsProps {
  stats: AdminStats
}

const CARDS = [
  {
    key: 'total_users',
    label: 'Usuarios totales',
    icon: 'group',
    accent: 'bg-bg-peach-soft text-primary-container',
  },
  {
    key: 'new_users_today',
    label: 'Nuevos hoy',
    icon: 'person_add',
    accent: 'bg-green-50 text-green-600',
  },
  {
    key: 'new_users_this_week',
    label: 'Nuevos esta semana',
    icon: 'trending_up',
    accent: 'bg-gold-premium/10 text-gold-premium',
  },
] as const

export default function StatsCards({ stats }: StatsCardsProps) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-lg">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="bg-surface p-xl rounded-xl shadow-card flex flex-col gap-sm"
        >
          <span
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.accent}`}
          >
            <span className="material-symbols-outlined text-[22px]">
              {card.icon}
            </span>
          </span>
          <span className="font-display-lg text-display-lg text-text-deep leading-tight">
            {stats[card.key].toLocaleString('es-AR')}
          </span>
          <span className="font-small-subtext text-small-subtext text-text-secondary">
            {card.label}
          </span>
        </div>
      ))}
    </section>
  )
}
