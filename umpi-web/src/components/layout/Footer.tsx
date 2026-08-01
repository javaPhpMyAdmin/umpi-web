import { useState } from 'react'
import { Link } from 'react-router-dom'

const footerLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/explorar', label: 'Explorar' },
  { to: '/mensajes', label: 'Mensajes' },
  { to: '/perfil', label: 'Mi Perfil' },
  { to: '/publicar', label: 'Publicar' },
]

const helpLinks: Array<{ label: string; to?: string; href?: string }> = [
  { to: '/terminos', label: 'Términos y Condiciones' },
  { to: '/privacidad', label: 'Privacidad' },
]

const contactInfo = {
  phone: '+54 9 2942 56-2807',
  phoneHref: 'tel:+542942562807',
  email: 'info@umpi.com.ar',
  emailHref: 'mailto:info@umpi.com.ar',
}

export default function Footer() {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <footer className="bg-surface-container border-t border-outline-variant w-full mt-auto">
      <div className="w-full py-lg px-margin-desktop grid grid-cols-1 md:grid-cols-4 gap-gutter max-w-7xl mx-auto">
        {/* Brand Column */}
        <div className="flex flex-col gap-2">
          <div className="font-section-title text-section-title font-bold text-primary-container" style={{ color: '#FF6B35' }}>
            Umpi
          </div>
          <p className="font-small-subtext text-small-subtext text-text-secondary">
            © 2026 Umpi S.R.L. Hecho en Argentina.
          </p>
        </div>

        {/* Links Column */}
        <div className="flex flex-col gap-2">
          {footerLinks.slice(0, 3).map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Links Column */}
        <div className="flex flex-col gap-2">
          {footerLinks.slice(3).map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Links Column */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            aria-expanded={helpOpen}
            className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit flex items-center gap-1 text-left"
          >
            Ayuda
            <span
              className={`material-symbols-outlined text-[16px] transition-transform duration-200 ${
                helpOpen ? 'rotate-180' : ''
              }`}
            >
              expand_more
            </span>
          </button>

          {helpOpen && (
            <div className="flex flex-col gap-2">
              <a
                href={contactInfo.phoneHref}
                className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">call</span>
                {contactInfo.phone}
              </a>
              <a
                href={contactInfo.emailHref}
                className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">mail</span>
                {contactInfo.email}
              </a>
            </div>
          )}

          {helpLinks.map((link) =>
            link.to ? (
              <Link
                key={link.label}
                to={link.to}
                className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit"
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit"
                href={link.href}
              >
                {link.label}
              </a>
            )
          )}
        </div>
      </div>
    </footer>
  )
}
