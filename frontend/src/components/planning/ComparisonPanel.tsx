import { Zap, DollarSign, Camera, Check } from 'lucide-react'
import type { SortMode, Place } from '@/types'
import { useTripStore } from '@/store/tripStore'

const modes: Array<{ id: SortMode; icon: React.ReactNode; label: string; desc: string }> = [
  { id: 'fastest', icon: <Zap className="w-4 h-4" />,        label: 'Nhanh nhất',     desc: 'Tối ưu thời gian di chuyển' },
  { id: 'cheapest', icon: <DollarSign className="w-4 h-4" />, label: 'Rẻ nhất',        desc: 'Ưu tiên chi phí thấp' },
  { id: 'scenic',   icon: <Camera className="w-4 h-4" />,     label: 'Cảnh đẹp nhất',  desc: 'Địa điểm đẹp, check-in' },
]

interface ComparisonPanelProps {
  candidates?: Place[]
  selectedIds: number[]
  onToggle: (placeId: number) => void
}

export function ComparisonPanel({ candidates, selectedIds, onToggle }: ComparisonPanelProps) {
  const { sortMode, setSortMode } = useTripStore()

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-600">So sánh phương án</p>
        {candidates && candidates.length > 0 && (
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
            {candidates.length} địa điểm phù hợp
          </span>
        )}
      </div>
      <div className="space-y-2 mb-4">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setSortMode(m.id)}
            className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border transition-all text-left ${
              sortMode === m.id
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <span className={sortMode === m.id ? 'text-blue-600' : 'text-gray-400'}>{m.icon}</span>
            <div>
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs opacity-70">{m.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {candidates && candidates.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-600 mb-3">Chọn điểm đến ưu tiên</p>
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
            {candidates.map((p) => (
              <button
                key={p.placeId}
                onClick={() => onToggle(p.placeId)}
                className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                  selectedIds.includes(p.placeId)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="h-16 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 mb-2" />
                <p className="text-xs font-semibold text-gray-800 truncate">{p.name}</p>
                <p className="text-xs text-gray-400">{p.avgVisitDurationMin} phút</p>
                {selectedIds.includes(p.placeId) && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
