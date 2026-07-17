import Skeleton from '../Skeleton'

export default function FeaturedCardSkeleton() {
  return (
    <div className="flex-none w-[280px] bg-surface rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.08)] overflow-hidden">
      <Skeleton className="h-[160px] w-full rounded-none" />
      <div className="p-4 flex flex-col gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}
