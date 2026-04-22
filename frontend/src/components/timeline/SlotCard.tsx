import { useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MapPin, Clock, DollarSign, AlertTriangle } from 'lucide-react'
import type { TripSlot } from '@/types'
import { ConflictBanner } from './ConflictBanner'
import { format } from 'date-fns'

interface SlotCardProps {
  slot: TripSlot
  index: number
  isActive?: boolean
  onFocus: (id: string) => void
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

export function SlotCard({ slot, index, isActive, onFocus }: SlotCardProps) {
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    opacity: isDragging ? 0.5 : 1,
  }

  const startTime = format(new Date(slot.plannedStart), 'HH:mm')
  const endTime = format(new Date(slot.plannedEnd), 'HH:mm')

  return (
    <div ref={setNodeRef} style={style}>
      <div
        data-slot-id={slot.slotId}
        onClick={() => onFocus(slot.slotId)}
        className={`
          flex gap-3 px-4 py-3 transition-all cursor-pointer
          ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}
          ${slot.pending ? 'opacity-60' : ''}
          ${slot.conflict ? 'border-l-2 border-red-400' : ''}
        `}
      >
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

        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold shrink-0">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <p className="font-medium text-sm text-gray-900 truncate flex-1">
              {slot.place?.name ?? `Địa điểm ${slot.placeId}`}
            </p>
            {slot.conflict && (
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" aria-label="Có xung đột" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              {startTime} → {endTime}
            </span>
            {slot.estimatedCost > 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <DollarSign className="w-3 h-3" />
                {slot.estimatedCost.toLocaleString('vi-VN')}đ
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${activityColors[slot.activityType]}`}>
              {activityLabels[slot.activityType]}
            </span>
          </div>

          {slot.place && (
            <p className="flex items-center gap-1 text-xs text-gray-400 mt-1">
              <MapPin className="w-3 h-3" />
              {slot.place.indoorOutdoor === 'indoor' ? 'Trong nhà' : slot.place.indoorOutdoor === 'outdoor' ? 'Ngoài trời' : 'Hỗn hợp'}
            </p>
          )}
        </div>
      </div>

      {slot.conflict && <ConflictBanner conflict={slot.conflict} />}
    </div>
  )
}
