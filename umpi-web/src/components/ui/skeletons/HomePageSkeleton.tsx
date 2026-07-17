import Skeleton from '../Skeleton'
import FeaturedCardSkeleton from './FeaturedCardSkeleton'
import ProductCardSkeleton from './ProductCardSkeleton'

export default function HomePageSkeleton() {
  return (
    <div className="bg-background text-on-surface font-body-base min-h-screen flex flex-col">
      {/* Navbar placeholder */}
      <div className="h-16 bg-surface border-b border-border-light" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col gap-xxl">
        {/* Category Slider skeleton */}
        <section className="w-full">
          <Skeleton className="h-7 w-48 mb-md" />
          <div className="flex gap-sm md:gap-md">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2 min-w-[80px]">
                <Skeleton className="w-16 h-16 rounded-[14px]" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </section>

        {/* Featured skeleton */}
        <section className="w-full">
          <div className="flex justify-between items-end mb-md">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex gap-lg">
            {Array.from({ length: 3 }).map((_, i) => (
              <FeaturedCardSkeleton key={i} />
            ))}
          </div>
        </section>

        {/* Recommended skeleton */}
        <section className="w-full">
          <Skeleton className="h-7 w-56 mb-md" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-md md:gap-lg">
            {Array.from({ length: 10 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </section>
      </main>

      {/* Footer placeholder */}
      <div className="h-24 bg-surface border-t border-border-light" />
    </div>
  )
}
