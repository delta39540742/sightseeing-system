import { useState } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronUp, Calendar, Clock, DollarSign, Plus, MapPin, X, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { TripSlot, TripDayStart } from '@/types'
import { SlotCard } from './SlotCard'

interface DayGroupProps {
  dayIndex: number
  date: string
  slots: TripSlot[]
  focusedSlotId: string | null
  onFocus: (id: string) => void
  onAddSlot?: (dayIndex: number) => void
  onLockToggle?: (slot: TripSlot) => void
  /** Toggle đánh dấu xóa cho 1 slot (chờ Lưu). */
  onToggleRemove?: (slotId: string) => void
  /** Tập slotId đã đánh dấu xóa (chờ Lưu). */
  pendingRemovedSlotIds?: ReadonlyArray<string>
  dayColors: string[]
  dayStart?: TripDayStart | null
  onEditDayStart?: (dayIndex: number) => void
  onClearDayStart?: (dayIndex: number) => void
  /** "completed" | "locked" | null. Khi != null, không cho sửa điểm bắt đầu — show lý do. */
  dayStartBlockedReason?: 'completed' | 'locked' | 'past' | null
}

export function DayGroup({
  dayIndex, date, slots, focusedSlotId, onFocus, onAddSlot, onLockToggle, dayColors,
  dayStart, onEditDayStart, onClearDayStart, dayStartBlockedReason,
  onToggleRemove, pendingRemovedSlotIds,
}: DayGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIndex}` })

  const totalCost  = slots.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0)
  const firstStart = slots[0]?.plannedStart
  const lastEnd    = slots[slots.length - 1]?.plannedEnd
  const color      = dayColors[dayIndex % dayColors.length]

  const completedCount = slots.filter((s) => s.status === 'completed').length
  const hasConflict    = slots.some((s) => !!s.conflict)

  const dateLabel = (() => {
    try { return format(parseISO(date), 'EEEE, dd/MM', { locale: vi }) }
    catch { return date }
  })()

  return (
    <div
      ref={setNodeRef}
      className={`transition-all ${isOver ? 'ring-2 ring-blue-400 ring-inset rounded-xl' : ''}`}
    >
      {/* Day header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 ${color} border-b border-gray-100`}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 flex-1 text-left"
          aria-expanded={!collapsed}
        >
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="font-semibold text-sm flex-1">
            Ngày {dayIndex + 1} — {dateLabel}
          </span>

          {/* Summary stats */}
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
            {slots.length > 0 && (
              <span className="opacity-60">
                {completedCount}/{slots.length}
              </span>
            )}
          </div>

          {hasConflict && (
            <span className="text-[10px] bg-red-100 text-red-600 border border-red-200 rounded-full px-1.5 py-0.5 font-semibold shrink-0">
              !</span>
          )}
          {collapsed ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronUp className="w-4 h-4 shrink-0" />}
        </button>

        {/* Add slot button — always visible */}
        {onAddSlot && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddSlot(dayIndex) }}
            aria-label={`Thêm địa điểm vào Ngày ${dayIndex + 1}`}
            title={`Thêm địa điểm vào Ngày ${dayIndex + 1}`}
            className="ml-1 p-1 rounded-md hover:bg-white/60 active:scale-95 transition-all text-current opacity-70 hover:opacity-100 shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Day-start editor — chỉ render khi caller cung cấp onEditDayStart */}
      {!collapsed && onEditDayStart && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-100 text-xs">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-slate-500 shrink-0">Bắt đầu:</span>
          {dayStart ? (
            <span className="flex-1 truncate text-slate-700 font-medium" title={dayStart.name}>
              {dayStart.name}
            </span>
          ) : (
            <span className="flex-1 italic text-slate-400">
              Mặc định (theo slot đầu)
            </span>
          )}

          {dayStartBlockedReason ? (
            <span
              className="text-[10px] text-slate-400 italic shrink-0"
              title={
                dayStartBlockedReason === 'completed' ? 'Có slot đã hoàn thành' :
                dayStartBlockedReason === 'locked'    ? 'Có slot đã cố định giờ' :
                                                       'Ngày đã qua'
              }
            >
              {dayStartBlockedReason === 'completed' ? 'Đã có hoàn thành' :
               dayStartBlockedReason === 'locked'    ? 'Có slot cố định' :
                                                      'Ngày đã qua'}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onEditDayStart(dayIndex)}
                className="text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0"
                title={dayStart ? 'Đổi điểm bắt đầu' : 'Đặt điểm bắt đầu'}
              >
                <Pencil className="w-3 h-3" />
                {dayStart ? 'Đổi' : 'Đặt'}
              </button>
              {dayStart && onClearDayStart && (
                <button
                  type="button"
                  onClick={() => onClearDayStart(dayIndex)}
                  className="text-slate-400 hover:text-red-500 shrink-0"
                  aria-label={`Xoá điểm bắt đầu ngày ${dayIndex + 1}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Slot list */}
      {!collapsed && (
        <SortableContext items={slots.map((s) => s.slotId)} strategy={verticalListSortingStrategy}>
          {slots.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
              <span>Chưa có địa điểm</span>
              {onAddSlot && (
                <button
                  onClick={() => onAddSlot(dayIndex)}
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm địa điểm
                </button>
              )}
            </div>
          ) : (
            <>
              {slots.map((slot, i) => (
                <SlotCard
                  key={slot.slotId}
                  slot={slot}
                  index={i}
                  isActive={slot.slotId === focusedSlotId}
                  onFocus={onFocus}
                  onLockToggle={onLockToggle ? () => onLockToggle(slot) : undefined}
                  isPendingRemoved={pendingRemovedSlotIds?.includes(slot.slotId)}
                  onToggleRemove={onToggleRemove ? () => onToggleRemove(slot.slotId) : undefined}
                />
              ))}
              {/* Inline add button after list */}
              {onAddSlot && (
                <button
                  onClick={() => onAddSlot(dayIndex)}
                  className="flex items-center gap-2 w-full px-4 py-2 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors border-b border-gray-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm địa điểm vào ngày {dayIndex + 1}
                </button>
              )}
            </>
          )}
        </SortableContext>
      )}
    </div>
  )
}
