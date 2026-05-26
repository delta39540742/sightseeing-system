import { useState, useCallback, useMemo } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Star, StarOff, AlertTriangle, CheckCircle, Clock, Lightbulb } from 'lucide-react'
import type { Place, PlaceOrderItem } from '@/types'

const DAILY_MINUTES = 600 // 10h/ngày hoạt động
const TRAVEL_PER_STOP = 25 // phút di chuyển trung bình giữa 2 điểm
const SPREAD_WARN_KM = 80   // khoảng cách max-pairwise vượt → cảnh báo nhẹ
const SPREAD_HARD_KM = 200  // vượt → cảnh báo mạnh (nên tách chuyến)

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

interface SortablePlaceProps {
  item: PlaceOrderItem
  onToggleMust: (id: number) => void
  suggested: boolean
}

function SortablePlace({ item, onToggleMust, suggested }: SortablePlaceProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.placeId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
        item.mustVisit
          ? 'bg-blue-50 border-blue-300 shadow-sm'
          : suggested
            ? 'bg-red-50 border-red-200 opacity-70'
            : 'bg-white border-gray-200',
      ].join(' ')}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Kéo để sắp xếp"
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
        {item.priority + 1}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${suggested ? 'text-red-500 line-through' : 'text-gray-900'}`}>
          {item.place.name}
        </p>
        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
          <Clock className="w-3 h-3" />
          {item.place.avgVisitDurationMin} phút
          {item.place.rating != null && (
            <span className="ml-1">· ⭐ {item.place.rating.toFixed(1)}</span>
          )}
        </p>
        {suggested && (
          <p className="text-xs text-red-500 font-medium mt-0.5">Gợi ý bỏ để đảm bảo khả thi</p>
        )}
      </div>

      <button
        onClick={() => onToggleMust(item.placeId)}
        title={item.mustVisit ? 'Bắt buộc ghé thăm — nhấn để bỏ' : 'Nhấn để đánh dấu bắt buộc'}
        className={[
          'shrink-0 p-1.5 rounded-lg transition-colors',
          item.mustVisit
            ? 'text-yellow-500 bg-yellow-100 hover:bg-yellow-200'
            : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-50',
        ].join(' ')}
      >
        {item.mustVisit
          ? <Star className="w-4 h-4 fill-current" />
          : <StarOff className="w-4 h-4" />}
      </button>
    </div>
  )
}

interface PlaceOrderStepProps {
  candidates: Place[]
  selectedIds: number[]
  tripDays: number
  isPending: boolean
  onConfirm: (ordered: PlaceOrderItem[]) => void
  onBack: () => void
}

export function PlaceOrderStep({
  candidates,
  selectedIds,
  tripDays,
  isPending,
  onConfirm,
  onBack,
}: PlaceOrderStepProps) {
  const [items, setItems] = useState<PlaceOrderItem[]>(() =>
    selectedIds
      .map((id, i) => {
        const place = candidates.find((c) => c.placeId === id)
        if (!place) return null
        return { placeId: id, place, mustVisit: false, priority: i }
      })
      .filter((x): x is PlaceOrderItem => x !== null),
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const onDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const oldIdx = prev.findIndex((i) => i.placeId === Number(active.id))
      const newIdx = prev.findIndex((i) => i.placeId === Number(over.id))
      return arrayMove(prev, oldIdx, newIdx).map((item, idx) => ({ ...item, priority: idx }))
    })
  }, [])

  const onToggleMust = useCallback((id: number) => {
    setItems((prev) =>
      prev.map((i) => (i.placeId === id ? { ...i, mustVisit: !i.mustVisit } : i)),
    )
  }, [])

  const feasibility = useMemo(() => {
    const totalActivity = items.reduce((s, i) => s + i.place.avgVisitDurationMin, 0)
    const totalTravel = items.length > 1 ? (items.length - 1) * TRAVEL_PER_STOP : 0
    const totalRequired = totalActivity + totalTravel
    const totalAvailable = tripDays * DAILY_MINUTES
    const overMinutes = totalRequired - totalAvailable
    const feasible = overMinutes <= 0

    // Gợi ý bỏ địa điểm không bắt buộc, ưu tiên bỏ cuối danh sách trước
    const suggestions: PlaceOrderItem[] = []
    if (!feasible) {
      let deficit = overMinutes
      const nonMust = [...items].filter((i) => !i.mustVisit).reverse()
      for (const item of nonMust) {
        if (deficit <= 0) break
        suggestions.push(item)
        deficit -= item.place.avgVisitDurationMin + TRAVEL_PER_STOP
      }
    }

    const mustConflict =
      !feasible &&
      items
        .filter((i) => i.mustVisit)
        .reduce((s, i) => s + i.place.avgVisitDurationMin, 0) +
        (items.filter((i) => i.mustVisit).length - 1) * TRAVEL_PER_STOP >
        totalAvailable

    return { feasible, totalRequired, totalAvailable, overMinutes, suggestions, mustConflict }
  }, [items, tripDays])

  // Cảnh báo phân tán địa lý: max pairwise distance giữa các điểm đã chọn.
  // Khi vượt SPREAD_WARN_KM → k-means vẫn cluster đúng nhưng kết quả có thể trông
  // phi lý (vd Phan Thiết + Đà Nẵng cùng chuyến). > SPREAD_HARD_KM → khuyến nghị tách.
  const spread = useMemo(() => {
    if (items.length < 2) return { maxKm: 0, pair: null as null | [string, string] }
    let maxKm = 0
    let pair: [string, string] | null = null
    for (let i = 0; i < items.length; i++) {
      const a = items[i]!.place
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]!.place
        if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue
        const d = haversineKm(a.lat, a.lng, b.lat, b.lng)
        if (d > maxKm) { maxKm = d; pair = [a.name, b.name] }
      }
    }
    return { maxKm, pair }
  }, [items])

  const suggestedIds = new Set(feasibility.suggestions.map((s) => s.placeId))

  const fmtTime = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}g${m > 0 ? ` ${m}p` : ''}` : `${m}p`
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">Sắp xếp thứ tự ưu tiên</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Kéo để đổi thứ tự · Nhấn <Star className="inline w-3 h-3 text-yellow-500" /> để đánh dấu bắt buộc ghé thăm
        </p>
      </div>

      {/* Thanh trạng thái khả thi */}
      <div
        className={[
          'rounded-xl px-4 py-3 flex items-start gap-3 border',
          feasibility.feasible
            ? 'bg-green-50 border-green-200'
            : feasibility.mustConflict
              ? 'bg-red-100 border-red-300'
              : 'bg-amber-50 border-amber-200',
        ].join(' ')}
      >
        {feasibility.feasible ? (
          <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle
            className={`w-4 h-4 mt-0.5 shrink-0 ${feasibility.mustConflict ? 'text-red-600' : 'text-amber-500'}`}
          />
        )}
        <div className="flex-1 min-w-0">
          {feasibility.feasible ? (
            <>
              <p className="text-xs font-semibold text-green-700">
                Lộ trình khả thi — còn dư {fmtTime(feasibility.totalAvailable - feasibility.totalRequired)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cần {fmtTime(feasibility.totalRequired)} / {tripDays} ngày × 10h
              </p>
            </>
          ) : (
            <>
              <p className={`text-xs font-semibold ${feasibility.mustConflict ? 'text-red-700' : 'text-amber-700'}`}>
                {feasibility.mustConflict
                  ? 'Ngay cả các điểm bắt buộc cũng vượt thời gian!'
                  : `Quá tải ${fmtTime(feasibility.overMinutes)} — nên bỏ bớt địa điểm`}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cần {fmtTime(feasibility.totalRequired)} / có {fmtTime(feasibility.totalAvailable)} ({tripDays} ngày × 10h)
              </p>
              {feasibility.suggestions.length > 0 && !feasibility.mustConflict && (
                <div className="flex items-start gap-1.5 mt-2">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    Gợi ý bỏ: <span className="font-medium">{feasibility.suggestions.map((s) => s.place.name).join(', ')}</span>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Cảnh báo phân tán địa lý */}
      {spread.maxKm >= SPREAD_WARN_KM && spread.pair && (
        <div
          className={[
            'rounded-xl px-4 py-3 flex items-start gap-3 border',
            spread.maxKm >= SPREAD_HARD_KM
              ? 'bg-red-50 border-red-300'
              : 'bg-amber-50 border-amber-200',
          ].join(' ')}
        >
          <AlertTriangle
            className={`w-4 h-4 mt-0.5 shrink-0 ${spread.maxKm >= SPREAD_HARD_KM ? 'text-red-600' : 'text-amber-500'}`}
          />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${spread.maxKm >= SPREAD_HARD_KM ? 'text-red-700' : 'text-amber-700'}`}>
              {spread.maxKm >= SPREAD_HARD_KM
                ? `Các điểm cách nhau quá xa (${Math.round(spread.maxKm)} km) — nên tách thành nhiều chuyến`
                : `Các điểm khá phân tán (${Math.round(spread.maxKm)} km giữa 2 điểm xa nhất)`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Xa nhất: <span className="font-medium">{spread.pair[0]}</span> ↔ <span className="font-medium">{spread.pair[1]}</span>
              {spread.maxKm >= SPREAD_HARD_KM
                ? ' · 1 ngày di chuyển có thể ăn hết thời gian tham quan'
                : ' · cân nhắc dùng chế độ Tối ưu (I3CH) để phân cụm tốt hơn'}
            </p>
          </div>
        </div>
      )}

      {/* Danh sách kéo thả */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.placeId)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((item) => (
              <SortablePlace
                key={item.placeId}
                item={item}
                onToggleMust={onToggleMust}
                suggested={suggestedIds.has(item.placeId)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3 text-yellow-500 fill-current" /> Bắt buộc ghé thăm
        </span>
        <span className="flex items-center gap-1">
          <StarOff className="w-3 h-3" /> Tùy chọn
        </span>
      </div>

      <div className="pt-3 space-y-2 border-t border-gray-100">
        {feasibility.mustConflict && (
          <p className="text-xs text-red-600 text-center font-medium">
            Hãy bỏ bớt điểm bắt buộc hoặc kéo dài thời gian chuyến đi
          </p>
        )}
        <button
          onClick={() => onConfirm(items)}
          disabled={isPending || feasibility.mustConflict}
          className="btn-primary w-full py-2.5 disabled:opacity-50"
        >
          {isPending
            ? 'Đang tạo kế hoạch…'
            : feasibility.feasible
              ? '✨ Tạo lịch trình'
              : '⚠️ Tạo lịch trình (có thể không đủ thời gian)'}
        </button>
        <button onClick={onBack} disabled={isPending} className="btn-secondary w-full py-2.5">
          Quay lại chọn địa điểm
        </button>
      </div>
    </div>
  )
}
