import { useRef, useEffect, useCallback, useState } from 'react'
import {
  DndContext, DragEndEvent, DragOverEvent, closestCenter,
  PointerSensor, TouchSensor, useSensor, useSensors, DragOverlay, DragStartEvent,
} from '@dnd-kit/core'
import { RotateCcw, RotateCw, CheckCircle, XCircle, Save, History } from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import { useTripStore } from '@/store/tripStore'
import { DayGroup } from './DayGroup'
import { SlotCard } from './SlotCard'
import type { TripSlot } from '@/types'

const DAY_COLORS = [
  'bg-blue-50 text-blue-800',
  'bg-emerald-50 text-emerald-800',
  'bg-violet-50 text-violet-800',
  'bg-amber-50 text-amber-800',
  'bg-pink-50 text-pink-800',
]

interface TimelineProps {
  /** Callback triggered when user clicks "+ Thêm slot" for a specific day */
  onAddSlot?: (dayIndex: number) => void
  /** Callback triggered when user clicks lock/unlock on a slot */
  onLockToggle?: (slot: TripSlot) => void
  /** Open the day-start editor sheet for a specific day */
  onEditDayStart?: (dayIndex: number) => void
  /** Clear the persisted day-start for a specific day */
  onClearDayStart?: (dayIndex: number) => void
}

export function Timeline({ onAddSlot, onLockToggle, onEditDayStart, onClearDayStart }: TimelineProps) {
  const {
    trip, pendingSlots, hasPending, focusedSlotId,
    movePendingSlot, movePendingToDay, commitPending, discardPending,
    setFocus, undo, redo, past, future, saveVersion, versions, restoreVersion,
    pendingRemovedSlotIds, markSlotForRemoval, unmarkSlotForRemoval,
  } = useTripStore()

  const handleToggleRemove = (slotId: string) => {
    if (pendingRemovedSlotIds.includes(slotId)) unmarkSlotForRemoval(slotId)
    else markSlotForRemoval(slotId)
  }

  const [activeSlot, setActiveSlot] = useState<TripSlot | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const slots     = pendingSlots ?? trip?.slots ?? []
  const startDate = trip?.startDate ?? format(new Date(), 'yyyy-MM-dd')
  const days      = trip
    ? Math.ceil((parseISO(trip.endDate).getTime() - parseISO(trip.startDate).getTime()) / 86400000) + 1
    : 1

  const slotsByDay: Record<number, TripSlot[]> = {}
  for (let d = 0; d < days; d++) slotsByDay[d] = []
  for (const s of slots) {
    const d = s.dayIndex ?? 0
    if (!slotsByDay[d]) slotsByDay[d] = []
    slotsByDay[d].push(s)
  }
  for (const d in slotsByDay) {
    slotsByDay[d].sort((a, b) => a.slotOrder - b.slotOrder)
  }

  const onDragStart = useCallback((e: DragStartEvent) => {
    const slot = slots.find((s) => s.slotId === e.active.id)
    setActiveSlot(slot ?? null)
  }, [slots])

  const onDragOver = useCallback((e: DragOverEvent) => {
    const { over } = e
    if (!over || !activeSlot) return
    if (String(over.id).startsWith('day-')) {
      const targetDay = parseInt(String(over.id).replace('day-', ''))
      if (activeSlot.dayIndex !== targetDay) {
        movePendingToDay(activeSlot.slotId, targetDay)
      }
    }
  }, [activeSlot, movePendingToDay])

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setActiveSlot(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    if (!String(over.id).startsWith('day-')) {
      movePendingSlot(String(active.id), String(over.id))
    }
  }, [movePendingSlot])

  // Auto-scroll to focused slot
  useEffect(() => {
    if (!focusedSlotId || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-slot-id="${focusedSlotId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedSlotId])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  if (!trip) return null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 shrink-0">
        <button
          onClick={undo}
          disabled={past.length === 0}
          aria-label="Hoàn tác (Ctrl+Z)"
          title="Hoàn tác"
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          aria-label="Làm lại (Ctrl+Y)"
          title="Làm lại"
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500"
        >
          <RotateCw className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        <button
          onClick={saveVersion}
          title="Lưu phiên bản"
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <Save className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          title="Lịch sử phiên bản"
          className={`p-1.5 rounded-lg text-gray-500 ${showHistory ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
        >
          <History className="w-4 h-4" />
        </button>
      </div>

      {/* History panel */}
      {showHistory && versions.length > 0 && (
        <div className="border-b border-gray-100 max-h-40 overflow-y-auto scrollbar-thin bg-gray-50">
          {[...versions].reverse().map((v, i) => (
            <button
              key={v.savedAt}
              onClick={() => { restoreVersion(versions.length - 1 - i); setShowHistory(false) }}
              className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-white text-xs text-gray-600 border-b border-gray-100"
            >
              <History className="w-3 h-3 text-gray-400" />
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Pending change bar */}
      {hasPending && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0">
          <span className="text-xs text-amber-700 flex-1 font-medium">Có thay đổi chưa lưu</span>
          <button onClick={commitPending} className="flex items-center gap-1 text-xs text-green-700 font-semibold hover:text-green-900">
            <CheckCircle className="w-3.5 h-3.5" /> Cập nhật
          </button>
          <button onClick={discardPending} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <XCircle className="w-3.5 h-3.5" /> Hủy
          </button>
        </div>
      )}

      {/* Day groups */}
      <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          {Array.from({ length: days }, (_, d) => {
            const daySlots = slotsByDay[d] ?? []
            const dayDate = parseISO(format(addDays(parseISO(startDate), d), 'yyyy-MM-dd'))
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
            const isPast = dayDate.getTime() < todayStart.getTime()
            const dayStart = (trip?.dayStarts ?? []).find((x) => x.dayIndex === d) ?? null
            const blocked: 'completed' | 'locked' | 'past' | null =
              isPast                                       ? 'past'      :
              daySlots.some((s) => s.status === 'completed') ? 'completed' :
              daySlots.some((s) => s.isLocked)             ? 'locked'    :
                                                             null
            return (
              <DayGroup
                key={d}
                dayIndex={d}
                date={format(addDays(parseISO(startDate), d), 'yyyy-MM-dd')}
                slots={daySlots}
                focusedSlotId={focusedSlotId}
                onFocus={setFocus}
                onAddSlot={onAddSlot}
                onLockToggle={onLockToggle}
                onToggleRemove={handleToggleRemove}
                pendingRemovedSlotIds={pendingRemovedSlotIds}
                dayColors={DAY_COLORS}
                dayStart={dayStart}
                onEditDayStart={onEditDayStart}
                onClearDayStart={onClearDayStart}
                dayStartBlockedReason={blocked}
              />
            )
          })}

          <DragOverlay>
            {activeSlot && (
              <div className="shadow-2xl rounded-xl bg-white opacity-90">
                <SlotCard slot={activeSlot} index={0} onFocus={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  )
}
