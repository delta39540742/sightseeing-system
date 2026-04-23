interface CardProps {
  children?: React.ReactNode
  className?: string
  [key: string]: unknown
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={`card ${className}`}>{children}</div>
}

export function CardHeader({ children, className = '' }: CardProps) {
  return <div className={`px-6 py-4 border-b border-gray-100 ${className}`}>{children}</div>
}

export function CardTitle({ children, className = '' }: CardProps) {
  return <h3 className={`font-semibold text-gray-900 ${className}`}>{children}</h3>
}

export function CardContent({ children, className = '' }: CardProps) {
  return <div className={`p-6 ${className}`}>{children}</div>
}

export function CardFooter({ children, className = '' }: CardProps) {
  return <div className={`px-6 py-4 border-t border-gray-100 ${className}`}>{children}</div>
}
