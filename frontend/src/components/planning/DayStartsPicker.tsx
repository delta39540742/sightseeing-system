import { MapPin, X, ChevronDown } from 'lucide-react'
import type { Place } from '@/types'

export interface DayStartEntry {
  lat: number
  lng: number
  name?: string
}

interface DayStartsPickerProps {
  tripDays: number
  values: Record<number, DayStartEntry>
  /** Danh sách place đã được user chọn (anchor) để pick từ dropdown. */
  anchorPlaces: Place[]
  /** Khi != null: đang chờ click trên bản đồ để set start cho day này. */
  pickingDay: number | null
  onStartPickingDay: (dayIndex: number) => void
  onClearDay: (dayIndex: number) => void
  onSelectPlace: (dayIndex: number, place: Place) => void
}

/**
 * UI cho user chọn điểm bắt đầu mỗi ngày. Có 2 cách input:
 * - "Bản đồ": vào map-click mode cho day đó
 * - Dropdown: chọn 1 anchor place làm điểm bắt đầu
 * Mỗi ngày không set → planner fallback về điểm xuất phát chính / khách sạn.
 */
export function DayStartsPicker({
  tripDays,
  values,
  anchorPlaces,
  pickingDay,
  onStartPickingDay,
  onClearDay,
  onSelectPlace,
}: DayStartsPickerProps) {
  if (tripDays <= 0) return null

  const rows = Array.from({ length: tripDays }, (_, i) => i)

  return (
    <div className="rounded-lg bg-gray-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5 text-gray-500" />
        <p className="text-xs font-semibold text-gray-700">Điểm bắt đầu mỗi ngày</p>
      </div>
      <p className="text-[10px] text-gray-400 leading-snug">
        Không bắt buộc. Bỏ trống → dùng điểm xuất phát chính cho mọi ngày.
      </p>

      <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin pr-1">
        {rows.map((dayIndex) => {
          const entry = values[dayIndex]
          const isPicking = pickingDay === dayIndex
          return (
            <div
              key={dayIndex}
              className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 ${
                isPicking ? 'bg-blue-50 ring-1 ring-blue-300' : 'bg-white'
              }`}
            >
              <span className="shrink-0 font-medium text-gray-600 w-12">
                Ngày {dayIndex + 1}
              </span>

              {entry ? (
                <span className="flex-1 truncate text-green-700" title={entry.name}>
                  {entry.name ?? `${entry.lat.toFixed(4)}, ${entry.lng.toFixed(4)}`}
                </span>
              ) : isPicking ? (
                <span className="flex-1 italic text-blue-600">
                  Nhấn vào bản đồ…
                </span>
              ) : (
                <span className="flex-1 italic text-gray-400">Mặc định</span>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onStartPickingDay(dayIndex)}
                  className="text-blue-500 hover:text-blue-700 underline"
                >
                  Bản đồ
                </button>

                {anchorPlaces.length > 0 && (
                  <div className="relative inline-block">
                    <select
                      value=""
                      onChange={(e) => {
                        const id = Number(e.target.value)
                        const p = anchorPlaces.find((x) => x.placeId === id)
                        if (p) onSelectPlace(dayIndex, p)
                      }}
                      className="appearance-none pr-4 pl-1 text-blue-500 hover:text-blue-700 underline bg-transparent cursor-pointer"
                    >
                      <option value="">Địa điểm</option>
                      {anchorPlaces.map((p) => (
                        <option key={p.placeId} value={p.placeId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 text-blue-500 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                )}

                {entry && (
                  <button
                    type="button"
                    onClick={() => onClearDay(dayIndex)}
                    className="text-gray-400 hover:text-red-500"
                    aria-label={`Xoá điểm bắt đầu ngày ${dayIndex + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
