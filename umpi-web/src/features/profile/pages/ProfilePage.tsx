import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import Modal from '../../../components/ui/Modal'
import ProfilePageSkeleton from '../../../components/ui/skeletons/ProfilePageSkeleton'
import Avatar from '../../../components/ui/Avatar'
import { useAuth } from '../../../contexts/AuthContext'
import { useUserListings, flattenUserListings, PAGE_SIZE } from '../../../hooks/useUserListings'
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll'
import { formatPrice } from '../../../lib/utils'

export default function ProfilePage() {
  const { session, profile, isLoading: loadingAuth } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user?.id || ''
  const { data: pagesData, isLoading: loadingListings, hasNextPage, isFetchingNextPage, fetchNextPage, deleteListing, isDeleting } = useUserListings(userId)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [cancelSubTarget, setCancelSubTarget] = useState(false)

  const myListings = flattenUserListings(pagesData)

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore: hasNextPage ?? false,
    isLoading: isFetchingNextPage,
  })

  const cancelSubscription = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('cancel-subscription')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] })
      setCancelSubTarget(false)
    },
  })

  const subscriptionInfo = (() => {
    const type = profile?.subscription_type
    if (!type || type === 'none' || type === '') return null
    // Also require a valid expiry date
    if (!profile?.subscription_expires_at || new Date(profile.subscription_expires_at) <= new Date()) return null
    switch (type) {
      case 'premium':
        return { label: 'Premium', price: '$30.000/mes', icon: 'star', color: 'bg-primary-container text-white' }
      case 'estandar':
        return { label: 'Estándar', price: '$5.900/mes', icon: 'card_membership', color: 'bg-secondary-container text-on-secondary-container' }
      default:
        return { label: type.charAt(0).toUpperCase() + type.slice(1), price: null, icon: 'card_membership', color: 'bg-secondary-container text-on-secondary-container' }
    }
  })()

  if (loadingAuth) {
    return <ProfilePageSkeleton />
  }

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
              <Avatar
                src={profile?.avatar_url}
                name={profile?.full_name}
                size={128}
                className="border-4 border-white shadow-sm"
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

          {/* Subscription Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col gap-4">
            <h2 className="font-section-title text-section-title text-on-surface">Mi Suscripción</h2>
            {subscriptionInfo ? (
              <>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${subscriptionInfo.color}`}>
                    <span className="material-symbols-outlined">{subscriptionInfo.icon}</span>
                  </div>
                  <div>
                    <p className="font-label-bold text-label-bold text-on-surface">{subscriptionInfo.label}</p>
                    {subscriptionInfo.price && (
                      <p className="font-small-subtext text-small-subtext text-text-secondary">
                        {subscriptionInfo.price}
                      </p>
                    )}
                    {profile?.subscription_expires_at && (
                      <p className="font-small-subtext text-small-subtext text-text-muted">
                        Expira {new Date(profile.subscription_expires_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setCancelSubTarget(true)}
                  className="w-full h-[40px] rounded-[14px] border border-border-light text-text-secondary font-label-bold text-label-bold hover:bg-error-container hover:text-error hover:border-error transition-colors flex items-center justify-center gap-xs"
                >
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                  Cancelar Suscripción
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center text-center py-2">
                <div className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center mb-3">
                  <span className="material-symbols-outlined text-text-muted text-[24px]">membership</span>
                </div>
                <p className="font-label-bold text-label-bold text-on-surface mb-1">Sin plan</p>
                <p className="font-small-subtext text-small-subtext text-text-secondary mb-3">
                  Elegí un plan para destacar tus publicaciones
                </p>
                <Link
                  to="/planes"
                  className="w-full h-[40px] rounded-[14px] bg-primary-container text-white font-label-bold text-label-bold hover:bg-primary-dark transition-colors flex items-center justify-center"
                >
                  Ver Planes
                </Link>
              </div>
            )}
          </div>

          {/* Reputation Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col gap-4">
            <h2 className="font-section-title text-section-title text-on-surface mb-2">Reputación</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-16 h-16 bg-bg-peach-soft rounded-full text-primary-container font-display-lg text-display-lg">
                {profile?.rating ? profile.rating.toFixed(1) : '—'}
              </div>
              <div>
                {(profile?.reviews_count || 0) > 0 ? (
                  <>
                    <div className="flex mb-1">
                      {[...Array(5)].map((_, i) => (
                        <span key={i} className={`material-symbols-outlined text-[18px] ${i < Math.round(profile?.rating || 0) ? 'material-symbols-filled text-star-yellow' : 'text-text-muted'}`}>
                          {i < Math.round(profile?.rating || 0) ? 'star' : 'star_outline'}
                        </span>
                      ))}
                    </div>
                    <p className="font-small-subtext text-small-subtext text-text-secondary">
                      Basado en {profile?.reviews_count || 0} opiniones
                    </p>
                  </>
                ) : (
                  <p className="font-small-subtext text-small-subtext text-text-secondary">
                    Sin opiniones aún
                  </p>
                )}
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
                {myListings.length}
              </span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Avisos Activos</span>
            </div>
            <div className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
              <span className="material-symbols-outlined text-star-yellow text-[20px]">star</span>
              <span className="font-title-lg text-title-lg text-on-surface leading-tight">
                {profile?.rating ? profile.rating.toFixed(1) : '—'}
              </span>
              <span className="font-small-subtext text-small-subtext text-text-secondary">Calificación</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-8 border-b border-border-light">
            <button className="pb-3 border-b-2 border-primary-container text-primary-container font-label-bold text-label-bold">
              Mis Avisos ({myListings.length})
            </button>
            <button className="pb-3 border-b-2 border-transparent text-text-muted hover:text-on-surface transition-colors font-label-bold text-label-bold">
              Favoritos
            </button>
          </div>

          {/* Listings Grid — skeleton while loading, cards when ready */}
          {loadingListings ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-md md:gap-gutter">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-surface rounded-xl shadow-card overflow-hidden">
                  <div className="h-[110px] md:h-[160px] w-full bg-surface-container-low animate-pulse" />
                  <div className="p-4 flex flex-col gap-2">
                    <div className="h-4 w-full bg-surface-container-low rounded animate-pulse" />
                    <div className="h-4 w-3/4 bg-surface-container-low rounded animate-pulse" />
                    <div className="h-5 w-20 bg-surface-container-low rounded animate-pulse mt-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : myListings.length > 0 ? (
            <>
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
                      <Link
                        to={`/editar/${listing.id}`}
                        className="flex-1 h-[36px] rounded-lg border border-border-light text-on-surface font-label-bold text-label-bold hover:bg-surface-container-low transition-colors flex items-center justify-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        Editar
                      </Link>
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

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-1" />

              {/* Loading more indicator */}
              {isFetchingNextPage && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-md md:gap-gutter">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="bg-surface rounded-xl shadow-card overflow-hidden">
                      <div className="h-[110px] md:h-[160px] w-full bg-surface-container-low animate-pulse" />
                      <div className="p-4 flex flex-col gap-2">
                        <div className="h-4 w-full bg-surface-container-low rounded animate-pulse" />
                        <div className="h-4 w-3/4 bg-surface-container-low rounded animate-pulse" />
                        <div className="h-5 w-20 bg-surface-container-low rounded animate-pulse mt-2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* End of results */}
              {!hasNextPage && myListings.length > PAGE_SIZE && (
                <p className="text-center text-text-muted text-small-subtext py-4">
                  No hay más avisos
                </p>
              )}
            </>
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

      <Modal
        open={cancelSubTarget}
        onClose={() => setCancelSubTarget(false)}
        onConfirm={() => cancelSubscription.mutate()}
        title="Cancelar Suscripción"
        message="¿Estás seguro que quieres cancelar tu suscripción? Perderás los beneficios de tu plan actual."
        confirmLabel="Cancelar Plan"
        danger
        loading={cancelSubscription.isPending}
      />
    </div>
  )
}
