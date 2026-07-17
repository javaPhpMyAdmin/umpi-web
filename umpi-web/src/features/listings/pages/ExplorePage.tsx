import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import ProductCard from '../../../components/ui/ProductCard'
import ProductCardSkeleton from '../../../components/ui/skeletons/ProductCardSkeleton'
import { useCategories } from '../../../hooks/useCategories'
import { useListings, flattenListings, type ListingsFilters } from '../../../hooks/useListings'
import { useInfiniteScroll } from '../../../hooks/useInfiniteScroll'

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: categories } = useCategories()

  const categorySlug = searchParams.get('categoria')
  const selectedCategory = categories?.find((c) => c.slug === categorySlug)

  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [location, setLocation] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'price_asc' | 'price_desc'>('recent')

  const filters: ListingsFilters = useMemo(() => {
    const f: ListingsFilters = { sortBy }
    if (selectedCategory) f.categoryId = selectedCategory.id
    if (priceMin) f.priceMin = parseFloat(priceMin)
    if (priceMax) f.priceMax = parseFloat(priceMax)
    if (location) f.location = location
    return f
  }, [selectedCategory, priceMin, priceMax, location, sortBy])

  const {
    data: infiniteData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useListings(filters)

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

  const activeFilters = useMemo(() => {
    const result: { label: string; onRemove: () => void }[] = []
    if (selectedCategory) {
      result.push({
        label: selectedCategory.name,
        onRemove: () => setSearchParams({}),
      })
    }
    if (priceMin || priceMax) {
      result.push({
        label: `Precio: ${priceMin || '0'} - ${priceMax || '∞'}`,
        onRemove: () => { setPriceMin(''); setPriceMax('') },
      })
    }
    if (location) {
      result.push({
        label: `Ubicación: ${location}`,
        onRemove: () => setLocation(''),
      })
    }
    return result
  }, [selectedCategory, priceMin, priceMax, location, setSearchParams])

  const clearAllFilters = () => {
    setSearchParams({})
    setPriceMin('')
    setPriceMax('')
    setLocation('')
    setSortBy('recent')
  }

  return (
    <div className="bg-background text-on-background font-body-base antialiased min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col md:flex-row gap-margin-desktop">
        {/* Sidebar Filters — renders immediately, categories load fast */}
        <aside className="hidden md:block w-64 flex-shrink-0 space-y-xxl">
          <nav className="flex items-center gap-xs text-small-subtext font-small-subtext text-text-secondary mb-lg">
            <a className="hover:text-primary-container transition-colors" href="/">Inicio</a>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            <span className="text-on-surface font-semibold">Resultados de búsqueda</span>
          </nav>

          <div className="bg-surface rounded-[16px] p-lg shadow-sm border border-surface-variant">
            <h2 className="font-section-title text-section-title text-on-surface mb-lg">Filtros</h2>

            <div className="mb-xxl">
              <h3 className="font-label-bold text-label-bold text-text-secondary mb-md uppercase tracking-wider">Categoría</h3>
              <div className="space-y-sm">
                {categories?.map((cat) => (
                  <label key={cat.id} className="flex items-center gap-sm cursor-pointer group">
                    <input
                      type="radio"
                      name="category"
                      checked={selectedCategory?.id === cat.id}
                      onChange={() => setSearchParams({ categoria: cat.slug })}
                      className="text-primary-container focus:ring-primary-container w-4 h-4 transition-colors cursor-pointer border-border-light"
                    />
                    <span className="font-body-base text-body-base text-on-surface group-hover:text-primary-container transition-colors">{cat.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-xxl">
              <h3 className="font-label-bold text-label-bold text-text-secondary mb-md uppercase tracking-wider">Precio</h3>
              <div className="flex gap-sm items-center mb-md">
                <div className="relative flex-1">
                  <span className="absolute left-sm top-1/2 -translate-y-1/2 text-text-muted text-small-subtext">$</span>
                  <input
                    type="number"
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    className="w-full bg-surface py-2 pl-6 pr-2 rounded-[14px] border border-border-light focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container text-body-base font-body-base placeholder:text-text-muted"
                    placeholder="Mín"
                  />
                </div>
                <span className="text-text-muted">-</span>
                <div className="relative flex-1">
                  <span className="absolute left-sm top-1/2 -translate-y-1/2 text-text-muted text-small-subtext">$</span>
                  <input
                    type="number"
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    className="w-full bg-surface py-2 pl-6 pr-2 rounded-[14px] border border-border-light focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container text-body-base font-body-base placeholder:text-text-muted"
                    placeholder="Máx"
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-label-bold text-label-bold text-text-secondary mb-md uppercase tracking-wider">Ubicación</h3>
              <div className="relative w-full group">
                <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary-container transition-colors text-[20px]">location_on</span>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-surface py-2 pl-9 pr-2 rounded-[14px] border border-border-light focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container text-body-base font-body-base placeholder:text-text-muted"
                  placeholder="Barrio o Ciudad"
                />
              </div>
            </div>
          </div>
        </aside>

        {/* Results Canvas */}
        <section className="flex-1 flex flex-col">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-lg gap-sm">
            <div>
              <h1 className="font-title-lg text-title-lg text-on-surface">
                {selectedCategory ? selectedCategory.name : 'Explorar'}
              </h1>
              <p className="font-body-base text-body-base text-text-secondary mt-1">
                {isLoading ? 'Cargando...' : `${listings.length} resultados encontrados`}
              </p>
            </div>
            <div className="flex items-center gap-sm self-start md:self-auto">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'recent' | 'price_asc' | 'price_desc')}
                className="flex items-center justify-between w-full md:w-[200px] h-[40px] px-md rounded-[14px] border border-border-light bg-surface text-on-surface font-label-bold text-label-bold hover:border-primary-container hover:text-primary-container transition-colors focus:outline-none focus:ring-1 focus:ring-primary-container"
              >
                <option value="recent">Más recientes</option>
                <option value="price_asc">Menor precio</option>
                <option value="price_desc">Mayor precio</option>
              </select>
            </div>
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-xs mb-lg">
              {activeFilters.map((filter, index) => (
                <span key={index} className="inline-flex items-center gap-xs px-sm py-1 rounded-full bg-primary-container text-on-primary font-label-bold text-label-bold">
                  {filter.label}
                  <button onClick={filter.onRemove} className="flex items-center justify-center hover:bg-primary-dark rounded-full p-1 transition-colors">
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </span>
              ))}
              <button onClick={clearAllFilters} className="inline-flex items-center px-sm py-1 rounded-full border border-border-light text-text-secondary font-label-bold text-label-bold hover:bg-surface-container-low transition-colors">
                Limpiar filtros
              </button>
            </div>
          )}

          {/* Grid — skeleton while loading, cards when ready */}
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] md:gap-lg">
              {Array.from({ length: 9 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : listings.length > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] md:gap-lg">
                {listings.map((listing) => (
                  <ProductCard key={listing.id} listing={listing} />
                ))}
              </div>

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
              <span className="material-symbols-outlined text-6xl text-text-muted mb-4">search_off</span>
              <p className="text-text-secondary text-lg">No se encontraron resultados</p>
              <p className="text-text-muted text-sm mt-2">Intentá ajustar los filtros</p>
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  )
}
