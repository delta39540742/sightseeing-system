interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  color?: 'blue' | 'white' | 'gray' | 'emerald'
  className?: string
}

const sizes = {
  xs: 'w-3 h-3 border',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-2',
  xl: 'w-12 h-12 border-[3px]',
}

const tracks = {
  blue:    'border-blue-200 border-t-blue-500',
  white:   'border-white/30 border-t-white',
  gray:    'border-gray-200 border-t-gray-500',
  emerald: 'border-emerald-200 border-t-emerald-500',
}

export function Spinner({ size = 'md', color = 'blue', className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Đang tải"
      className={`rounded-full animate-spin shrink-0 ${sizes[size]} ${tracks[color]} ${className}`}
    />
  )
}

export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
      <Spinner size="xl" />
      {label && <p className="text-sm text-gray-500">{label}</p>}
    </div>
  )
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-500">
      <Spinner size="sm" />
      {label}
    </span>
  )
}

export function TopProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[70] h-0.5 bg-blue-100 overflow-hidden">
      <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 animate-[progress_1.5s_ease-in-out_infinite]" />
    </div>
  )
}
