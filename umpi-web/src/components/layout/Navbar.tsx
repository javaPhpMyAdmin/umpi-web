import { Link, useLocation } from 'react-router-dom'

const navLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/explorar', label: 'Explorar' },
  { to: '/mensajes', label: 'Mensajes' },
  { to: '/perfil', label: 'Mi Perfil' },
]

export default function Navbar() {
  const location = useLocation()

  return (
    <header className="bg-surface sticky top-0 z-50 shadow-sm">
      <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop max-w-7xl mx-auto h-[72px]">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link to="/" className="font-display-lg text-display-lg font-extrabold text-primary-container" style={{ color: '#FF6B35' }}>
            Umpi
          </Link>
          {/* Navigation Links (Desktop) */}
          <nav className="hidden md:flex gap-6 items-center pt-1 h-full">
            {navLinks.map((link) => {
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`font-medium h-full flex items-center transition-colors duration-200 ${
                    isActive
                      ? 'text-primary-container border-b-2 border-primary-container font-bold pb-1'
                      : 'text-text-secondary hover:text-primary-dark'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Search Bar (Desktop) */}
        <div className="hidden md:flex flex-1 max-w-md mx-6">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary">
              search
            </span>
            <input
              className="w-full pl-10 pr-4 py-3 rounded-[14px] border border-border-light bg-surface focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all font-body-base text-body-base placeholder:text-text-muted text-on-surface"
              placeholder="Buscar productos, marcas y más..."
              type="text"
            />
          </div>
        </div>

        {/* Trailing Actions */}
        <div className="flex items-center gap-4">
          <Link
            to="/publicar"
            className="hidden md:flex bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors duration-150 ease-in-out active:scale-95 items-center justify-center min-h-[48px]"
          >
            Publicar
          </Link>
          <button className="text-text-secondary hover:text-primary-dark transition-colors duration-200 active:scale-95 duration-150 ease-in-out">
            <span className="material-symbols-outlined text-[28px]">account_circle</span>
          </button>
          {/* Mobile Menu Trigger */}
          <button className="md:hidden text-text-secondary hover:text-primary-dark transition-colors">
            <span className="material-symbols-outlined text-[28px]">menu</span>
          </button>
        </div>
      </div>

      {/* Mobile Search Bar */}
      <div className="md:hidden px-margin-mobile pb-4 w-full">
        <div className="relative w-full">
          <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary">
            search
          </span>
          <input
            className="w-full pl-10 pr-4 py-3 rounded-[14px] border border-border-light bg-surface focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all font-body-base text-body-base placeholder:text-text-muted text-on-surface"
            placeholder="Buscar..."
            type="text"
          />
        </div>
      </div>
    </header>
  )
}
