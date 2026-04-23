import { useState } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronUp, Calendar, Clock, DollarSign } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { TripSlot } from '@/types'
import { SlotCard } from './SlotCard'

interface DayGroupProps {
  dayIndex: number
  date: string
  slots: TripSlot[]
  focusedSlotId: string | null
  onFocus: (id: string) => void
  dayColors: string[]
}

export function DayGroup({ dayIndex, date, slots, focusedSlotId, onFocus, dayColors }: DayGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIndex}` })

  const totalCost = slots.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0)
  const firstStart = slots[0]?.plannedStart
  const lastEnd = slots[slots.length - 1]?.plannedEnd
  const color = dayColors[dayIndex % dayColors.length]

  const dateLabel = (() => {
    try { return format(parseISO(date), 'EEEE, dd/MM', { locale: vi }) }
    catch { return date }
  })()

  return (
    <div
      ref={setNodeRef}
      className={`transition-all ${isOver ? 'ring-2 ring-blue-400 ring-offset-1 rounded-xl' : ''}`}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={`flex items-center gap-3 w-full px-4 py-3 ${color} border-b border-gray-100`}
        aria-expanded={!collapsed}
      >
        <Calendar className="w-4 h-4 shrink-0" />
        <span className="font-semibold text-sm flex-1 text-left">
          Ngày {dayIndex + 1} — {dateLabel}
        </span>
        <div className="flex items-center gap-3 text-xs opacity-70">
          {firstStart && lastEnd && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(parseISO(firstStart), 'HH:mm')}–{format(parseISO(lastEnd), 'HH:mm')}
            </span>
          )}
          {totalCost > 0 && (
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              {(totalCost / 1000).toFixed(0)}k
            </span>
          )}
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronUp className="w-4 h-4 shrink-0" />}
      </button>

      {!collapsed && (
        <SortableContext items={slots.map((s) => s.slotId)} strategy={verticalListSortingStrategy}>
          {slots.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Kéo địa điểm vào đây
            </div>
          ) : (
            slots.map((slot, i) => (
              <SlotCard
                key={slot.slotId}
                slot={slot}
                index={i}
                isActive={slot.slotId === focusedSlotId}
                onFocus={onFocus}
              />
            ))
          )}
        </SortableContext>
      )}
    </div>
  )
}
