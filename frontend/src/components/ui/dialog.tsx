import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  className?: string
  [key: string]: unknown
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange?.(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onOpenChange])

  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  )
}

export function DialogContent({ children, className = '' }: DialogProps) {
  return (
    <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-auto max-h-[90vh] overflow-y-auto ${className}`}>
      {children}
    </div>
  )
}

export function DialogHeader({ children, className = '' }: DialogProps) {
  return <div className={`px-6 pt-6 pb-4 border-b border-gray-100 ${className}`}>{children}</div>
}

export function DialogTitle({ children, className = '' }: DialogProps) {
  return <h2 className={`font-bold text-lg text-gray-900 ${className}`}>{children}</h2>
}

export function DialogDescription({ children, className = '' }: DialogProps) {
  return <p className={`text-sm text-gray-500 mt-1 ${className}`}>{children}</p>
}

export function DialogFooter({ children, className = '' }: DialogProps) {
  return <div className={`px-6 py-4 border-t border-gray-100 flex gap-2 justify-end ${className}`}>{children}</div>
}

export function DialogTrigger({ children }: DialogProps) {
  return <>{children}</>
}
