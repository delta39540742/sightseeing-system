import React, { useEffect, useRef, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { TripSlot, Place } from '@/types'
import { routingService } from '@/services/routingService'

interface TripMapProps {
  slots: TripSlot[]
  pendingSlots?: TripSlot[] | null
  focusedSlotId?: string | null
  startPoint?: [number, number]
  onMapClick?: (lat: number, lng: number) => void
  /** Called when user clicks a marker — passes the slotId */
  onMarkerClick?: (slotId: string) => void
  onRemoveSlot?: (slotId: string) => void
  className?: string
  nearbyPlaces?: Place[]
  onNearbyClick?: (place: Place) => void
  isFullScreen?: boolean
  toggleFullScreen?: () => void
}

// ── Focus controller: flies to focused slot ──────────────────────────────────
function FocusController({ slots, focusedSlotId }: { slots: TripSlot[]; focusedSlotId?: string | null }) {
  const map = useMap()
  const prevFocused = useRef<string | null>(null)

  useEffect(() => {
    if (!focusedSlotId || focusedSlotId === prevFocused.current) return
    const slot = slots.find((s) => s.slotId === focusedSlotId)
    if (slot?.place) {
      map.flyTo([slot.place.lat, slot.place.lng], 15, { animate: true, duration: 0.8 })
      prevFocused.current = focusedSlotId
    }
  }, [focusedSlotId, slots, map])

  return null
}

// ── Map click handler ─────────────────────────────────────────────────────────
function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng)
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [map, onClick])
  return null
}

// ── Routing Polyline ──────────────────────────────────────────────────────────
function RoutingPolyline({
  dayIdx,
  points,
  isPending,
}: {
  dayIdx: number
  points: { lat: number; lng: number }[]
  isPending: boolean
}) {
  const [routePath, setRoutePath] = useState<[number, number][]>([])

  useEffect(() => {
    if (points.length < 2) {
      setRoutePath([])
      return
    }
    let isMounted = true

    // Only re-fetch if coordinate values change
    const fetchRoute = async () => {
      try {
        const res = await routingService.getRoute(points)
        if (isMounted && res) {
          // OSRM returns [lng, lat], Leaflet needs [lat, lng]
          setRoutePath(res.geometry.coordinates.map((c) => [c[1], c[0]]))
        } else if (isMounted) {
          // Fallback to straight lines
          setRoutePath(points.map((p) => [p.lat, p.lng]))
        }
      } catch (error) {
        if (isMounted) setRoutePath(points.map((p) => [p.lat, p.lng]))
      }
    }

    fetchRoute()
    return () => { isMounted = false }
  }, [JSON.stringify(points)]) // Serialize points to prevent infinite loop

  if (routePath.length < 2) return null

  return (
    <Polyline
      positions={routePath}
      pathOptions={{
        color: isPending ? '#94a3b8' : DAY_COLORS[dayIdx % DAY_COLORS.length],
        weight: isPending ? 2 : 3.5,
        dashArray: isPending ? '8 4' : undefined,
        opacity: isPending ? 0.45 : 0.8,
      }}
    />
  )
}

// ── Day accent palette ────────────────────────────────────────────────────────
const DAY_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

