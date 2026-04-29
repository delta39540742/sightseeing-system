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
  className?: string
  nearbyPlaces?: Place[]
  onNearbyClick?: (place: Place) => void
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
  className = '',
  nearbyPlaces,
  onNearbyClick,
}: TripMapProps) {
  const displaySlots = pendingSlots ?? slots
  const placedSlots  = displaySlots.filter((s) => s.place)
  const isPending    = !!pendingSlots

  const center: [number, number] = placedSlots[0]?.place
    ? [placedSlots[0].place.lat, placedSlots[0].place.lng]
    : startPoint ?? [16.047, 108.206]

  // Group by dayIndex
  const slotsByDay = useMemo(() => {
    const map = new Map<number, TripSlot[]>()
    placedSlots.forEach((s) => {
      const day = s.dayIndex ?? 0
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(s)
    })
    return map
  }, [placedSlots])

  return (
    <MapContainer
      center={center}
      zoom={13}
      className={`w-full h-full rounded-xl ${className}`}
      style={{ minHeight: '100%' }}
    >
      <TileLayer
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Route polylines per day */}
      {Array.from(slotsByDay.entries()).map(([dayIdx, daySlots]) => {
        const points = daySlots.map((s) => ({ lat: s.place!.lat, lng: s.place!.lng }))
        if (points.length < 2) return null
        return (
          <RoutingPolyline
            key={dayIdx}
            dayIdx={dayIdx}
            points={points}
            isPending={isPending}
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
              icon={createMarkerIcon(dayIdx, orderInDay, isFocused, !!slot.conflict, isPending, slot.status)}
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
                  {slot.estimatedCost > 0 && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {slot.estimatedCost.toLocaleString('vi-VN')}đ
                    </p>
                  )}
                  <p className={`text-xs mt-1 font-medium ${
                    slot.status === 'completed' ? 'text-emerald-600' :
                    slot.status === 'skipped'   ? 'text-gray-400'   :
                    'text-sky-600'
                  }`}>
                    {slot.status === 'completed' ? '✓ Hoàn thành' :
                     slot.status === 'skipped'   ? '— Bỏ qua'    :
                     '● Dự kiến'}
                  </p>
                  {slot.conflict && (
                    <p className="text-xs text-red-500 mt-1">⚠ {slot.conflict.message}</p>
                  )}
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
  )
});
