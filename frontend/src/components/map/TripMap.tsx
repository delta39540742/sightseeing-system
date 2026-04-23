import { useEffect, useRef, useMemo } from 'react'
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

const DAY_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4']

function createDayIcon(dayIdx: number, orderInDay: number, hasConflict: boolean, dayColors: string[]) {
  const color = hasConflict ? '#ef4444' : dayColors[dayIdx % dayColors.length]
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};color:white;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);">${orderInDay + 1}</div>`,
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

  // Group slots by dayIndex
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

      {Array.from(slotsByDay.entries()).map(([dayIdx, daySlots]) => {
        const coords: [number, number][] = daySlots.map((s) => [s.place!.lat, s.place!.lng])
        if (coords.length < 2) return null
        return (
          <Polyline
            key={dayIdx}
            positions={coords}
            pathOptions={{
              color: isPending ? '#94a3b8' : DAY_COLORS[dayIdx % DAY_COLORS.length],
              weight: 2.5,
              dashArray: isPending ? '8 4' : undefined,
              opacity: isPending ? 0.5 : 0.75,
            }}
          />
        )
      })}

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

      {Array.from(slotsByDay.entries()).map(([dayIdx, daySlots]) =>
        daySlots.map((slot, orderInDay) => (
          <Marker
            key={slot.slotId}
            position={[slot.place!.lat, slot.place!.lng]}
            icon={createDayIcon(dayIdx, orderInDay, !!slot.conflict, DAY_COLORS)}
          >
            <Popup>
              <div className="min-w-[160px]">
                <p className="text-xs text-gray-400 mb-0.5">Ngày {dayIdx + 1}</p>
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
        ))
      )}

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
