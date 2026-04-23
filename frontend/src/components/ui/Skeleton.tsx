interface SkeletonProps { className?: string }

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function TripCardSkeleton() {
  return (
    <div className="card p-4 space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  )
}

export function SlotCardSkeleton() {
  return (
    <div className="flex gap-3 py-3">
      <Skeleton className="w-10 h-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

export function PlacePopupSkeleton() {
  return (
    <div className="space-y-3 w-64">
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}
