import Skeleton from '../Skeleton'

export default function ProfilePageSkeleton() {
  return (
    <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col font-body-base">
      {/* Navbar placeholder */}
      <div className="h-16 bg-surface border-b border-border-light" />

      <main className="flex-grow w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-desktop py-xxl flex flex-col md:flex-row gap-8">
        {/* Left Column: Profile Info */}
        <aside className="w-full md:w-1/3 flex flex-col gap-6">
          {/* Profile Header Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col items-center text-center">
            <Skeleton className="w-32 h-32 rounded-full" />
            <Skeleton className="h-6 w-32 mt-4" />
            <Skeleton className="h-4 w-24 mt-2" />
            <Skeleton className="h-10 w-full mt-6 rounded-[14px]" />
          </div>

          {/* Reputation Card */}
          <div className="bg-surface rounded-xl shadow-card p-6 flex flex-col gap-4">
            <Skeleton className="h-6 w-28" />
            <div className="flex items-center gap-4">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <Skeleton className="h-px w-full" />
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          </div>
        </aside>

        {/* Right Column: Dashboard & Listings */}
        <section className="w-full md:w-2/3 flex flex-col gap-6">
          {/* Dashboard Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface p-4 rounded-xl shadow-card flex flex-col gap-1">
                <Skeleton className="w-5 h-5" />
                <Skeleton className="h-7 w-16 mt-1" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-8 border-b border-border-light">
            <Skeleton className="h-5 w-24 pb-3" />
            <Skeleton className="h-5 w-20 pb-3" />
          </div>

          {/* Listings Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-md md:gap-gutter">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl shadow-card overflow-hidden">
                <Skeleton className="h-[110px] md:h-[160px] w-full rounded-none" />
                <div className="p-4 flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-5 w-20 mt-2" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer placeholder */}
      <div className="h-24 bg-surface border-t border-border-light" />
    </div>
  )
}
