import { useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import Avatar from '../../../components/ui/Avatar'
import { useAuth } from '../../../contexts/AuthContext'
import { useListing } from '../../../hooks/useListings'
import { useProfile } from '../../../hooks/useProfile'
import { useReviews } from '../../../hooks/useReviews'
import ReviewForm from '../../../components/ui/ReviewForm'
import { useCategories } from '../../../hooks/useCategories'
import { formatPrice } from '../../../lib/utils'
import { supabase } from '../../../lib/supabase'

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: listing, isLoading, error } = useListing(id || '')
  const { data: seller } = useProfile(listing?.user_id)
  const { data: categories } = useCategories()

  // Resolve category from cache (avoids N+1 JOIN in query)
  const category = useMemo(() => {
    if (!listing?.category_id || !categories) return null
    return categories.find(c => c.id === listing.category_id) ?? null
  }, [listing?.category_id, categories])
  const { data: reviews = [] } = useReviews(listing?.id)

  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [isZoomOpen, setIsZoomOpen] = useState(false)
  const [isReviewsOpen, setIsReviewsOpen] = useState(false)
  const [contacting, setContacting] = useState(false)

  // ── Contact: find or create conversation ──────────────────────────────────
  const handleContact = async () => {
    if (!session?.user) {
      navigate('/login')
      return
    }
    if (!listing || session.user.id === listing.user_id) return
    setContacting(true)

    try {
      // Search for existing conversation for this listing + this user
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('listing_id', listing.id)
        .or(`user1_id.eq.${session.user.id},user2_id.eq.${session.user.id}`)
        .order('created_at', { ascending: false })
        .limit(1)

      const existingConv = conversations?.[0]

      if (existingConv) {
        navigate(`/mensajes?conversation=${existingConv.id}`)
      } else {
        // Create new conversation
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({
            listing_id: listing.id,
            user1_id: session.user.id,
            user2_id: listing.user_id,
          })
          .select('id')
          .single()

        if (convError) throw convError
        // Invalidate so the conversations list picks up the new conversation
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        navigate(`/mensajes?conversation=${newConv.id}`)
      }
    } catch (err) {
      console.error('Error starting conversation:', err)
    } finally {
      setContacting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-text-secondary">Cargando...</div>
        </main>
        <Footer />
      </div>
    )
  }

  if (error || !listing) {
    // eslint-disable-next-line no-console
    if (error) console.error('Supabase listing error:', error)
    return (
      <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="material-symbols-outlined text-6xl text-text-muted mb-4">error_outline</span>
            <p className="text-text-secondary text-lg">Publicación no encontrada</p>
            <Link to="/" className="mt-4 inline-block text-primary-container hover:underline">
              Volver al inicio
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="bg-background text-on-surface font-body-base antialiased min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-lg md:py-xxl">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-2 text-small-subtext text-text-secondary mb-lg">
          <Link className="hover:text-primary-container transition-colors" to="/">Inicio</Link>
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          {category && (
            <>
              <Link className="hover:text-primary-container transition-colors" to={`/explorar?categoria=${category.slug}`}>
                {category.name}
              </Link>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </>
          )}
          <span className="text-on-surface font-medium line-clamp-1">{listing.title}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-xxl">
          {/* Left Column: Gallery & Details */}
          <div className="lg:col-span-8 flex flex-col gap-xxl">
            {/* Image Gallery */}
            {listing.images && listing.images.length > 0 && (
              <div className="bg-surface rounded-xl overflow-hidden shadow-sm border border-border-light">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-xs p-xs">
                  {/* Main image */}
                  <div className="md:col-span-3 aspect-[4/3] rounded-lg overflow-hidden bg-surface-container-low relative group">
                    <img
                      className="w-full h-full object-cover cursor-pointer"
                      src={listing.images[selectedImageIndex]}
                      alt={listing.title}
                      onClick={() => setIsZoomOpen(true)}
                    />
                    {/* Zoom button */}
                    <button
                      onClick={() => setIsZoomOpen(true)}
                      className="absolute bottom-4 right-4 w-10 h-10 bg-surface/80 backdrop-blur-sm rounded-full flex items-center justify-center text-text-secondary hover:text-primary-container transition-colors shadow-sm"
                      aria-label="Ampliar imagen"
                    >
                      <span className="material-symbols-outlined">zoom_in</span>
                    </button>
                  </div>

                  {/* Thumbnails */}
                  {listing.images.length > 1 && (
                    <div className="hidden md:flex flex-col gap-xs">
                      {listing.images.slice(0, 4).map((img, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedImageIndex(index)}
                          className={`aspect-square rounded-lg overflow-hidden bg-surface-container-low cursor-pointer transition-all relative ${
                            index === selectedImageIndex
                              ? 'ring-2 ring-primary-container'
                              : 'hover:opacity-80 opacity-70'
                          }`}
                          aria-label={`Ver imagen ${index + 1}`}
                        >
                          <img className="w-full h-full object-cover" src={img} alt={`${listing.title} ${index + 1}`} />
                        </button>
                      ))}
                      {listing.images.length > 4 && (
                        <button
                          onClick={() => setSelectedImageIndex(4)}
                          className={`aspect-square rounded-lg overflow-hidden bg-surface-container-low relative cursor-pointer transition-all flex items-center justify-center group ${
                            selectedImageIndex >= 4
                              ? 'ring-2 ring-primary-container'
                              : 'hover:opacity-80 opacity-70'
                          }`}
                          aria-label="Ver más fotos"
                        >
                          <img className="w-full h-full object-cover" src={listing.images[4]} alt={`${listing.title} 5`} />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-white font-label-bold">+{listing.images.length - 4} fotos</span>
                          </div>
                        </button>
                      )}
                    </div>
              )}
            </div>
          </div>
            )}

            {/* Zoom Modal */}
            {isZoomOpen && (
              <div
                className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                onClick={() => setIsZoomOpen(false)}
              >
                <button
                  className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
                  onClick={() => setIsZoomOpen(false)}
                  aria-label="Cerrar zoom"
                >
                  <span className="material-symbols-outlined text-4xl">close</span>
                </button>
                <img
                  className="max-w-full max-h-full object-contain rounded-lg"
                  src={listing.images[selectedImageIndex]}
                  alt={listing.title}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}

            {/* Product Description */}
            <div className="bg-surface rounded-xl p-lg md:p-xxl shadow-sm border border-border-light">
              <h2 className="font-header-md text-header-md mb-lg">Descripción</h2>
              <p className="font-body-base text-body-base text-text-secondary leading-relaxed whitespace-pre-line">
                {listing.description || 'Sin descripción'}
              </p>
            </div>
          </div>

          {/* Right Column: Sidebar */}
          <div className="lg:col-span-4 relative">
            <div className="sticky top-[96px] flex flex-col gap-lg">
              {/* Main Action Card */}
              <div className="bg-surface rounded-xl p-lg shadow-sm border border-border-light flex flex-col gap-lg">
                <div className="flex flex-col gap-1">
                  <span className="text-small-subtext text-text-secondary uppercase tracking-wider">
                    {listing.is_featured ? 'Destacado' : 'Publicación'} • {category?.name || 'Sin categoría'}
                  </span>
                  <h1 className="font-title-lg text-title-lg text-on-surface">
                    {listing.title}
                  </h1>
                </div>

                {/* Price */}
                <div className="flex flex-col">
                  <span className="font-display-lg text-display-lg font-extrabold text-on-surface">
                    {formatPrice(listing.price)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-3 mt-md">
                  {session?.user?.id !== listing.user_id ? (
                    <button
                      onClick={handleContact}
                      disabled={contacting}
                      className="w-full h-[56px] bg-primary-container text-on-primary font-label-bold text-label-bold rounded-xl hover:bg-primary-dark transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-95 duration-150 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined">chat</span>
                      {contacting ? 'Abriendo...' : 'Contactar'}
                    </button>
                  ) : (
                    <Link
                      to={`/editar/${listing.id}`}
                      className="w-full h-[56px] bg-primary-container text-on-primary font-label-bold text-label-bold rounded-xl hover:bg-primary-dark transition-colors shadow-sm flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined">edit</span>
                      Editar mi aviso
                    </Link>
                  )}
                  <button className="w-full h-[48px] bg-bg-peach-soft text-primary-dark font-label-bold text-label-bold rounded-xl hover:bg-bg-peach-mid transition-colors flex items-center justify-center gap-2 active:scale-95 duration-150">
                    <span className="material-symbols-outlined">favorite_border</span>
                    Guardar en favoritos
                  </button>
                </div>
              </div>

              {/* Seller Info */}
              {seller && (
                <div className="bg-surface rounded-xl p-lg shadow-sm border border-border-light flex flex-col gap-md">
                  <h3 className="font-section-title text-section-title text-on-surface">Información sobre el publicador</h3>
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={seller.avatar_url}
                      name={seller.full_name}
                      size={48}
                      className="border border-border-light"
                    />
                    <div className="flex flex-col">
                      <span className="font-label-bold text-label-bold text-on-surface">
                        {seller.full_name || 'Publicador'}
                      </span>
                      <div className="flex items-center gap-1 text-sm">
                        {(listing.reviews_count || 0) > 0 ? (
                          <>
                            <div className="flex">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <span key={i} className={`material-symbols-outlined text-[16px] ${i < Math.round(listing.rating || 0) ? 'material-symbols-filled text-yellow-500' : 'text-text-muted'}`}>
                                  {i < Math.round(listing.rating || 0) ? 'star' : 'star_outline'}
                                </span>
                              ))}
                            </div>
                            <button
                              onClick={() => setIsReviewsOpen(true)}
                              className="text-text-secondary hover:text-primary-container underline underline-offset-2 cursor-pointer"
                            >
                              ({listing.reviews_count} {listing.reviews_count === 1 ? 'calificación' : 'calificaciones'})
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setIsReviewsOpen(true)}
                            className="text-text-secondary hover:text-primary-container underline underline-offset-2 cursor-pointer"
                          >
                            Sin calificaciones aún
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Badges */}
                </div>
              )}

              {/* Location */}
              {listing.location && (
                <div className="bg-surface rounded-xl p-lg shadow-sm border border-border-light flex flex-col gap-md">
                  <h3 className="font-section-title text-section-title text-on-surface">Ubicación</h3>
                  <div className="flex items-start gap-2 text-text-secondary font-body-base text-body-base">
                    <span className="material-symbols-outlined mt-0.5">location_on</span>
                    <p>{listing.location}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Reviews Modal */}
      {isReviewsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center md:items-center"
          onClick={() => setIsReviewsOpen(false)}
        >
          <div
            className="bg-surface rounded-t-[20px] md:rounded-[20px] shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-lg border-b border-border-light">
              <h2 className="font-header-md text-header-md text-on-surface">
                Calificaciones ({listing.reviews_count || 0})
              </h2>
              <button
                onClick={() => setIsReviewsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-border-light text-text-secondary hover:text-on-surface hover:bg-surface-container-low transition-colors"
                aria-label="Cerrar calificaciones"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-lg space-y-lg">
              {reviews.length === 0 ? (
                <p className="text-text-secondary text-center py-xxl">Esta publicación aún no tiene calificaciones.</p>
              ) : (
                reviews.map((review) => {
                  const reviewerName = review.reviewer?.full_name || 'Usuario'
                  return (
                    <div key={review.id} className="bg-white rounded-[14px] p-lg border border-border-light flex flex-col gap-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={review.reviewer?.avatar_url}
                            name={reviewerName}
                            size={40}
                            className="border border-border-light"
                          />
                          <div className="flex flex-col">
                            <span className="font-label-bold text-label-bold text-on-surface">{reviewerName}</span>
                            <span className="text-text-secondary text-sm">
                              {new Date(review.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i} className={`material-symbols-outlined text-[16px] ${i < review.rating ? 'material-symbols-filled text-yellow-500' : 'text-text-muted'}`}>
                              {i < review.rating ? 'star' : 'star_outline'}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Review Form */}
            <div className="border-t border-border-light p-lg shrink-0">
              <ReviewForm listingId={listing.id} sellerId={listing.user_id} />
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}
