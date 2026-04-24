interface CardProps {
  children?: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  [key: string]: unknown
}

const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

export function Card({ children, className = '', onClick, hoverable = false, padding = 'none' }: CardProps) {
  return (
    <div
      className={[
        'card',
        hoverable || onClick ? 'hover:shadow-md transition-shadow cursor-pointer' : '',
        paddings[padding],
        className,
      ].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: CardProps) {
  return <div className={`px-5 py-4 border-b border-gray-100 ${className}`}>{children}</div>
}

export function CardTitle({ children, className = '' }: CardProps) {
  return <h3 className={`font-semibold text-gray-900 ${className}`}>{children}</h3>
}

export function CardDescription({ children, className = '' }: CardProps) {
  return <p className={`text-sm text-gray-500 mt-0.5 ${className}`}>{children}</p>
}

export function CardContent({ children, className = '' }: CardProps) {
  return <div className={`p-5 ${className}`}>{children}</div>
}

export function CardFooter({ children, className = '' }: CardProps) {
  return <div className={`px-5 py-4 border-t border-gray-100 flex items-center gap-2 ${className}`}>{children}</div>
}
