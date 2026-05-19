import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, MapPin, X, Loader2, Link, PlusCircle } from 'lucide-react'
import { placeService } from '@/services/placeService'
import type { Place } from '@/types'
import type { PlaceWithDistance } from '@/services/placeService'

interface PlaceSearchBarProps {
  onPlaceSelect: (place: Place) => void
  placeholder?: string
  className?: string
  /** Label hiển thị trên thanh tìm kiếm */
  label?: string
  /** Lọc kết quả theo thành phố đang lập kế hoạch */
  destinationCity?: string
}

/** Trích xuất lat/lng từ URL Google Maps trực tiếp. Trả null nếu không parse được. */
function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  // Ưu tiên !3d<lat>!4d<lng> — tọa độ chính xác của pin địa điểm
  const m3d = url.match(/!3d(-?\d+\.?\d+)/)
  const m4d = url.match(/!4d(-?\d+\.?\d+)/)
  if (m3d && m4d) return { lat: parseFloat(m3d[1]), lng: parseFloat(m4d[1]) }

  // Dạng: .../@lat,lng,zoom... — tâm viewport (ít chính xác hơn)
  const m1 = url.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/)
  if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) }

  // Dạng: ?q=lat,lng hoặc &q=lat,lng
  const m2 = url.match(/[?&]q=(-?\d+\.?\d+),(-?\d+\.?\d+)/)
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) }

  return null
}

/** Trích xuất tên địa điểm từ URL Google Maps (phần /place/TenDiaDiem/). */
function parsePlaceNameFromUrl(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/@?]+)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '))
  } catch {
    return m[1].replace(/\+/g, ' ')
  }
}

function isGoogleMapsUrl(text: string): boolean {
  return /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(text)
}

function isShortGoogleMapsUrl(text: string): boolean {
  return /maps\.app\.goo\.gl|goo\.gl\/maps/.test(text)
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function PlaceSearchBar({ onPlaceSelect, placeholder, className, label, destinationCity }: PlaceSearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceWithDistance[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // Tọa độ + tên trích xuất từ Google Maps URL — dùng để tạo custom place khi không có kết quả DB
  const [parsedCoords, setParsedCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [parsedName, setParsedName] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setResults([])
      setParsedCoords(null)
      setParsedName(null)
      setOpen(false)
      return
    }

    if (isGoogleMapsUrl(trimmed)) {
      setError(null)
      setIsLoading(true)
      setParsedCoords(null)
      setParsedName(null)
      try {
        // Với short URL: resolve về URL đầy đủ trước
        const fullUrl = isShortGoogleMapsUrl(trimmed)
          ? await placeService.resolveShortUrl(trimmed)
          : trimmed
        const coords = parseGoogleMapsUrl(fullUrl)
        if (!coords) {
          setError('Không đọc được tọa độ từ link này. Hãy thử link khác hoặc tìm theo tên.')
          setResults([])
          setOpen(true)
          return
        }
        const nameFromUrl = parsePlaceNameFromUrl(fullUrl)
        setParsedCoords(coords)
        setParsedName(nameFromUrl)
        const nearby = await placeService.searchNearby(coords.lat, coords.lng, 800)
        setResults(nearby)
        setOpen(true)
      } catch {
        setError('Không thể xử lý link này. Hãy thử link khác hoặc tìm theo tên.')
        setResults([])
        setOpen(true)
      } finally {
        setIsLoading(false)
      }
      return
    }

    setParsedCoords(null)
    setParsedName(null)
    setError(null)
    setIsLoading(true)
    try {
      const found = await placeService.searchByName(trimmed, destinationCity)
      setResults(found)
      setOpen(true)
    } catch {
      setError('Tìm kiếm thất bại. Vui lòng thử lại.')
    } finally {
      setIsLoading(false)
    }
  }, [destinationCity])

  async function handleUseLocation() {
    if (!parsedCoords) return
    setIsCreating(true)
    try {
      const name = parsedName ?? `Địa điểm (${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)})`
      const place = await placeService.createCustom(name, parsedCoords.lat, parsedCoords.lng)
      onPlaceSelect(place)
      setQuery('')
      setResults([])
      setParsedCoords(null)
      setParsedName(null)
      setOpen(false)
      setError(null)
    } catch {
      setError('Không thể thêm vị trí này. Vui lòng thử lại.')
    } finally {
      setIsCreating(false)
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      setError(null)
      return
    }
    // Google Maps URLs: tìm ngay, không debounce
    if (isGoogleMapsUrl(query)) {
      void search(query)
      return
    }
    debounceRef.current = setTimeout(() => void search(query), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search])

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(place: PlaceWithDistance) {
    onPlaceSelect(place)
    setQuery('')
    setResults([])
    setOpen(false)
    setError(null)
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      {label && (
        <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      )}
      <div className="relative flex items-center">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0 || error) setOpen(true) }}
          placeholder={placeholder ?? 'Tìm tên địa điểm hoặc dán link Google Maps...'}
          className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
        {!isLoading && query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false); setError(null) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (error || results.length > 0 || (parsedCoords != null && !isLoading)) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {error ? (
            <div className="px-4 py-3 text-sm text-amber-700 bg-amber-50 flex items-start gap-2">
              <Link className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {results.slice(0, 8).map((place) => (
                <button
                  key={place.placeId}
                  onClick={() => handleSelect(place)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0"
                >
                  <MapPin className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{place.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {place.distanceM != null && (
                        <span className="text-xs text-blue-600">{formatDistance(place.distanceM)}</span>
                      )}
                      {place.minPrice != null && (
                        <span className="text-xs text-gray-500">
                          {place.minPrice === 0 ? 'Miễn phí' : `${place.minPrice.toLocaleString('vi-VN')}đ`}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{place.avgVisitDurationMin} phút</span>
                    </div>
                  </div>
                </button>
              ))}

              {parsedCoords != null && (
                <button
                  onClick={handleUseLocation}
                  disabled={isCreating}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-green-50 transition-colors border-t border-gray-100 disabled:opacity-60"
                >
                  {isCreating
                    ? <Loader2 className="w-4 h-4 text-green-500 animate-spin shrink-0" />
                    : <PlusCircle className="w-4 h-4 text-green-500 shrink-0" />
                  }
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">
                      {parsedName ? `Dùng vị trí "${parsedName}"` : 'Dùng vị trí từ link này'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {results.length > 0 ? 'Không thấy địa điểm phù hợp?' : 'Địa điểm này chưa có trong hệ thống'} — thêm thủ công
                    </p>
                  </div>
                </button>
              )}

              {results.length === 0 && parsedCoords == null && (
                <div className="px-4 py-3 text-sm text-gray-500 text-center">Không tìm thấy địa điểm</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
