import { useRef, useState, useEffect, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useCategories } from '../../../hooks/useCategories'
import { useFeaturedListings, useRecentListings } from '../../../hooks/useListings'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import FeaturedCard from '../../../components/ui/FeaturedCard'
import ProductCard from '../../../components/ui/ProductCard'
import FeaturedCardSkeleton from '../../../components/ui/skeletons/FeaturedCardSkeleton'
import ProductCardSkeleton from '../../../components/ui/skeletons/ProductCardSkeleton'

const iconMap: Record<string, string> = {
  Car: 'directions_car',
  Home: 'home',
  UtensilsCrossed: 'restaurant',
  Smartphone: 'smartphone',
  Store: 'store',
}

// Category tile colors keyed by slug (more stable than icon). Every color
// keeps >= 4.5:1 contrast both for white icons on the fill and for the 12px
// label on the light page background (#f8f9fa), so each hex does double duty.
// Kept outside the map so the lookup never hits Object.prototype keys.
const FALLBACK_CATEGORY_COLOR = '#5A6A80' // neutral blue-gray for future categories

const CATEGORY_COLORS: Record<string, string> = {
  'autos-motos': '#CC2E1B', // vivid red — motors
  'celulares-accesorios': '#1B62CC', // electric blue — tech
  'inmuebles': '#047A4E', // emerald green — property
  'resto-bares-cafeterias': '#8C3FF3', // violet — food & nightlife
  'servicios-comercios': '#0A7A7A', // teal — services
}

