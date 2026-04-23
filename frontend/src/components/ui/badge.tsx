interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
  className?: string
}

const variants: Record<string, string> = {
  default:     'bg-blue-100 text-blue-700',
  secondary:   'bg-gray-100 text-gray-700',
  outline:     'border border-gray-200 text-gray-700',
  destructive: 'bg-red-100 text-red-700',
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}
