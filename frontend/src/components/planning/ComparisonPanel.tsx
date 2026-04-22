import { Zap, DollarSign, Camera } from 'lucide-react'
import type { SortMode } from '@/types'
import { useTripStore } from '@/store/tripStore'

const modes: Array<{ id: SortMode; icon: React.ReactNode; label: string; desc: string }> = [
  { id: 'fastest', icon: <Zap className="w-4 h-4" />,       label: 'Nhanh nhất',  desc: 'Tối ưu thời gian di chuyển' },
  { id: 'cheapest', icon: <DollarSign className="w-4 h-4" />, label: 'Rẻ nhất',    desc: 'Ưu tiên chi phí thấp' },
  { id: 'scenic',   icon: <Camera className="w-4 h-4" />,    label: 'Cảnh đẹp nhất', desc: 'Địa điểm đẹp, check-in' },
]

export function ComparisonPanel() {
  const { sortMode, setSortMode } = useTripStore()

  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-gray-600 mb-3">So sánh phương án</p>
      <div className="space-y-2">
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
    </div>
  )
}
