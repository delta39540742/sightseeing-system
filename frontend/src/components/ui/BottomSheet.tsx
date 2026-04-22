import { useEffect, useRef, useState } from 'react'

type SheetLevel = 'collapsed' | 'half' | 'full'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  defaultLevel?: SheetLevel
}

const heights: Record<SheetLevel, string> = {
  collapsed: 'h-16',
  half: 'h-1/2',
  full: 'h-[90vh]',
}

export function BottomSheet({ open, onClose, title, children, defaultLevel = 'half' }: BottomSheetProps) {
  const [level, setLevel] = useState<SheetLevel>(defaultLevel)
  const startY = useRef(0)

  useEffect(() => { if (open) setLevel(defaultLevel) }, [open, defaultLevel])

  if (!open) return null

  const cycle = () => {
    setLevel((l) => l === 'collapsed' ? 'half' : l === 'half' ? 'full' : 'collapsed')
  }

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl transition-all duration-300 flex flex-col ${heights[level]} animate-slideUp`}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY }}
        onTouchEnd={(e) => {
          const diff = e.changedTouches[0].clientY - startY.current
          if (diff > 60) setLevel((l) => l === 'full' ? 'half' : l === 'half' ? 'collapsed' : 'collapsed')
          else if (diff < -60) setLevel((l) => l === 'collapsed' ? 'half' : l === 'half' ? 'full' : 'full')
        }}
      >
        <button
          onClick={cycle}
          aria-label="Kéo để thay đổi kích thước"
          className="flex justify-center pt-3 pb-2 shrink-0"
        >
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </button>
        {title && (
          <div className="px-4 pb-3 shrink-0">
            <h3 className="font-semibold text-gray-900">{title}</h3>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">{children}</div>
      </div>
    </div>
  )
}
