/**
 * Navbar — Top navigation bar with auth-aware actions.
 *
 * BEHAVIOR:
 * - Not logged in → shows "Iniciar Sesión" link
 * - Logged in → shows user avatar + "Cerrar Sesión" button
 * - Always shows: brand, nav links, search bar, "Publicar" button
 *
 * NOTE: The avatar button currently navigates to /perfil.
 * In a future iteration, this should open a dropdown menu.
 */

import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useNotificationCount, useRealtimeNotifications } from '../../hooks/useNotifications'
import Avatar from '../ui/Avatar'

const navLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/explorar', label: 'Explorar' },
  { to: '/mensajes', label: 'Mensajes', protected: true },
  { to: '/perfil', label: 'Mi Perfil', protected: true },
]

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, profile, logout, isLoggingOut } = useAuth()
  const { data: unreadCount } = useNotificationCount(session?.user?.id)
  const [searchQuery, setSearchQuery] = useState('')

  // Realtime: badge updates instantly when new notifications arrive
  useRealtimeNotifications(session?.user?.id || null)

  const handleLogout = async () => {
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
          <Link to="/" className="font-display-lg text-display-lg font-extrabold text-primary-container" style={{ color: '#FF6B35' }}>
            Umpi
          </Link>
          {/* Navigation Links (Desktop) */}
          <nav className="hidden md:flex gap-6 items-center pt-1 h-full">
            {navLinks.map((link) => {
              // Skip protected links if not logged in
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
              {/* Publish button — only for logged-in users */}
              <Link
                to="/publicar"
                className="hidden md:flex bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors duration-150 ease-in-out active:scale-95 items-center justify-center min-h-[48px]"
              >
                Publicar
              </Link>

              {/* Notification bell with unread badge */}
              <button
                onClick={() => navigate('/notificaciones')}
                className="relative text-text-secondary hover:text-primary-dark transition-colors"
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

              {/* User avatar → navigates to profile */}
              <button
                onClick={() => navigate('/perfil')}
                className="relative group"
              >
                <Avatar
                  src={profile?.avatar_url}
                  name={profile?.full_name}
                  size={36}
                  className="border-2 border-border-light group-hover:border-primary-container transition-colors"
                />
              </button>

              {/* Logout button */}
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="text-text-secondary hover:text-primary-dark transition-colors duration-200 active:scale-95 disabled:opacity-50"
                title="Cerrar sesión"
              >
                <span className="material-symbols-outlined text-[28px]">
                  {isLoggingOut ? 'sync' : 'logout'}
                </span>
              </button>
            </>
          ) : (
            /* Login link — only for guests */
            <Link
              to="/login"
              className="hidden md:flex bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-primary-dark transition-colors duration-150 ease-in-out active:scale-95 items-center justify-center min-h-[48px]"
            >
              Iniciar Sesión
            </Link>
          )}

          {/* Mobile Menu Trigger */}
          <button className="md:hidden text-text-secondary hover:text-primary-dark transition-colors">
            <span className="material-symbols-outlined text-[28px]">menu</span>
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
    </header>
  )
}
