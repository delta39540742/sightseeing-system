import { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import type { ConflictInfo } from '@/types'

interface Props { conflict: ConflictInfo }

export function ConflictBanner({ conflict }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      role="alert"
      className="mx-4 mb-1 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs overflow-hidden"
    >
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <X className="w-3.5 h-3.5 shrink-0 text-red-500" />
        <span className="flex-1 font-medium">{conflict.message}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-red-200">
          <p><span className="font-semibold">Nguyên nhân:</span> {conflict.cause}</p>
          <p><span className="font-semibold">Gợi ý:</span> {conflict.suggestion}</p>
        </div>
      )}
    </div>
  )
}
