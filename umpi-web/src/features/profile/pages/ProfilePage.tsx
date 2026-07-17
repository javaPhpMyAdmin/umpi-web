import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import Modal from '../../../components/ui/Modal'
import { useAuth } from '../../../contexts/AuthContext'
import { useUserListings } from '../../../hooks/useUserListings'
import { formatPrice } from '../../../lib/utils'

export default function ProfilePage() {
  const { session, profile, isLoading: loadingAuth } = useAuth()
  const { data: myListings, isLoading: loadingListings, deleteListing, isDeleting } = useUserListings(session?.user?.id || '')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  if (loadingAuth) {
    return (
      <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-text-secondary">Cargando...</div>
        </main>
        <Footer />
      </div>
    )
  }

  // Si no hay sesión, redirigir a login
  if (!session) {
    return (
      <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
        <Navbar />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <p className="text-text-secondary text-lg mb-4">Debes iniciar sesión para ver tu perfil</p>
            <Link to="/login" className="bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors">
              Iniciar Sesión
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
      <Navbar />

      <main className="flex-grow w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col md:flex-row gap-8">
        {/* Left Column: Profile Info & Reputation */}
        <aside className="w-full md:w-1/3 flex flex-col gap-6">
          {/* Profile Header Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col items-center text-center">
            <div className="relative mb-4">
              <img
                className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-sm"
                src={profile?.avatar_url || 'https://via.placeholder.com/128x128?text=Avatar'}
                alt="Avatar"
              />
              {profile?.subscription_type === 'premium' && (
                <div className="absolute bottom-1 right-1 bg-secondary text-white p-1.5 rounded-full border-2 border-white shadow-sm" title="Vendedor Verificado">
                  <span className="material-symbols-outlined text-[16px] material-symbols-filled">verified</span>
                </div>
              )}
            </div>
            <h1 className="font-header-md text-header-md text-on-surface mb-1">
              {profile?.full_name || 'Usuario'}
            </h1>
            <p className="font-body-base text-body-base text-text-secondary flex items-center gap-1 mb-4">
              <span className="material-symbols-outlined text-[18px]">location_on</span>
              {profile?.location || 'Sin ubicación'}
            </p>
            <div className="w-full bg-surface-container-low rounded-lg p-3 mb-6">
              <p className="font-small-subtext text-small-subtext text-text-muted uppercase tracking-wider">
                Miembro desde
              </p>
              <p className="font-label-bold text-label-bold text-on-surface">
                {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : 'Reciente'}
              </p>
            </div>
            <div className="flex w-full gap-3">
              <button className="w-full h-[48px] px-lg rounded-[14px] bg-bg-peach-soft text-primary-dark font-label-bold text-label-bold hover:bg-bg-peach-mid transition-colors flex items-center justify-center gap-xs">
                <span className="material-symbols-outlined">settings</span>
                Configuración de Cuenta
              </button>
            </div>
          </div>

          {/* Reputation Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col gap-4">
            <h2 className="font-section-title text-section-title text-on-surface mb-2">Reputación</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-16 h-16 bg-bg-peach-soft rounded-full text-primary-container font-display-lg text-display-lg">
                {profile?.rating?.toFixed(1) || '5.0'}
              </div>
              <div>
                <div className="flex text-star-yellow mb-1">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="material-symbols-outlined material-symbols-filled">
                      {i < Math.floor(profile?.rating || 5) ? 'star' : 'star_half'}
                    </span>
                  ))}
                </div>
                <p className="font-small-subtext text-small-subtext text-text-secondary">
                  Basado en {profile?.reviews_count || 0} opiniones
                </p>
              </div>
            </div>
            <div className="h-px w-full bg-border-light my-2"></div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="bg-secondary-container text-on-secondary-container p-2 rounded-lg">
                  <span className="material-symbols-outlined">workspace_premium</span>
                </div>
                <div>
                  <p className="font-label-bold text-label-bold text-on-surface">Publicador Confiable</p>
                  <p className="font-small-subtext text-small-subtext text-text-secondary">
                    Destacado por la comunidad
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Column: Dashboard & Listings */}
        <section className="w-full md:w-2/3 flex flex-col gap-6">
          {/* Dashboard Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
              <span className="material-symbols-outlined text-text-secondary text-[20px]">visibility</span>
              <span className="font-title-lg text-title-lg text-on-surface leading-tight">1,245</span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Vistas totales</span>
            </div>
            <div className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
              <span className="material-symbols-outlined text-text-secondary text-[20px]">ads_click</span>
              <span className="font-title-lg text-title-lg text-on-surface leading-tight">342</span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Clics en avisos</span>
            </div>
            <div className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
              <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span>
              <span className="font-title-lg text-title-lg text-on-surface leading-tight">
                {myListings?.length || 0}
              </span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Avisos Activos</span>
            </div>
            <div className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
              <span className="material-symbols-outlined text-star-yellow text-[20px]">star</span>
              <span className="font-title-lg text-title-lg text-on-surface leading-tight">
                {profile?.rating?.toFixed(1) || '5.0'}
              </span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Calificación</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-8 border-b border-border-light">
            <button className="pb-3 border-b-2 border-primary-container text-primary-container font-label-bold text-label-bold">
              Mis Avisos ({myListings?.length || 0})
            </button>
            <button className="pb-3 border-b-2 border-transparent text-text-muted hover:text-on-surface transition-colors font-label-bold text-label-bold">
              Favoritos
            </button>
          </div>

          {/* Listings Grid */}
          {loadingListings ? (
            <div className="flex justify-center items-center py-xxl">
              <div className="text-text-secondary">Cargando avisos...</div>
            </div>
          ) : myListings && myListings.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-md md:gap-gutter">
              {myListings.map((listing) => (
                <div key={listing.id} className="bg-surface rounded-xl shadow-card overflow-hidden flex flex-col cursor-pointer group">
                  <Link to={`/producto/${listing.id}`}>
                    <div className="relative h-[110px] md:h-[160px] w-full overflow-hidden">
                      <img
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        src={listing.images?.[0] || 'https://via.placeholder.com/400x300?text=Sin+imagen'}
                        alt={listing.title}
                      />
                      {listing.is_featured && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-500 text-white px-2 py-0.5 rounded-full text-[11px] font-bold shadow-md">
                          <span className="material-symbols-outlined text-[12px] material-symbols-filled">star</span>
                          Destacado
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-grow">
                      <h3 className="font-body-base text-body-base text-on-surface line-clamp-2 mb-2">
                        {listing.title}
                      </h3>
                      <div className="mt-auto">
                        <p className="font-price-highlight text-price-highlight text-primary-container">
                          {formatPrice(listing.price)}
                        </p>
                        <p className="font-small-subtext text-small-subtext text-text-muted mt-1">
                          Activo
                        </p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex gap-2 border-t border-border-light pt-3 mt-3 px-4 pb-4">
                    <button className="flex-1 h-[36px] rounded-lg border border-border-light text-on-surface font-label-bold text-label-bold hover:bg-surface-container-low transition-colors flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ id: listing.id, title: listing.title })}
                      disabled={isDeleting}
                      className="w-[36px] h-[36px] rounded-lg bg-bg-peach-soft text-primary-dark hover:bg-error-container hover:text-error transition-colors flex items-center justify-center shrink-0 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-xxl text-center">
              <span className="material-symbols-outlined text-6xl text-text-muted mb-4">inventory_2</span>
              <p className="text-text-secondary text-lg">Aún no tienes avisos publicados</p>
              <Link
                to="/publicar"
                className="mt-4 bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors"
              >
                Publicar tu primer aviso
              </Link>
            </div>
          )}
        </section>
      </main>

      <Footer />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteListing(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null),
            })
          }
        }}
        title="Eliminar aviso"
        message={`¿Estás seguro que quieres eliminar "${deleteTarget?.title}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        danger
        loading={isDeleting}
      />
    </div>
  )
}
