import { Link } from 'react-router-dom'

const footerLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/explorar', label: 'Explorar' },
  { to: '/mensajes', label: 'Mensajes' },
  { to: '/perfil', label: 'Mi Perfil' },
  { to: '/publicar', label: 'Publicar' },
]

const helpLinks = [
  { href: '#', label: 'Ayuda' },
  { href: '#', label: 'Privacidad' },
]

export default function Footer() {
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
          {helpLinks.map((link) => (
            <a
              key={link.label}
              className="font-label-bold text-label-bold text-text-secondary hover:text-primary-container transition-colors cursor-pointer w-fit"
              href={link.href}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}
