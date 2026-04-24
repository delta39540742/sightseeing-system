import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Camera, X } from 'lucide-react'
import { LandmarkRecognizer } from '@/components/landmark/LandmarkRecognizer'
import { tripService } from '@/services/tripService'
import type { Place } from '@/types'
import { placeService } from '@/services/placeService'
import { PlaceCard } from '@/components/places/PlaceCard'
import { useFavorites } from '@/hooks/useFavorites'

interface PlacesFilters {
  indoor_outdoor?: 'indoor' | 'outdoor' | 'mixed'
  is_landmark?: boolean
}

export default function Places() {
  const [page, setPage] = useState(1)
  const [places, setPlaces] = useState<Place[]>([])
  const [selectedPlaceToAdd, setSelectedPlaceToAdd] = useState<Place | null>(null)
  const [showRecognizer, setShowRecognizer] = useState(false)
  const [filters, setFilters] = useState<PlacesFilters>({
    indoor_outdoor: undefined,
    is_landmark: undefined,
  })
  const { isFavorite, add, remove } = useFavorites()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['places', page, filters],
    queryFn: () =>
      placeService.list({
        page,
        limit: 20,
        is_landmark: filters.is_landmark,
        indoor_outdoor: filters.indoor_outdoor,
      }),
    staleTime: 2 * 60 * 1000,
  })

  // Append new data instead of replacing
  useEffect(() => {
    if (!data) return
    if (page === 1) {
      setPlaces(data.places)
    } else {
      setPlaces((prev) => [...prev, ...data.places])
    }
  }, [data, page])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
    setPlaces([])
  }, [filters])

  const hasMore = data ? places.length < data.total : false

  const indoorOutdoorOptions: Array<{ value: PlacesFilters['indoor_outdoor']; label: string }> = [
    { value: undefined, label: 'Tất cả' },
    { value: 'indoor', label: 'Trong nhà' },
    { value: 'outdoor', label: 'Ngoài trời' },
    { value: 'mixed', label: 'Hỗn hợp' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-500" />
              <h1 className="text-lg font-bold text-gray-900">Địa điểm</h1>
            </div>
            <button 
              onClick={() => setShowRecognizer(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full"
            >
              <Camera className="w-4 h-4" />
              Nhận diện ảnh
            </button>
          </div>

          {/* Filter chips */}
          <div className="space-y-2">
            {/* Indoor/Outdoor filter */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {indoorOutdoorOptions.map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() =>
                    setFilters((f) => ({ ...f, indoor_outdoor: opt.value }))
                  }
                  className={`chip shrink-0 ${
                    filters.indoor_outdoor === opt.value
                      ? 'chip-active'
                      : 'chip-inactive'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Landmark toggle */}
            <div className="flex gap-1.5">
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    is_landmark: f.is_landmark ? undefined : true,
                  }))
                }
                className={`chip shrink-0 ${
                  filters.is_landmark ? 'chip-active' : 'chip-inactive'
                }`}
              >
                Điểm nổi bật
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Loading state for first page */}
        {isLoading && page === 1 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="card overflow-hidden animate-pulse"
              >
                <div className="h-32 bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Places grid */}
        {places.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {places.map((place) => (
              <PlaceCard
                key={place.placeId}
                place={place}
                onToggleFavorite={() => {
                  if (isFavorite(place.placeId)) {
                    remove(place.placeId)
                  } else {
                    add(place.placeId)
                  }
                }}
                onAdd={() => setSelectedPlaceToAdd(place)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && places.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Không tìm thấy địa điểm nào</p>
          </div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={isFetching}
              className="btn-secondary text-sm px-6 py-2 disabled:opacity-50"
            >
              {isFetching ? 'Đang tải…' : 'Xem thêm'}
            </button>
          </div>
        )}
      </div>

      {/* Add To Trip Modal */}
      {selectedPlaceToAdd && (
        <AddToTripModal 
          place={selectedPlaceToAdd} 
          onClose={() => setSelectedPlaceToAdd(null)} 
        />
      )}

      {/* Landmark Recognizer Modal */}
      {showRecognizer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative p-4">
            <button 
              onClick={() => setShowRecognizer(false)}
              className="absolute top-4 right-4 p-1.5 bg-gray-100 hover:bg-gray-200 rounded-full"
            >
              <X className="w-4 h-4" />
            </button>
            <LandmarkRecognizer />
          </div>
        </div>
      )}
    </div>
  )
}

function AddToTripModal({ place, onClose }: { place: Place; onClose: () => void }) {
  const { data: trips, isLoading } = useQuery({ queryKey: ['trips'], queryFn: tripService.list })
  const activeTrips = trips?.filter(t => t.status === 'active' || t.status === 'draft') || []
  const [adding, setAdding] = useState(false)

  const handleAdd = async (tripId: string) => {
    setAdding(true)
    try {
      await tripService.addSlot(tripId, place.placeId)
      alert('Đã thêm vào lịch trình!')
      onClose()
    } catch {
      alert('Lỗi khi thêm vào chuyến')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-gray-900">Thêm vào chuyến đi</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <MapPin className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-sm">{place.name}</p>
            <p className="text-xs text-gray-500">{place.avgVisitDurationMin} phút</p>
          </div>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-center text-gray-500 py-4">Đang tải...</p>
          ) : activeTrips.length === 0 ? (
            <p className="text-sm text-center text-gray-500 py-4">Không có chuyến đi nào đang hoạt động</p>
          ) : (
            activeTrips.map(trip => (
              <button
                key={trip.tripId}
                onClick={() => handleAdd(trip.tripId)}
                disabled={adding}
                className="w-full text-left p-3 border border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                <p className="font-medium text-sm">{trip.title || trip.destinationCity}</p>
                <p className="text-xs text-gray-500">
                  {new Date(trip.startDate).toLocaleDateString('vi-VN')} - {new Date(trip.endDate).toLocaleDateString('vi-VN')}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
