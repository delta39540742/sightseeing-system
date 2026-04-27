import { X, Plus, Check, Star, Clock, Tag } from 'lucide-react'
import type { Place } from '@/types'

interface DestinationDetailPanelProps {
  place: Place | null
  onClose: () => void
  onAdd: (place: Place) => void
  alreadyAdded: boolean
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

export function DestinationDetailPanel({ place, onClose, onAdd, alreadyAdded }: DestinationDetailPanelProps) {
  return (
    <div
      className={`absolute top-0 right-0 h-full w-80 bg-white shadow-2xl z-[1000] flex flex-col
        transition-transform duration-300 ease-in-out
        ${place ? 'translate-x-0' : 'translate-x-full'}`}
      style={{ willChange: 'transform' }}
    >
      {/* Image header */}
      <div className="relative h-48 bg-gradient-to-br from-amber-400 to-orange-500 shrink-0">
        {place?.imageUrl ? (
          <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl">🏛️</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60
            text-white flex items-center justify-center transition-colors z-10"
          aria-label="Đóng"
        >
          <X className="w-4 h-4" />
        </button>

        {place && (
          <div className="absolute bottom-3 left-3 right-12">
            <h2 className="text-white font-bold text-base leading-tight">{place.name}</h2>
            {place.rating != null && (
              <div className="flex items-center gap-1 mt-1">
                <Star className="w-3.5 h-3.5 text-amber-400 fill-current" />
                <span className="text-amber-300 text-xs font-semibold">{place.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {place && (
          <>
            {place.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {place.tags.map((t) => (
                  <span
                    key={t.tagId}
                    className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200
                      text-xs font-medium px-2.5 py-1 rounded-full"
                  >
                    <Tag className="w-3 h-3" />
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Thời gian tham quan
                </p>
                <div className="flex items-center gap-1.5 text-slate-700">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-semibold">
                    {place.avgVisitDurationMin >= 60
                      ? `${Math.floor(place.avgVisitDurationMin / 60)}h${place.avgVisitDurationMin % 60 > 0 ? ` ${place.avgVisitDurationMin % 60}p` : ''}`
                      : `${place.avgVisitDurationMin}p`}
                  </span>
                </div>
              </div>

              {place.minPrice != null && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Giá vé
                  </p>
                  <p className="text-sm font-semibold text-slate-700">
                    {place.minPrice === 0
                      ? 'Miễn phí'
                      : `${place.minPrice.toLocaleString('vi-VN')}đ`}
                  </p>
                </div>
              )}

              <div className={`bg-slate-50 rounded-xl p-3 ${place.minPrice == null ? 'col-span-2' : ''}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Không gian
                </p>
                <p className="text-xs text-slate-600 capitalize">{place.indoorOutdoor}</p>
              </div>
            </div>

            {place.description && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                  Mô tả
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">{place.description}</p>
              </div>
            )}

            {place.openingHours.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                  Giờ mở cửa
                </p>
                <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  {(() => {
                    const sorted = [...place.openingHours].sort((a, b) => {
                      const da = a.dayOfWeek === 0 ? 7 : a.dayOfWeek
                      const db = b.dayOfWeek === 0 ? 7 : b.dayOfWeek
                      return da - db
                    })

                    const groups: { days: number[]; open: string; close: string }[] = []
                    for (const h of sorted) {
                      const last = groups[groups.length - 1]
                      if (last && last.open === h.openTime && last.close === h.closeTime) {
                        last.days.push(h.dayOfWeek)
                      } else {
                        groups.push({ days: [h.dayOfWeek], open: h.openTime, close: h.closeTime })
                      }
                    }

                    return groups.map((g, i) => {
                      const formatTime = (t: string) => t.includes('T') ? t.split('T')[1].substring(0, 5) : t.substring(0, 5)
                      const timeStr = `${formatTime(g.open)} – ${formatTime(g.close)}`
                      let label = ''
                      if (g.days.length === 7) label = 'Mọi ngày'
                      else if (g.days.length === 1) label = DAY_LABELS[g.days[0]]
                      else {
                        const isConsecutive = g.days.every((d, idx) => {
                          if (idx === 0) return true
                          const prev = g.days[idx - 1] === 0 ? 7 : g.days[idx - 1]
                          const curr = d === 0 ? 7 : d
                          return curr === prev + 1
                        })
                        label = isConsecutive
                          ? `${DAY_LABELS[g.days[0]]} – ${DAY_LABELS[g.days[g.days.length - 1]]}`
                          : g.days.map((d) => DAY_LABELS[d]).join(', ')
                      }

                      // Tô đậm ngày hôm nay
                      const today = new Date().getDay()
                      const isToday = g.days.includes(today)

                      return (
                        <div key={i} className={`flex justify-between text-xs py-1 ${isToday ? 'font-bold text-blue-700' : 'text-slate-600'}`}>
                          <span>{label}{isToday && ' (Hôm nay)'}</span>
                          <span>{timeStr}</span>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-slate-100 shrink-0">
        {alreadyAdded ? (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 text-slate-400 text-sm font-semibold">
            <Check className="w-4 h-4" />
            Đã thêm vào danh sách
          </div>
        ) : (
          <button
            onClick={() => place && onAdd(place)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
              bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Thêm vào lộ trình
          </button>
        )}
      </div>
    </div>
  )
}
