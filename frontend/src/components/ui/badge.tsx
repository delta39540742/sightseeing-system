interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning'
  size?: 'sm' | 'md'
  dot?: boolean
  className?: string
}

const variants: Record<string, string> = {
  default:     'bg-blue-100 text-blue-700 border-blue-200',
  secondary:   'bg-gray-100 text-gray-700 border-gray-200',
  outline:     'border border-gray-300 text-gray-700 bg-transparent',
  destructive: 'bg-red-100 text-red-700 border-red-200',
  success:     'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning:     'bg-amber-100 text-amber-700 border-amber-200',
}

const dotColors: Record<string, string> = {
  default:     'bg-blue-500',
  secondary:   'bg-gray-400',
  outline:     'bg-gray-500',
  destructive: 'bg-red-500',
  success:     'bg-emerald-500',
  warning:     'bg-amber-500',
}

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-medium border',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        variants[variant],
        className,
      ].join(' ')}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[variant]}`} />
      )}
      {children}
    </span>
  )
}
