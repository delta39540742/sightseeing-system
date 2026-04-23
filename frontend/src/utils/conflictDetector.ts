import type { TripSlot, ConflictInfo } from '@/types'
import { parseISO, differenceInMinutes } from 'date-fns'

const AVG_SPEED_KMH = 30
const EARTH_R = 6371

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function detectConflicts(slots: TripSlot[]): TripSlot[] {
  return slots.map((slot, i) => {
    if (i === 0) return { ...slot, conflict: undefined }

    const prev = slots[i - 1]
    if (!prev.place || !slot.place) return { ...slot, conflict: undefined }

    const prevEnd = parseISO(prev.plannedEnd)
    const currStart = parseISO(slot.plannedStart)
    const windowMin = differenceInMinutes(currStart, prevEnd)

    const distKm = haversineKm(prev.place.lat, prev.place.lng, slot.place.lat, slot.place.lng)
    const travelMin = (distKm / AVG_SPEED_KMH) * 60

    if (windowMin < travelMin) {
      const conflict: ConflictInfo = {
        type: 'distance',
        message: `Không đủ thời gian di chuyển từ ${prev.place.name} đến ${slot.place.name}`,
        cause: `Cần ~${Math.ceil(travelMin)} phút nhưng chỉ có ${Math.max(0, windowMin)} phút`,
        suggestion: `Dời ${slot.place.name} sang muộn hơn hoặc chọn địa điểm gần hơn`,
      }
      return { ...slot, conflict }
    }

    if (slot.place.openingHours.length > 0) {
      const dow = parseISO(slot.plannedStart).getDay()
      const hour = parseISO(slot.plannedStart)
      const oh = slot.place.openingHours.find((o) => o.dayOfWeek === dow)
      if (oh) {
        const [openH, openM] = oh.openTime.split(':').map(Number)
        const [closeH, closeM] = oh.closeTime.split(':').map(Number)
        const arrH = hour.getHours() * 60 + hour.getMinutes()
        const open = openH * 60 + openM
        const close = closeH * 60 + closeM
        if (arrH < open || arrH >= close) {
          const conflict: ConflictInfo = {
            type: 'closed',
            message: `${slot.place.name} đóng cửa lúc bạn đến`,
            cause: `Giờ mở cửa: ${oh.openTime}–${oh.closeTime}`,
            suggestion: `Điều chỉnh thời gian đến hoặc thay thế bằng địa điểm mở cửa muộn hơn`,
          }
          return { ...slot, conflict }
        }
      }
    }

    return { ...slot, conflict: undefined }
  })
}
