import { Clock, DollarSign, MapPin, Star, X } from 'lucide-react'
import type { Place } from '@/types'

const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

interface PlacePopupProps {
  place: Place
  open: boolean
  onClose: () => void
}

export function PlacePopup({ place, open, onClose }: PlacePopupProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-40 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-t-2xl overflow-hidden relative">
          {place.imageUrl && (
            <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
          )}
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="absolute top-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 rounded-lg text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <h3 className="font-bold text-gray-900">{place.name}</h3>
            {place.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{place.description as string}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-600">
            {place.rating && (
              <span className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                {place.rating}/5
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4 text-gray-400" />
              {place.avgVisitDurationMin} phút
            </span>
            {place.estimatedCost && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-4 h-4 text-gray-400" />
                ~{(place.estimatedCost / 1000).toFixed(0)}k/người
              </span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4 text-gray-400" />
              {place.indoorOutdoor === 'indoor' ? 'Trong nhà' : place.indoorOutdoor === 'outdoor' ? 'Ngoài trời' : 'Hỗn hợp'}
            </span>
          </div>

          {place.openingHours.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">Giờ mở cửa</p>
              <div className="grid grid-cols-7 gap-1 text-center">
                {days.map((d, i) => {
                  const oh = place.openingHours.find((h) => h.dayOfWeek === i)
                  return (
                    <div key={d} className="text-xs">
                      <p className="font-medium text-gray-500">{d}</p>
                      <p className="text-gray-700 text-[10px]">
                        {oh ? `${oh.openTime.slice(0, 5)}` : '–'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {place.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {place.tags.slice(0, 5).map((t) => (
                <span key={t.tagId} className="chip chip-inactive text-[11px]">
                  {(t as { name?: string }).name ?? `#${t.tagId}`}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
