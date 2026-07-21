/**
 * Navbar — Top navigation bar with auth-aware actions.
 *
 * BEHAVIOR:
 * - Not logged in → shows "Iniciar Sesión" link
 * - Logged in → shows user avatar + "Cerrar Sesión" button
 * - Always shows: brand, nav links, search bar, "Publicar" button
 * - Mobile: hamburger menu opens a slide-in drawer with all nav links
 */

import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useNotificationCount, useRealtimeNotifications } from '../../hooks/useNotifications'
import Avatar from '../ui/Avatar'

const navLinks = [
  { to: '/', label: 'Inicio', icon: 'home' },
  { to: '/explorar', label: 'Explorar', icon: 'explore' },
  { to: '/destacados', label: 'Destacados', icon: 'star' },
  { to: '/mensajes', label: 'Mensajes', icon: 'chat', protected: true },
  { to: '/perfil', label: 'Mi Perfil', icon: 'person', protected: true },
  { to: '/notificaciones', label: 'Notificaciones', icon: 'notifications', protected: true },
]

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, profile, logout, isLoggingOut } = useAuth()
  const { data: unreadCount } = useNotificationCount(session?.user?.id)
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Realtime: badge updates instantly when new notifications arrive
  useRealtimeNotifications(session?.user?.id || null)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  const handleLogout = async () => {
    setMobileMenuOpen(false)
    await logout()
    navigate('/')
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    if (trimmed) {
      navigate(`/explorar?q=${encodeURIComponent(trimmed)}`)
      setSearchQuery('')
    }
  }

  return (
    <header className="bg-surface sticky top-0 z-50 shadow-sm">
      <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop max-w-7xl mx-auto h-[72px]">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[28px]" style={{ color: '#FF6B35' }}>storefront</span>
            <span className="font-display-lg text-display-lg font-extrabold text-primary-container" style={{ color: '#FF6B35' }}>Umpi</span>
          </Link>
          {/* Navigation Links (Desktop) */}
          <nav className="hidden md:flex gap-6 items-center pt-1 h-full">
            {navLinks.map((link) => {
              if (link.protected && !session) return null

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
          <form onSubmit={handleSearch} className="relative w-full">
            <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary">
              search
            </span>
            <input
              className="w-full pl-10 pr-4 py-3 rounded-[14px] border border-border-light bg-surface focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all font-body-base text-body-base placeholder:text-text-muted text-on-surface"
              placeholder="Buscar productos, marcas y más..."
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
        </div>

        {/* Trailing Actions */}
        <div className="flex items-center gap-4">
          {session ? (
            <>
              {/* Publish button — desktop only */}
              <Link
                to="/publicar"
                className="hidden md:flex bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors duration-150 ease-in-out active:scale-95 items-center justify-center min-h-[48px]"
              >
                Publicar
              </Link>

              {/* Notification bell — desktop only */}
              <button
                onClick={() => navigate('/notificaciones')}
                className="relative hidden md:flex text-text-secondary hover:text-primary-dark transition-colors"
                title="Notificaciones"
              >
                <span className="material-symbols-outlined text-[24px]">
                  notifications
                </span>
                {unreadCount != null && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-[#E8752A] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* User avatar — desktop only */}
              <button
                onClick={() => navigate('/perfil')}
                className="relative group hidden md:flex"
              >
                <Avatar
                  src={profile?.avatar_url}
                  name={profile?.full_name}
                  size={36}
                  className="border-2 border-border-light group-hover:border-primary-container transition-colors"
                />
              </button>

              {/* Logout — desktop only */}
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="hidden md:flex text-text-secondary hover:text-primary-dark transition-colors duration-200 active:scale-95 disabled:opacity-50"
                title="Cerrar sesión"
              >
                <span className="material-symbols-outlined text-[28px]">
                  {isLoggingOut ? 'sync' : 'logout'}
                </span>
              </button>
            </>
          ) : (
            /* Login link — desktop only */
            <Link
              to="/login"
              className="hidden md:flex bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors duration-150 ease-in-out active:scale-95 items-center justify-center min-h-[48px]"
            >
              Iniciar Sesión
            </Link>
          )}

          {/* Mobile Menu Trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-text-secondary hover:text-primary-dark transition-colors p-1"
            aria-label="Menu"
          >
            <span className="material-symbols-outlined text-[28px]">
              {mobileMenuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Search Bar */}
      <div className="md:hidden px-margin-mobile pb-4 w-full">
        <form onSubmit={handleSearch} className="relative w-full">
          <span className="material-symbols-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary">
            search
          </span>
          <input
            className="w-full pl-10 pr-4 py-3 rounded-[14px] border border-border-light bg-surface focus:border-primary-container focus:ring-1 focus:ring-primary-container outline-none transition-all font-body-base text-body-base placeholder:text-text-muted text-on-surface"
            placeholder="Buscar..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </form>
      </div>

      {/* ── Mobile Menu Overlay ─────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ── Mobile Menu Drawer ─────────────────────────────────────────────── */}
      <div
        className={`fixed top-[72px] right-0 w-[280px] max-w-[80vw] h-[calc(100vh-72px)] bg-surface z-50 md:hidden shadow-[-4px_0_24px_rgba(0,0,0,0.12)] transform transition-transform duration-300 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <nav className="flex flex-col p-6 gap-1">
          {/* User info (logged in) */}
          {session && (
            <div className="flex items-center gap-3 pb-4 mb-2 border-b border-border-light">
              <Avatar
                src={profile?.avatar_url}
                name={profile?.full_name}
                size={40}
              />
              <div className="flex flex-col min-w-0">
                <span className="font-label-bold text-label-bold text-on-surface truncate">
                  {profile?.full_name || 'Mi perfil'}
                </span>
                <span className="text-[11px] text-text-muted truncate">
                  {session.user.email}
                </span>
              </div>
            </div>
          )}

          {/* Publish CTA (logged in) */}
          {session && (
            <Link
              to="/publicar"
              className="flex items-center gap-3 bg-primary-container text-white px-4 py-3 rounded-[12px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors mb-3 active:scale-[0.98]"
            >
              <span className="material-symbols-outlined text-[20px]">add_circle</span>
              Publicar aviso
            </Link>
          )}

          {/* Nav links */}
          {navLinks.map((link) => {
            if (link.protected && !session) return null
            const isActive = location.pathname === link.to
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-3 px-3 py-3 rounded-[10px] transition-colors ${
                  isActive
                    ? 'bg-bg-peach-soft text-primary-container font-bold'
                    : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined text-[22px]">{link.icon}</span>
                <span className="font-body-base text-[15px]">{link.label}</span>
              </Link>
            )
          })}

          {/* Login / Logout */}
          <div className="mt-2 pt-3 border-t border-border-light">
            {session ? (
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-[10px] text-error-red hover:bg-red-50 transition-colors active:scale-[0.98] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[22px]">
                  {isLoggingOut ? 'sync' : 'logout'}
                </span>
                <span className="font-body-base text-[15px]">
                  {isLoggingOut ? 'Cerrando...' : 'Cerrar sesión'}
                </span>
              </button>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-3 px-3 py-3 rounded-[10px] text-primary-container hover:bg-bg-peach-soft transition-colors active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-[22px]">login</span>
                <span className="font-body-base text-[15px]">Iniciar Sesión</span>
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}