export default function HomePage() {
  const { data: categories, isLoading: loadingCategories } = useCategories()
  const { data: featuredListings, isLoading: loadingFeatured } = useFeaturedListings()
  const { data: recentListings, isLoading: loadingRecent } = useRecentListings()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState)
    window.addEventListener('resize', updateScrollState)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [updateScrollState, featuredListings])

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const amount = direction === 'left' ? -el.clientWidth : el.clientWidth
    el.scrollBy({ left: amount, behavior: 'smooth' })
  }, [])

  const showFeatured = !loadingFeatured && featuredListings && featuredListings.length > 0
  const showRecent = !loadingRecent && recentListings && recentListings.length > 0
  const showEmpty = !loadingFeatured && !loadingRecent &&
    (!featuredListings || featuredListings.length === 0) &&
    (!recentListings || recentListings.length === 0)

  return (
    <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col gap-xxl">
        {/* Category Slider — renders as soon as categories load */}
        <section className="w-full">
          <h2 className="font-section-title text-section-title text-on-surface mb-md">
            Explorar Categorías
          </h2>
          {loadingCategories ? (
            <div className="flex gap-lg md:gap-xl">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 min-w-[96px] shrink-0">
                  <div className="w-16 h-16 rounded-[14px] bg-surface-container-low animate-pulse" />
                  <div className="h-3 w-20 bg-surface-container-low rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex overflow-x-auto no-scrollbar gap-lg md:gap-xl pb-4 -mx-margin-mobile px-margin-mobile md:mx-0 md:px-0">
              {categories?.map((cat) => {
                const color = CATEGORY_COLORS[cat.slug] ?? FALLBACK_CATEGORY_COLOR
                return (
                  <Link
                    key={cat.id}
                    to={`/explorar?categoria=${cat.slug}`}
                    style={{ '--cat-color': color } as CSSProperties}
                    className="flex flex-col items-center gap-2 min-w-[96px] shrink-0 group active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[var(--cat-color)]"
                  >
                    {/* Note: in Tailwind arbitrary values, underscores are the space
                        escape (in_srgb → in srgb). Keep them or the shadow silently vanishes. */}
                    <div className="w-16 h-16 rounded-[14px] flex items-center justify-center bg-[var(--cat-color)] shadow-[0_4px_12px_color-mix(in_srgb,var(--cat-color)_25%,transparent)] transition-shadow duration-150 hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--cat-color)_40%,transparent)]">
                      <span className="material-symbols-outlined material-symbols-filled text-white text-[32px]">
                        {iconMap[cat.icon] || 'category'}
                      </span>
                    </div>
                    {/* One line per category: the label uses whitespace-nowrap and the
                        tile grows with its text, so long names stay fully readable
                        (client requirement). Tiles intentionally vary in width. */}
                    <span className="block w-full font-label-bold text-label-bold text-center leading-tight whitespace-nowrap text-[var(--cat-color)]">
                      {cat.name}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Featured — skeleton while loading, cards when ready */}
        <section className="w-full">
          <div className="flex justify-between items-end mb-md">
            <h2 className="font-section-title text-section-title text-on-surface">
              Avisos Destacados
            </h2>
            {showFeatured && featuredListings!.length >= 6 && (
              <Link to="/destacados" className="font-label-bold text-label-bold text-primary-container hover:text-primary-dark transition-colors">
                Ver todos
              </Link>
            )}
          </div>

          {loadingFeatured ? (
            <div className="flex gap-lg">
              {Array.from({ length: 3 }).map((_, i) => (
                <FeaturedCardSkeleton key={i} />
              ))}
            </div>
          ) : showFeatured ? (
            <div className="relative">
              {canScrollLeft && (
                <button
                  onClick={() => scrollBy('left')}
                  className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-border-light text-text-secondary hover:text-primary-container hover:border-primary-container transition-colors"
                  aria-label="Desplazar a la izquierda"
                >
                  <span className="material-symbols-outlined text-[22px]">chevron_left</span>
                </button>
              )}
              {canScrollRight && (
                <button
                  onClick={() => scrollBy('right')}
                  className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-border-light text-text-secondary hover:text-primary-container hover:border-primary-container transition-colors"
                  aria-label="Desplazar a la derecha"
                >
                  <span className="material-symbols-outlined text-[22px]">chevron_right</span>
                </button>
              )}

              <div
                ref={scrollRef}
                className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar gap-lg pb-6 -mx-margin-mobile px-margin-mobile md:mx-0 md:px-0 scroll-smooth"
              >
                {featuredListings!.map((listing) => (
                  <FeaturedCard key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-xl text-center">
              <span className="material-symbols-outlined text-text-muted text-[40px] mb-sm">star</span>
              <p className="font-body-base text-body-base text-text-secondary mb-1">No hay avisos destacados por el momento</p>
              <p className="font-small-subtext text-small-subtext text-text-muted">Suscribite a un plan para destacar tus publicaciones</p>
              <Link to="/planes" className="mt-md h-[40px] px-lg rounded-[14px] bg-primary-container text-white font-label-bold text-label-bold hover:bg-primary-dark transition-colors inline-flex items-center">
                Ver Planes
              </Link>
            </div>
          )}
        </section>

        {/* Recommended — skeleton while loading, cards when ready */}
        <section className="w-full">
          <h2 className="font-section-title text-section-title text-on-surface mb-md">
            Recomendados para vos
          </h2>

          {loadingRecent ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-md md:gap-lg">
              {Array.from({ length: 10 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : showRecent ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-md md:gap-lg">
                {recentListings!.map((listing) => (
                  <ProductCard key={listing.id} listing={listing} />
                ))}
              </div>
              <div className="mt-lg flex justify-center">
                <Link
                  to="/explorar"
                  className="bg-surface border border-primary-container text-primary-container px-6 py-3 rounded-[14px] font-label-bold text-label-bold hover:bg-bg-peach-soft transition-colors duration-150 ease-in-out active:scale-95 min-h-[48px] inline-block text-center"
                >
                  Ver más resultados
                </Link>
              </div>
            </>
          ) : null}
        </section>

        {/* Empty State */}
        {showEmpty && (
          <section className="w-full text-center py-xxl">
            <p className="text-text-secondary text-lg">
              Todavía no hay publicaciones. ¡Sé el primero en publicar!
            </p>
            <Link
              to="/publicar"
              className="mt-4 inline-block bg-primary-container text-white px-6 py-3 rounded-[14px] font-label-bold hover:bg-primary-dark transition-colors"
            >
              Publicar ahora
            </Link>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
