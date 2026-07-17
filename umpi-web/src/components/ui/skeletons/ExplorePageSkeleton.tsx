import Skeleton from '../Skeleton'
import ProductCardSkeleton from './ProductCardSkeleton'

export default function ExplorePageSkeleton() {
  return (
    <div className="bg-background text-on-background font-body-base antialiased min-h-screen flex flex-col">
      {/* Navbar placeholder */}
      <div className="h-16 bg-surface border-b border-border-light" />

      <main className="flex-1 w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col md:flex-row gap-margin-desktop">
        {/* Sidebar Filters skeleton */}
        <aside className="hidden md:block w-64 flex-shrink-0 space-y-xxl">
          <Skeleton className="h-3 w-32" />
          <div className="bg-surface rounded-[16px] p-lg shadow-sm border border-surface-variant">
            <Skeleton className="h-6 w-20 mb-lg" />
            <div className="space-y-md mb-xxl">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-sm">
                  <Skeleton className="w-4 h-4 rounded" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
            <Skeleton className="h-5 w-16 mb-md" />
            <div className="flex gap-sm mb-xxl">
              <Skeleton className="h-10 flex-1 rounded-[14px]" />
              <Skeleton className="h-10 flex-1 rounded-[14px]" />
            </div>
            <Skeleton className="h-5 w-20 mb-md" />
            <Skeleton className="h-10 w-full rounded-[14px]" />
          </div>
        </aside>

        {/* Results skeleton */}
        <section className="flex-1 flex flex-col">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-lg gap-sm">
            <div>
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-32 mt-2" />
            </div>
            <Skeleton className="h-10 w-[200px] rounded-[14px]" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] md:gap-lg">
            {Array.from({ length: 9 }).map((_, i) => (
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
