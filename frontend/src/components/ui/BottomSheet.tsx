import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

type SheetLevel = 'collapsed' | 'half' | 'full'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  defaultLevel?: SheetLevel
  /** Show sheet on desktop as a side-panel instead of bottom overlay */
  desktopSide?: boolean
  /** Footer slot rendered at the bottom of the sheet, always visible */
  footer?: React.ReactNode
}

const heights: Record<SheetLevel, string> = {
  collapsed: 'h-20',
  half: 'h-[55vh]',
  full: 'h-[92vh]',
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  defaultLevel = 'half',
  footer,
}: BottomSheetProps) {
  const [level, setLevel] = useState<SheetLevel>(defaultLevel)
  const startY = useRef(0)
  const isDragging = useRef(false)

  useEffect(() => {
    if (open) {
      setLevel(defaultLevel)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open, defaultLevel])

  if (!open) return null

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    isDragging.current = true
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!isDragging.current) return
    isDragging.current = false
    const diff = e.changedTouches[0].clientY - startY.current
    if (diff > 60) {
      // swipe down
      if (level === 'full') setLevel('half')
      else if (level === 'half') setLevel('collapsed')
      else onClose()
    } else if (diff < -60) {
      // swipe up
      if (level === 'collapsed') setLevel('half')
      else if (level === 'half') setLevel('full')
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className={`
          absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl
          flex flex-col transition-[height] duration-300 ease-out
          ${heights[level]}
        `}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <button
            onClick={() =>
              setLevel((l) => l === 'collapsed' ? 'half' : l === 'half' ? 'full' : 'collapsed')
            }
            aria-label="Kéo để thay đổi kích thước"
            className="flex-1 flex justify-center"
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors" />
          </button>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="ml-2 text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title / description */}
        {(title || description) && (
          <div className="px-4 pb-3 border-b border-gray-100 shrink-0">
            {title && <h3 className="font-semibold text-gray-900">{title}</h3>}
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin">
          {children}
        </div>

        {/* Sticky footer */}
        {footer && (
          <div className="shrink-0 px-4 py-3 border-t border-gray-100">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