// ── Old-plan marker icon (used in comparison mode) ───────────────────────────
function createOldMarkerIcon(dayIdx: number, orderInDay: number): L.DivIcon {
  const size = 24
  const color = DAY_COLORS[dayIdx % DAY_COLORS.length]
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:white;color:${color};
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;
      border:2px dashed ${color};
      box-shadow:0 1px 4px rgba(0,0,0,0.18);
      opacity:0.7;
    ">${orderInDay + 1}</div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ── Marker icon factory ───────────────────────────────────────────────────────
function createMarkerIcon(
  dayIdx: number,
  orderInDay: number,
  isFocused: boolean,
  hasConflict: boolean,
  isPending: boolean,
  status: TripSlot['status'],
) {
  const baseColor = hasConflict ? '#ef4444' : DAY_COLORS[dayIdx % DAY_COLORS.length]
  const isSkipped  = status === 'skipped'
  const isComplete = status === 'completed'

  const size       = isFocused ? 36 : 28
  const borderPx   = isFocused ? 3 : 2
  const shadow     = isFocused
    ? '0 0 0 4px rgba(59,130,246,0.35), 0 4px 12px rgba(0,0,0,0.35)'
    : '0 2px 8px rgba(0,0,0,0.28)'

  const bg = isSkipped
    ? '#94a3b8'
    : isPending
      ? '#94a3b8'
      : baseColor

  const checkmark = isComplete
    ? `<span style="position:absolute;top:-4px;right:-4px;background:#10b981;border-radius:50%;width:12px;height:12px;display:flex;align-items:center;justify-content:center;font-size:7px;color:white;border:1px solid white;">✓</span>`
    : ''

  return L.divIcon({
    html: `
      <div style="position:relative;display:inline-block;">
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${bg};color:white;
          display:flex;align-items:center;justify-content:center;
          font-size:${isFocused ? 13 : 11}px;font-weight:700;
          border:${borderPx}px solid white;
          box-shadow:${shadow};
          transition:all 0.2s ease;
          opacity:${isSkipped ? 0.55 : 1};
        ">${orderInDay + 1}</div>
        ${checkmark}
      </div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// ── Main component ─────────────────────────────────────────────────────────────
export const TripMap = React.memo(function TripMap({
  slots,
  pendingSlots,
  focusedSlotId,
  startPoint,
  onMapClick,
  onMarkerClick,
  onRemoveSlot,
  className = '',
  nearbyPlaces,
  onNearbyClick,
  isFullScreen,
  toggleFullScreen,
}: TripMapProps) {
  const displaySlots = pendingSlots ?? slots
  const placedSlots  = displaySlots.filter((s) => s.place)
  
  const originalPlacedSlots = slots.filter(s => s.place)

  const center: [number, number] = placedSlots[0]?.place
    ? [placedSlots[0].place.lat, placedSlots[0].place.lng]
    : startPoint ?? [16.047, 108.206]

  // Group by dayIndex, sorted by slotOrder within each day
  const slotsByDay = useMemo(() => {
    const map = new Map<number, TripSlot[]>()
    placedSlots.forEach((s) => {
      const day = s.dayIndex ?? 0
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(s)
    })
    for (const daySlots of map.values()) {
      daySlots.sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime())
    }
    return map
  }, [placedSlots])

  const originalSlotsByDay = useMemo(() => {
    const map = new Map<number, TripSlot[]>()
    originalPlacedSlots.forEach((s) => {
      const day = s.dayIndex ?? 0
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(s)
    })
    for (const daySlots of map.values()) {
      daySlots.sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime())
    }
    return map
  }, [originalPlacedSlots])

  return (
    <div className={`relative w-full h-full ${isFullScreen ? 'fixed inset-0 z-[1000] bg-white' : ''}`}>
      <MapContainer
        center={center}
        zoom={13}
        className={`w-full h-full ${!isFullScreen ? 'rounded-xl' : ''} ${className}`}
        style={{ minHeight: '100%' }}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Original Route (Faded) */}
        {pendingSlots && Array.from(originalSlotsByDay.entries()).map(([dayIdx, daySlots]) => {
          const points = daySlots.map((s) => ({ lat: s.place!.lat, lng: s.place!.lng }))
          if (points.length < 2) return null
          return (
            <RoutingPolyline
              key={`orig-${dayIdx}`}
              dayIdx={dayIdx}
              points={points}
              isPending={true}
            />
          )
        })}

        {/* Old-plan markers (comparison mode only) */}
        {pendingSlots && Array.from(originalSlotsByDay.entries()).map(([dayIdx, daySlots]) =>
          daySlots.map((slot, orderInDay) => (
            <Marker
              key={`old-marker-${slot.slotId}`}
              position={[slot.place!.lat, slot.place!.lng]}
              icon={createOldMarkerIcon(dayIdx, orderInDay)}
            >
              <Popup>
                <div className="min-w-[160px] text-sm">
                  <p className="text-[10px] text-gray-400 mb-0.5">
                    Lịch trình cũ · Ngày {(slot.dayIndex ?? 0) + 1} · #{orderInDay + 1}
                  </p>
                  <p className="font-semibold text-gray-700">{slot.place!.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(slot.plannedStart).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {new Date(slot.plannedEnd).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))
        )}

        {/* Display Route (Current or Pending) */}
        {Array.from(slotsByDay.entries()).map(([dayIdx, daySlots]) => {
          const points = daySlots.map((s) => ({ lat: s.place!.lat, lng: s.place!.lng }))
          if (points.length < 2) return null
          return (
            <RoutingPolyline
              key={`disp-${dayIdx}`}
              dayIdx={dayIdx}
              points={points}
              isPending={false}
            />
          )
        })}

        {/* Start point marker */}
        {startPoint && (
          <Marker
            position={startPoint}
            icon={L.divIcon({
              html: `<div style="width:22px;height:22px;border-radius:50%;background:#10b981;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);" title="Điểm xuất phát"></div>`,
              className: '',
              iconSize:   [22, 22],
              iconAnchor: [11, 11],
            })}
          >
            <Popup>Điểm xuất phát</Popup>
          </Marker>
        )}

        {/* Place markers */}
        {Array.from(slotsByDay.entries()).map(([dayIdx, daySlots]) =>
          daySlots.map((slot, orderInDay) => {
            const isFocused = slot.slotId === focusedSlotId
            return (
              <Marker
                key={slot.slotId}
                position={[slot.place!.lat, slot.place!.lng]}
                icon={createMarkerIcon(dayIdx, orderInDay, isFocused, !!slot.conflict, !!pendingSlots && !displaySlots.includes(slot), slot.status)}
                eventHandlers={{
                  click: () => onMarkerClick?.(slot.slotId),
                }}
              >
                <Popup>
                  <div className="min-w-[180px] text-sm">
                    <p className="text-xs text-gray-400 mb-0.5">
                      Ngày {(slot.dayIndex ?? 0) + 1} · #{orderInDay + 1}
                    </p>
                    <p className="font-semibold text-gray-900">{slot.place!.name}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(slot.plannedStart).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      {' → '}
                      {new Date(slot.plannedEnd).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button 
                        onClick={() => onRemoveSlot?.(slot.slotId)}
                        className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-bold border border-red-100 hover:bg-red-100 transition-colors"
                      >
                        BỎ QUA
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })
        )}

        {/* Nearby suggestion dots */}
        {nearbyPlaces?.map((place) => (
          <CircleMarker
            key={`nearby-${place.placeId}`}
            center={[place.lat, place.lng]}
            radius={9}
            pathOptions={{ fillColor: '#f59e0b', color: '#d97706', weight: 2, fillOpacity: 0.85, opacity: 1 }}
            eventHandlers={{ click: () => onNearbyClick?.(place) }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
              <div style={{ minWidth: 160, maxWidth: 220 }}>
                {place.imageUrl && (
                  <img
                    src={place.imageUrl}
                    alt={place.name}
                    style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }}
                  />
                )}
                <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 2px' }}>{place.name}</p>
                {place.rating != null && (
                  <p style={{ fontSize: 11, color: '#92400e', margin: '0 0 4px' }}>⭐ {place.rating.toFixed(1)}</p>
                )}
                {place.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {place.tags.slice(0, 3).map((t) => (
                      <span
                        key={t.tagId}
                        style={{
                          background: '#fef3c7', color: '#92400e', borderRadius: 9999,
                          padding: '1px 7px', fontSize: 10, fontWeight: 600,
                        }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}

        <FocusController slots={displaySlots} focusedSlotId={focusedSlotId} />

        {onMapClick && <MapClickHandler onClick={onMapClick} />}
      </MapContainer>
      
      {toggleFullScreen && (
        <button
          onClick={toggleFullScreen}
          className="absolute top-4 right-4 z-[1001] bg-white p-2 rounded-lg shadow-lg border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          {isFullScreen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          )}
        </button>
      )}
    </div>
  )
})
