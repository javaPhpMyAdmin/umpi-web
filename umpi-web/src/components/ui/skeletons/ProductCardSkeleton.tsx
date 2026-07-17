import Skeleton from '../Skeleton'

export default function ProductCardSkeleton() {
  return (
    <div className="bg-surface rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] overflow-hidden border border-surface-variant/50">
      <Skeleton className="h-[140px] md:h-[180px] w-full rounded-none" />
      <div className="p-3 md:p-4 flex flex-col gap-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  )
}
