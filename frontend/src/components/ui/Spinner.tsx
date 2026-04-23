interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string }

const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Đang tải"
      className={`${sizes[size]} ${className} rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin`}
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Spinner size="lg" />
    </div>
  )
}

export function TopProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-blue-100">
      <div className="h-full bg-blue-500 animate-[progress_2s_ease-in-out_infinite]" style={{ width: '60%' }} />
    </div>
  )
}
