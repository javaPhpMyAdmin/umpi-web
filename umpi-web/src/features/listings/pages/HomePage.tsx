import { useRef, useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useCategories } from '../../../hooks/useCategories'
import { useFeaturedListings, useRecentListings } from '../../../hooks/useListings'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import FeaturedCard from '../../../components/ui/FeaturedCard'
import ProductCard from '../../../components/ui/ProductCard'
import HomePageSkeleton from '../../../components/ui/skeletons/HomePageSkeleton'

const iconMap: Record<string, string> = {
  Car: 'directions_car',
  Home: 'home',
  UtensilsCrossed: 'restaurant',
  Smartphone: 'smartphone',
  Store: 'store',
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

  const isLoading = loadingCategories || loadingFeatured || loadingRecent

  if (isLoading) {
    return <HomePageSkeleton />
  }

  return (
    <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col gap-xxl">
        {/* Category Slider */}
        <section className="w-full">
          <h2 className="font-section-title text-section-title text-on-surface mb-md">
            Explorar Categorías
          </h2>
          <div className="flex overflow-x-auto no-scrollbar gap-sm md:gap-md pb-4 -mx-margin-mobile px-margin-mobile md:mx-0 md:px-0">
            {categories?.map((cat, index) => (
              <Link
                key={cat.id}
                to={`/explorar?categoria=${cat.slug}`}
                className="flex flex-col items-center gap-2 min-w-[80px] group active:scale-95 transition-transform"
              >
                <div
                  className={`w-16 h-16 rounded-[14px] flex items-center justify-center transition-colors ${
                    index === 0
                      ? 'bg-primary-container shadow-[0_4px_12px_rgba(255,107,53,0.2)]'
                      : 'bg-surface border border-border-light group-hover:border-primary-container'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[32px] ${
                      index === 0
                        ? 'text-white material-symbols-filled'
                        : 'text-text-secondary group-hover:text-primary-container'
                    }`}
                  >
                    {iconMap[cat.icon] || 'category'}
                  </span>
                </div>
                <span
                  className={`font-label-bold text-label-bold text-center ${
                    index === 0 ? 'text-on-surface' : 'text-text-secondary'
                  }`}
                >
                  {cat.name}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured / Horizontal Scroll Section */}
        {featuredListings && featuredListings.length > 0 && (
          <section className="w-full">
            <div className="flex justify-between items-end mb-md">
              <h2 className="font-section-title text-section-title text-on-surface">
                Avisos Destacados
              </h2>
              <Link to="/destacados" className="font-label-bold text-label-bold text-primary-container hover:text-primary-dark transition-colors">
                Ver todos
              </Link>
            </div>
            <div className="relative">
              {/* Left arrow */}
              {canScrollLeft && (
                <button
                  onClick={() => scrollBy('left')}
                  className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-border-light text-text-secondary hover:text-primary-container hover:border-primary-container transition-colors"
                  aria-label="Desplazar a la izquierda"
                >
                  <span className="material-symbols-outlined text-[22px]">chevron_left</span>
                </button>
              )}
              {/* Right arrow */}
              {canScrollRight && (
                <button
                  onClick={() => scrollBy('right')}
                  className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-border-light text-text-secondary hover:text-primary-container hover:border-primary-container transition-colors"
                  aria-label="Desplazar a la derecha"
                >
                  <span className="material-symbols-outlined text-[22px]">chevron_right</span>
                </button>
              )}

              {/* Scrollable container */}
              <div
                ref={scrollRef}
                className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar gap-lg pb-6 -mx-margin-mobile px-margin-mobile md:mx-0 md:px-0 scroll-smooth"
              >
                {featuredListings.map((listing) => (
                  <FeaturedCard key={listing.id} listing={listing} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Recommended Grid */}
        {recentListings && recentListings.length > 0 && (
          <section className="w-full">
            <h2 className="font-section-title text-section-title text-on-surface mb-md">
              Recomendados para vos
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-md md:gap-lg">
              {recentListings.map((listing) => (
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
          </section>
        )}

        {/* Empty State */}
        {(!featuredListings || featuredListings.length === 0) &&
          (!recentListings || recentListings.length === 0) && (
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
