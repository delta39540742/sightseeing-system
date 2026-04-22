import { useState } from 'react'
import { Star, Clock, DollarSign, MapPin, Plus } from 'lucide-react'
import type { Place } from '@/types'
import { PlacePopup } from './PlacePopup'

interface PlaceCardProps {
  place: Place
  index?: number
  onAdd?: (place: Place) => void
  compact?: boolean
}

export function PlaceCard({ place, index, onAdd, compact }: PlaceCardProps) {
  const [showPopup, setShowPopup] = useState(false)

  if (compact) {
    return (
      <>
        <button
          onClick={() => setShowPopup(true)}
          className="flex items-center gap-3 w-full p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {index !== undefined ? index + 1 : <MapPin className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{place.name}</p>
            <p className="text-xs text-gray-500">
              {place.avgVisitDurationMin} phút
              {place.estimatedCost ? ` • ${(place.estimatedCost / 1000).toFixed(0)}k` : ''}
            </p>
          </div>
          {onAdd && (
            <button
              onClick={(e) => { e.stopPropagation(); onAdd(place) }}
              aria-label={`Thêm ${place.name}`}
              className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600 shrink-0"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </button>
        <PlacePopup place={place} open={showPopup} onClose={() => setShowPopup(false)} />
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowPopup(true)}
        className="card overflow-hidden hover:shadow-md transition-shadow w-full text-left"
      >
        <div className="h-32 bg-gradient-to-br from-blue-400 to-indigo-600 relative">
          {place.imageUrl && (
            <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
          )}
          <div className="absolute top-2 right-2">
            {onAdd && (
              <button
                onClick={(e) => { e.stopPropagation(); onAdd(place) }}
                aria-label={`Thêm ${place.name}`}
                className="p-1.5 bg-white rounded-lg shadow text-blue-600 hover:bg-blue-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="p-3 space-y-1.5">
          <p className="font-semibold text-sm truncate">{place.name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
            {place.rating && (
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                {place.rating}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {place.avgVisitDurationMin} phút
            </span>
            {place.estimatedCost && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {(place.estimatedCost / 1000).toFixed(0)}k
              </span>
            )}
          </div>
        </div>
      </button>
      <PlacePopup place={place} open={showPopup} onClose={() => setShowPopup(false)} />
    </>
  )
}
