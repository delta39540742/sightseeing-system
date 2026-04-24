import { useEffect, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { TripSlot } from '@/types'

interface TripMapProps {
  slots: TripSlot[]
  pendingSlots?: TripSlot[] | null
  focusedSlotId?: string | null
  startPoint?: [number, number]
  onMapClick?: (lat: number, lng: number) => void
  /** Called when user clicks a marker — passes the slotId */
  onMarkerClick?: (slotId: string) => void
  className?: string
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
export function TripMap({
  slots,
  pendingSlots,
  focusedSlotId,
  startPoint,
  onMapClick,
  onMarkerClick,
  className = '',
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
        const coords: [number, number][] = daySlots.map((s) => [s.place!.lat, s.place!.lng])
        if (coords.length < 2) return null
        return (
          <Polyline
            key={dayIdx}
            positions={coords}
            pathOptions={{
              color:     isPending ? '#94a3b8' : DAY_COLORS[dayIdx % DAY_COLORS.length],
              weight:    isPending ? 2 : 2.5,
              dashArray: isPending ? '8 4' : undefined,
              opacity:   isPending ? 0.45 : 0.7,
            }}
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

      <FocusController slots={displaySlots} focusedSlotId={focusedSlotId} />

      {onMapClick && <MapClickHandler onClick={onMapClick} />}
    </MapContainer>
  )
}
