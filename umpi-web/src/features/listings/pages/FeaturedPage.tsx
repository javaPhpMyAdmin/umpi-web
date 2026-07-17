import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import ProductCard from '../../../components/ui/ProductCard'
import { useFeaturedListingsAllInfinite, flattenListings } from '../../../hooks/useListings'
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll'
import { useCallback } from 'react'

export default function FeaturedPage() {
  const {
    data: infiniteData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFeaturedListingsAllInfinite()

  const listings = flattenListings(infiniteData)

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: loadMore,
    hasMore: !!hasNextPage,
    isLoading: isFetchingNextPage,
  })

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

  return (
    <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl">
        <div className="mb-8">
          <h1 className="font-title-lg text-title-lg text-on-surface mb-2">Avisos Destacados</h1>
          <p className="font-body-base text-body-base text-text-secondary">
            {listings.length} publicaciones destacadas
          </p>
        </div>

        {listings.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-md md:gap-lg">
              {listings.map((listing) => (
                <ProductCard key={listing.id} listing={listing} />
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />

            {isFetchingNextPage && (
              <div className="flex justify-center py-lg">
                <div className="text-text-secondary text-sm">Cargando más...</div>
              </div>
            )}

            {!hasNextPage && listings.length > 0 && (
              <div className="flex justify-center py-lg">
                <p className="text-text-muted text-small-subtext">No hay más resultados</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-xxl text-center">
            <span className="material-symbols-outlined text-6xl text-text-muted mb-4">star_border</span>
            <p className="text-text-secondary text-lg">No hay avisos destacados en este momento</p>
            <p className="text-text-muted text-sm mt-2">Los avisos destacados aparecerán aquí</p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
