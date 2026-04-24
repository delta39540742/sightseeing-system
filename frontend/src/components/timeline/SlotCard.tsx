import { useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MapPin, Clock, DollarSign, AlertTriangle, Info, Timer } from 'lucide-react'
import type { TripSlot } from '@/types'
import { ConflictBanner } from './ConflictBanner'
import { format, differenceInMinutes, parseISO } from 'date-fns'

interface SlotCardProps {
  slot: TripSlot
  index: number
  isActive?: boolean
  onFocus: (id: string) => void
  onClickInfo?: () => void
}

const activityColors: Record<TripSlot['activityType'], string> = {
  sightseeing: 'bg-blue-100 text-blue-700',
  meal:        'bg-orange-100 text-orange-700',
  rest:        'bg-purple-100 text-purple-700',
  transport:   'bg-gray-100 text-gray-700',
  activity:    'bg-green-100 text-green-700',
}

const activityLabels: Record<TripSlot['activityType'], string> = {
  sightseeing: 'Tham quan',
  meal:        'Ăn uống',
  rest:        'Nghỉ ngơi',
  transport:   'Di chuyển',
  activity:    'Hoạt động',
}

const statusConfig: Record<TripSlot['status'], { label: string; className: string }> = {
  planned:   { label: 'Dự kiến',  className: 'bg-sky-100 text-sky-700 border border-sky-200' },
  completed: { label: 'Hoàn thành', className: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
  skipped:   { label: 'Bỏ qua',   className: 'bg-slate-100 text-slate-500 border border-slate-200 line-through' },
  replaced:  { label: 'Thay thế', className: 'bg-amber-100 text-amber-700 border border-amber-200' },
}

function formatDuration(start: string, end: string): string {
  try {
    const mins = differenceInMinutes(parseISO(end), parseISO(start))
    if (mins < 60) return `${mins} phút`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h}g ${m}p` : `${h} giờ`
  } catch {
    return ''
  }
}

export function SlotCard({ slot, index, isActive, onFocus, onClickInfo }: SlotCardProps) {
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hovered, setHovered] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.slotId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const startTime = format(new Date(slot.plannedStart), 'HH:mm')
  const endTime   = format(new Date(slot.plannedEnd),   'HH:mm')
  const duration  = formatDuration(slot.plannedStart, slot.plannedEnd)
  const status    = statusConfig[slot.status] ?? statusConfig.planned
  const isSkipped = slot.status === 'skipped'

  return (
    <div ref={setNodeRef} style={style}>
      <div
        data-slot-id={slot.slotId}
        onClick={() => onFocus(slot.slotId)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={[
          'flex gap-3 px-4 py-3 transition-all cursor-pointer border-l-4',
          isActive
            ? 'bg-blue-50 border-l-blue-500'
            : slot.conflict
              ? 'border-l-red-400 hover:bg-red-50/40'
              : 'border-l-transparent hover:bg-gray-50',
          isSkipped  ? 'opacity-50' : '',
          slot.pending ? 'opacity-60' : '',
        ].join(' ')}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          aria-label="Kéo để sắp xếp"
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none shrink-0 mt-1"
          onTouchStart={() => {
            longPressRef.current = setTimeout(() => {
              document.body.style.overflow = 'hidden'
            }, 300)
          }}
          onTouchEnd={() => {
            if (longPressRef.current) clearTimeout(longPressRef.current)
            document.body.style.overflow = ''
          }}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Order badge */}
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold shrink-0 mt-0.5">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-start gap-2">
            <p className={`font-semibold text-sm text-gray-900 truncate flex-1 ${isSkipped ? 'line-through text-gray-400' : ''}`}>
              {slot.place?.name ?? `Địa điểm ${slot.placeId}`}
            </p>
            {onClickInfo && hovered && (
              <button
                onClick={(e) => { e.stopPropagation(); onClickInfo() }}
                aria-label="Xem thông tin địa điểm"
                className="shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            {slot.conflict && (
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" aria-label="Có xung đột" />
            )}
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {/* Time range */}
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              {startTime} → {endTime}
            </span>
            {/* Duration */}
            {duration && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Timer className="w-3 h-3" />
                {duration}
              </span>
            )}
            {/* Cost */}
            {slot.estimatedCost > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <DollarSign className="w-3 h-3" />
                {slot.estimatedCost.toLocaleString('vi-VN')}đ
              </span>
            )}
          </div>

          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Status badge */}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold tracking-wide ${status.className}`}>
              {status.label}
            </span>
            {/* Activity type badge */}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${activityColors[slot.activityType]}`}>
              {activityLabels[slot.activityType]}
            </span>
            {/* Indoor/outdoor */}
            {slot.place && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                <MapPin className="w-2.5 h-2.5" />
                {slot.place.indoorOutdoor === 'indoor'
                  ? 'Trong nhà'
                  : slot.place.indoorOutdoor === 'outdoor'
                    ? 'Ngoài trời'
                    : 'Hỗn hợp'}
              </span>
            )}
          </div>
        </div>
      </div>

      {slot.conflict && <ConflictBanner conflict={slot.conflict} />}
    </div>
  )
}
