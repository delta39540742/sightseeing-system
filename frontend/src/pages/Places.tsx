import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
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
        tags: filters.is_landmark ? 'landmark' : undefined,
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
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-5 h-5 text-blue-500" />
            <h1 className="text-lg font-bold text-gray-900">Địa điểm</h1>
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
    </div>
  )
}
