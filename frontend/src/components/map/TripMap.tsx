import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { TripSlot, Place } from '@/types'

interface TripMapProps {
  slots: TripSlot[]
  pendingSlots?: TripSlot[] | null
  focusedSlotId?: string | null
  startPoint?: [number, number]
  onMapClick?: (lat: number, lng: number) => void
  className?: string
}

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

function createNumberedIcon(n: number, hasConflict: boolean) {
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${hasConflict ? '#ef4444' : '#3b82f6'};
      color:white;display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:700;border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);">${n}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

export function TripMap({ slots, pendingSlots, focusedSlotId, startPoint, onMapClick, className = '' }: TripMapProps) {
  const displaySlots = pendingSlots ?? slots
  const placedSlots = displaySlots.filter((s) => s.place)
  const isPending = !!pendingSlots

  const center: [number, number] = placedSlots[0]?.place
    ? [placedSlots[0].place.lat, placedSlots[0].place.lng]
    : startPoint ?? [16.047, 108.206]

  const routeCoords: [number, number][] = placedSlots.map((s) => [s.place!.lat, s.place!.lng])

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

      {routeCoords.length > 1 && (
        <Polyline
          positions={routeCoords}
          pathOptions={{
            color: isPending ? '#94a3b8' : '#3b82f6',
            weight: 3,
            dashArray: isPending ? '8 4' : undefined,
            opacity: isPending ? 0.6 : 0.9,
          }}
        />
      )}

      {startPoint && (
        <Marker
          position={startPoint}
          icon={L.divIcon({
            html: `<div style="width:24px;height:24px;border-radius:50%;background:#10b981;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);" title="Điểm xuất phát"></div>`,
            className: '',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          })}
        >
          <Popup>Điểm xuất phát</Popup>
        </Marker>
      )}

      {placedSlots.map((slot, i) => (
        <Marker
          key={slot.slotId}
          position={[slot.place!.lat, slot.place!.lng]}
          icon={createNumberedIcon(i + 1, !!slot.conflict)}
        >
          <Popup>
            <div className="min-w-[160px]">
              <p className="font-semibold text-sm">{slot.place!.name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(slot.plannedStart).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                {' → '}
                {new Date(slot.plannedEnd).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </p>
              {slot.conflict && (
                <p className="text-xs text-red-500 mt-1">⚠ {slot.conflict.message}</p>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      <FocusController slots={displaySlots} focusedSlotId={focusedSlotId} />

      {onMapClick && <MapClickHandler onClick={onMapClick} />}
    </MapContainer>
  )
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => onClick(e.latlng.lat, e.latlng.lng)
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [map, onClick])
  return null
}
