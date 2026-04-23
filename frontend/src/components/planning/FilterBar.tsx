import { useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import type { FilterCategory } from '@/types'

const categories: Array<{ id: FilterCategory; label: string }> = [
  { id: 'all',         label: 'Tất cả' },
  { id: 'sightseeing', label: 'Tham quan' },
  { id: 'meal',        label: 'Ẩm thực' },
  { id: 'activity',    label: 'Hoạt động' },
  { id: 'rest',        label: 'Nghỉ ngơi' },
]

interface AdvancedFilters {
  maxPrice: number
  minRating: number
  openNow: boolean
  maxDistanceKm: number
}

interface FilterBarProps {
  active: FilterCategory
  onChange: (c: FilterCategory) => void
  advanced: AdvancedFilters
  onAdvancedChange: (f: AdvancedFilters) => void
  searchQuery: string
  onSearch: (q: string) => void
}

export function FilterBar({ active, onChange, advanced, onAdvancedChange, searchQuery, onSearch }: FilterBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Tìm địa điểm…"
          className="input flex-1 text-sm"
          aria-label="Tìm kiếm địa điểm"
        />
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          aria-label="Bộ lọc nâng cao"
          aria-expanded={showAdvanced}
          className={`p-2 rounded-lg border transition-colors ${showAdvanced ? 'bg-blue-100 border-blue-300 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            className={`chip shrink-0 ${active === c.id ? 'chip-active' : 'chip-inactive'}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {showAdvanced && (
        <div className="card p-4 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Bộ lọc nâng cao</span>
            <button onClick={() => setShowAdvanced(false)} className="p-1 hover:bg-gray-100 rounded">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">
              Giá tối đa: {advanced.maxPrice === 0 ? 'Miễn phí' : `${(advanced.maxPrice / 1000).toFixed(0)}k`}
            </label>
            <input
              type="range"
              min={0}
              max={500000}
              step={10000}
              value={advanced.maxPrice}
              onChange={(e) => onAdvancedChange({ ...advanced, maxPrice: +e.target.value })}
              className="w-full accent-blue-500 mt-1"
              aria-label="Giá tối đa"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">
              Đánh giá tối thiểu: {advanced.minRating} sao
            </label>
            <input
              type="range"
              min={1}
              max={5}
              step={0.5}
              value={advanced.minRating}
              onChange={(e) => onAdvancedChange({ ...advanced, minRating: +e.target.value })}
              className="w-full accent-blue-500 mt-1"
              aria-label="Đánh giá tối thiểu"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">
              Khoảng cách tối đa: {advanced.maxDistanceKm} km
            </label>
            <input
              type="range"
              min={1}
              max={50}
              value={advanced.maxDistanceKm}
              onChange={(e) => onAdvancedChange({ ...advanced, maxDistanceKm: +e.target.value })}
              className="w-full accent-blue-500 mt-1"
              aria-label="Khoảng cách tối đa"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={advanced.openNow}
              onChange={(e) => onAdvancedChange({ ...advanced, openNow: e.target.checked })}
              className="accent-blue-500"
            />
            <span className="text-xs text-gray-700">Chỉ hiển thị đang mở cửa</span>
          </label>
        </div>
      )}
    </div>
  )
}
