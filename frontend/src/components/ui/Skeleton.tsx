interface SkeletonProps {
  className?: string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
  style?: React.CSSProperties
}

const roundeds = { sm: 'rounded', md: 'rounded-lg', lg: 'rounded-xl', full: 'rounded-full' }

export function Skeleton({ className = '', rounded = 'md', style }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${roundeds[rounded]} ${className}`}
      aria-hidden="true"
      style={style}
    />
  )
}

export function TripCardSkeleton() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10" rounded="lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16" rounded="full" />
        <Skeleton className="h-5 w-20" rounded="full" />
      </div>
    </div>
  )
}

export function SlotCardSkeleton() {
  return (
    <div className="flex gap-3 py-3">
      <Skeleton className="w-10 h-10 shrink-0" rounded="full" />
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
      <Skeleton className="h-32 w-full" rounded="lg" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" rounded="full" />
        <Skeleton className="h-6 w-20" rounded="full" />
      </div>
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="w-16 h-16" rounded="full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}

export function FormSectionSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-20" rounded="full" />
        <Skeleton className="h-4 w-4" />
      </div>
      <div className="px-4 pb-4 pt-3 space-y-2 border-t border-gray-100">
        <div className="flex flex-wrap gap-2">
          {[80, 96, 64, 112, 72].map((w, i) => (
            <Skeleton key={i} className={`h-7`} rounded="full" style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  )
}
