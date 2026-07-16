import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import type { Listing } from '../../../types'
import Navbar from '../../../components/layout/Navbar'
import Footer from '../../../components/layout/Footer'
import ProductCard from '../../../components/ui/ProductCard'
import { formatPrice } from '../../../lib/utils'

function useFeaturedListingsAll() {
  return useQuery({
    queryKey: ['listings', 'featured', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*, category:category_id(*)')
        .eq('status', 'active')
        .eq('is_featured', true)
        .order('listing_priority', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Listing[]
    },
  })
}

export default function FeaturedPage() {
  const { data: featuredListings, isLoading } = useFeaturedListingsAll()

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
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-title-lg text-title-lg text-on-surface mb-2">
            Avisos Destacados
          </h1>
          <p className="font-body-base text-body-base text-text-secondary">
            {featuredListings?.length || 0} publicaciones destacadas
          </p>
        </div>

        {/* Grid */}
        {featuredListings && featuredListings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-md md:gap-lg">
            {featuredListings.map((listing) => (
              <div key={listing.id} className="relative">
                <ProductCard listing={listing} />
                <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-[4px] font-small-subtext text-small-subtext text-on-surface flex items-center gap-1 z-10">
                  <span className="material-symbols-outlined text-[14px] text-star-yellow material-symbols-filled">star</span>
                  Destacado
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-xxl text-center">
            <span className="material-symbols-outlined text-6xl text-text-muted mb-4">star_border</span>
            <p className="text-text-secondary text-lg">No hay avisos destacados en este momento</p>
            <p className="text-text-muted text-sm mt-2">
              Los avisos destacados aparecerán aquí
            </p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
