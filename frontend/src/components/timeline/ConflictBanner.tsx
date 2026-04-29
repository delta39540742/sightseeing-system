import { useState } from 'react'
import { X, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import type { ConflictInfo } from '@/types'

interface Props {
  conflict: ConflictInfo
  onViewProposal?: () => void
  onDismiss?: () => void
}

export function ConflictBanner({ conflict, onViewProposal, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      role="alert"
      className="mx-4 mb-1 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs overflow-hidden"
    >
      <div className="flex items-center gap-2 w-full px-3 py-2 text-left">
        <button
          className="flex-1 flex items-center gap-2 min-w-0"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
          <span className="flex-1 font-medium truncate">{conflict.message}</span>
          {expanded ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
        </button>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {onViewProposal && (
            <button
              onClick={onViewProposal}
              className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-md font-medium transition-colors"
            >
              Xem đề xuất
            </button>
          )}
          
          {onDismiss && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              aria-label="Tắt thông báo"
              className="p-1 hover:bg-red-200 rounded-md text-red-400 hover:text-red-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-red-200 pt-2">
          <p><span className="font-semibold">Nguyên nhân:</span> {conflict.cause}</p>
          <p><span className="font-semibold">Gợi ý:</span> {conflict.suggestion}</p>
        </div>
      )}
    </div>
  )
}
