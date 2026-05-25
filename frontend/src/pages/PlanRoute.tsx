import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useSessionState, clearPlanningSession } from '@/hooks/useSessionState'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Clock, ChevronUp, ChevronDown, ArrowLeft,
  Save, AlertCircle, PersonStanding, Route, Calendar, Wallet, Share2,
  Loader2, Plus, X, Sparkles, AlertTriangle, Coffee, Map, Trash2, Pin, Flag,
} from 'lucide-react'
import { format, addMinutes, addDays, differenceInDays, parseISO } from 'date-fns'
import { TripMap } from '@/components/map/TripMap'
import { DestinationDetailPanel } from '@/components/planning/DestinationDetailPanel'
import { DayStartsPicker, type DayStartEntry } from '@/components/planning/DayStartsPicker'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import type { Place, PlanRequest, TripSlot, ScoreBreakdown, SlotExplanation } from '@/types'
import { routingService, type OsrmRoute } from '@/services/routingService'
import { destinationFieldsFor } from '@/data/destinations'

type PlaceWithBreakdown = Place & { scoreBreakdown?: ScoreBreakdown }

interface RoutePlace {
  place: PlaceWithBreakdown
  nickname: string
  visitMinutes: number
  mustVisit?: boolean
}

// Labels for scoreBreakdown fields from the candidates endpoint
const BREAKDOWN_LABELS: Record<keyof ScoreBreakdown, string> = {
  interest:   'Phù hợp sở thích',
  popularity: 'Được nhiều người thích',
  softAdj:    'Phù hợp mong muốn',
  cfBoost:    'Người tương tự thích',
  semBoost:   'Khớp trải nghiệm',
  expBoost:   'Khớp từ khoá',
}

function breakdownToComponents(bd: ScoreBreakdown) {
  const entries = (Object.keys(BREAKDOWN_LABELS) as Array<keyof ScoreBreakdown>)
    .map(k => ({ name: k, label: BREAKDOWN_LABELS[k], value: bd[k] }))
    .filter(e => Math.abs(e.value) > 0.001)
  const total = entries.reduce((s, e) => s + Math.abs(e.value), 0) || 1
  return entries.map(e => ({
    name: e.name,
    label: e.label,
    value: e.value,
    pct: Math.round(Math.abs(e.value) / total * 100),
    positive: e.value >= 0,
  })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

const EARTH_R_KM = 6371
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Ước lượng thời gian thăm (phút) dựa trên loại địa điểm.
// Ưu tiên giá trị từ DB nếu khác default 60 (nghĩa là đã được set thủ công),
// ngược lại fall back theo tag → indoor/outdoor.
// Các giá trị phải khớp options của <select> visitMinutes: [30, 45, 60, 90, 120, 180]
const TAG_DURATION_MIN: Record<string, number> = {
  heritage: 180, nature: 180, park: 120, beach: 120,
  entertainment: 120, shopping: 90, museum: 90, food: 90,
  pagoda: 60, temple: 60, craft: 60, market: 60,
  landmark: 45, viewpoint: 30,
}
const ALLOWED_DURATIONS = [30, 45, 60, 90, 120, 180]
const snapToAllowed = (m: number): number =>
  ALLOWED_DURATIONS.reduce((best, v) => (Math.abs(v - m) < Math.abs(best - m) ? v : best), ALLOWED_DURATIONS[0])

function estimateVisitMinutes(p: Place): number {
  // DB value đáng tin nếu khác 0/null và khác fallback 60
  if (p.avgVisitDurationMin && p.avgVisitDurationMin !== 60) {
    return snapToAllowed(p.avgVisitDurationMin)
  }
  for (const tag of p.tags ?? []) {
    const key = (tag.name ?? '').toLowerCase()
    if (TAG_DURATION_MIN[key]) return TAG_DURATION_MIN[key]
  }
  if (p.indoorOutdoor === 'outdoor') return 90
  if (p.indoorOutdoor === 'mixed') return 90
  if (p.indoorOutdoor === 'indoor') return 60
  return 60
}

// Khoảng cách giữa 2 điểm vượt ngưỡng này = "xa" → cần cảnh báo / gợi ý điểm dừng.
const FAR_GAP_KM = 15
const TRAVEL_SPEED_KMH = 30
const REST_STOP_RADIUS_KM = 5  // candidate trong bán kính 5km của midpoint = ứng viên dừng chân
const DAILY_TIME_BUDGET_MIN = 12 * 60  // 12 giờ hoạt động/ngày

const travelMinFromKm = (km: number): number => (km / TRAVEL_SPEED_KMH) * 60

interface FarGap {
  afterIdx: number
  distKm: number
  midLat: number
  midLng: number
  fromName: string
  toName: string
}

interface RestStopSuggestion {
  place: Place
  gap: FarGap
  distFromMidKm: number
}

interface DetourSuggestion {
  idxA: number
  placeA: Place
  idxB: number
  placeB: Place
  gapKm: number
  extraMin: number
}

// Tổng khoảng cách dọc theo route (km) — dùng để check có cải thiện hay không.
function totalRouteKm(rps: RoutePlace[]): number {
  let sum = 0
  for (let i = 1; i < rps.length; i++) {
    const a = rps[i - 1].place
    const b = rps[i].place
    if (a.lat && a.lng && b.lat && b.lng) sum += haversineKm(a.lat, a.lng, b.lat, b.lng)
  }
  return sum
}

// Nearest-neighbor TSP heuristic, giữ phần tử [0] làm điểm xuất phát.
function nearestNeighborOrder(rps: RoutePlace[]): RoutePlace[] {
  if (rps.length <= 2) return rps
  const visited = new Set<number>([0])
  const ordered: RoutePlace[] = [rps[0]]
  let current = rps[0].place
  while (visited.size < rps.length) {
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 1; i < rps.length; i++) {
      if (visited.has(i)) continue
      const p = rps[i].place
      if (!p.lat || !p.lng || !current.lat || !current.lng) continue
      const d = haversineKm(current.lat, current.lng, p.lat, p.lng)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx === -1) {
      // Còn place không có toạ độ — append theo thứ tự gốc
      for (let i = 1; i < rps.length; i++) {
        if (!visited.has(i)) {
          visited.add(i)
          ordered.push(rps[i])
        }
      }
      break
    }
    visited.add(bestIdx)
    ordered.push(rps[bestIdx])
    current = rps[bestIdx].place
  }
  return ordered
}

export default function PlanRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const state = location.state as { selectedPlaces?: Place[]; planRequest?: PlanRequest } | null
  const initialRequest: PlanRequest | null = state?.planRequest ?? null
  // PUSH = fresh navigation from PlanDestinations; POP = back/forward button (session wins)
  const navType = useNavigationType()
  const isFreshNav = navType === 'PUSH' && (state?.selectedPlaces?.length ?? 0) > 0

  const freshRoutePlaces: RoutePlace[] | undefined = isFreshNav
    ? state!.selectedPlaces!.map((p) => ({
        place: p,
        nickname: p.name,
        visitMinutes: estimateVisitMinutes(p),
        mustVisit: false as const,
      }))
    : undefined

  const [routePlaces, setRoutePlaces] = useSessionState<RoutePlace[]>(
    'plan-route-places',
    [],
    freshRoutePlaces,
  )
  const [startTime, setStartTime] = useSessionState(
    'plan-start-time',
    '08:00',
    isFreshNav ? '08:00' : undefined,
  )
  const [startDate, setStartDate] = useSessionState(
    'plan-start-date',
    initialRequest?.startDate ?? format(new Date(), 'yyyy-MM-dd'),
    isFreshNav ? (initialRequest?.startDate ?? format(new Date(), 'yyyy-MM-dd')) : undefined,
  )
  const initialTripDays = useMemo(() => {
    if (!initialRequest?.startDate || !initialRequest?.endDate) return 1
    try {
      return Math.max(1, differenceInDays(parseISO(initialRequest.endDate), parseISO(initialRequest.startDate)) + 1)
    } catch {
      return 1
    }
  }, [initialRequest])

  const initialNotes = useMemo(() => {
    if (!initialRequest) return ''
    if (initialRequest.additionalNotes) return initialRequest.additionalNotes
    const parts = []
    if (initialRequest.preferences?.length) parts.push(`Sở thích: ${initialRequest.preferences.join(', ')}`)
    if (initialRequest.experienceKeywords?.length) parts.push(`Trải nghiệm: ${initialRequest.experienceKeywords.join(', ')}`)
    if (initialRequest.numPeople) parts.push(`Số người: ${initialRequest.numPeople}`)
    return parts.join(' | ')
  }, [initialRequest])

  const [tripDays, setTripDays] = useSessionState(
    'plan-trip-days',
    initialTripDays,
    isFreshNav ? initialTripDays : undefined,
  )
  const [budget, setBudget] = useSessionState(
    'plan-budget',
    initialRequest?.budgetTotal ?? 3_000_000,
    isFreshNav ? (initialRequest?.budgetTotal ?? 3_000_000) : undefined,
  )
  const [city, setCity] = useSessionState(
    'plan-city',
    initialRequest?.destinationCity ?? 'Đà Nẵng',
    isFreshNav ? (initialRequest?.destinationCity ?? 'Đà Nẵng') : undefined,
  )
  const [additionalNotes, setAdditionalNotes] = useSessionState(
    'plan-additional-notes',
    initialNotes,
    isFreshNav ? initialNotes : undefined,
  )
  const [allowAiSuggestions, setAllowAiSuggestions] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<Place[]>([])
  const [loadingAi, setLoadingAi] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<Place | null>(null)
  const [osrmRoute, setOsrmRoute] = useState<OsrmRoute | null>(null)
  const [expandedExplanationIdx, setExpandedExplanationIdx] = useState<number | null>(null)
  const [isConstraintsExpanded, setIsConstraintsExpanded] = useState(false)

  // Điểm bắt đầu mỗi ngày. Khi user set ít nhất 1 entry → switch sang AI mode
  // (strictMode=false) để planner tính khoảng cách từ dayStart tới slot đầu tiên.
  const [dayStartPoints, setDayStartPoints] = useState<Record<number, DayStartEntry>>({})
  const [pickingDayStart, setPickingDayStart] = useState<number | null>(null)

  useEffect(() => {
    const coords = routePlaces.map(rp => ({ lat: rp.place.lat!, lng: rp.place.lng! }))
    if (coords.length < 2 || coords.some(c => !c.lat || !c.lng)) {
      setOsrmRoute(null)
      return
    }
    let isMounted = true
    routingService.getRoute(coords).then(res => {
      if (isMounted) setOsrmRoute(res)
    })
    return () => { isMounted = false }
  }, [routePlaces])

  async function handleToggleAi(enabled: boolean) {
    setAllowAiSuggestions(enabled)
    if (!enabled) { setAiSuggestions([]); return }
    setLoadingAi(true)
    try {
      const req: PlanRequest = {
        ...destinationFieldsFor(city),
        startDate,
        endDate: startDate,
        budgetTotal: budget,
        preferences: initialRequest?.preferences,
        experienceKeywords: initialRequest?.experienceKeywords,
      }
      const selectedIds = new Set(routePlaces.map((rp) => rp.place.placeId))
      const candidates = await tripService.candidates(req)
      const filtered = candidates.filter((c) => !selectedIds.has(c.placeId))
      if (filtered.length > 0) {
        setAiSuggestions(filtered)
      } else {
        // Candidates endpoint returned nothing new — fall back to real DB places
        const allPlaces = await tripService.listPlaces({ page: 1, limit: 20 })
        setAiSuggestions(allPlaces.filter((p) => !selectedIds.has(p.placeId)).slice(0, 5))
      }
    } catch {
      toast.error('Không thể tải đề xuất AI')
    } finally {
      setLoadingAi(false)
    }
  }

  function addAiSuggestion(place: Place) {
    setRoutePlaces((prev) => [
      ...prev,
      { place, nickname: place.name, visitMinutes: estimateVisitMinutes(place) },
    ])
    setAiSuggestions((prev) => prev.filter((p) => p.placeId !== place.placeId))
    setSelectedSuggestion(null)
  }

  // Insert ngay sau điểm `afterIdx` thay vì append cuối — đúng vị trí dừng chân
  // giữa 2 điểm xa nhau.
  function addRestStopAt(place: Place, afterIdx: number) {
    setRoutePlaces((prev) => {
      const arr = [...prev]
      arr.splice(afterIdx + 1, 0, {
        place,
        nickname: place.name,
        visitMinutes: estimateVisitMinutes(place),
      })
      return arr
    })
    setAiSuggestions((prev) => prev.filter((p) => p.placeId !== place.placeId))
    setSelectedSuggestion(null)
  }

  // Đoạn route > FAR_GAP_KM giữa 2 điểm liên tiếp.
  const farGaps: FarGap[] = useMemo(() => {
    const gaps: FarGap[] = []
    for (let i = 1; i < routePlaces.length; i++) {
      const a = routePlaces[i - 1].place
      const b = routePlaces[i].place
      if (!a.lat || !a.lng || !b.lat || !b.lng) continue
      
      const leg = osrmRoute?.legs?.[i - 1]
      const distKm = leg ? leg.distance / 1000 : haversineKm(a.lat, a.lng, b.lat, b.lng)

      if (distKm > FAR_GAP_KM) {
        gaps.push({
          afterIdx: i - 1,
          distKm: distKm,
          midLat: (a.lat + b.lat) / 2,
          midLng: (a.lng + b.lng) / 2,
          fromName: routePlaces[i - 1].nickname,
          toName: routePlaces[i].nickname,
        })
      }
    }
    return gaps
  }, [routePlaces, osrmRoute])

  // Với mỗi gap xa, tìm candidate AI gần midpoint nhất trong bán kính REST_STOP_RADIUS_KM.
  const restStopSuggestions: RestStopSuggestion[] = useMemo(() => {
    if (!allowAiSuggestions || farGaps.length === 0 || aiSuggestions.length === 0) return []
    const result: RestStopSuggestion[] = []
    const used = new Set<number>()
    for (const gap of farGaps) {
      let best: { place: Place; dist: number } | null = null
      for (const cand of aiSuggestions) {
        if (used.has(cand.placeId)) continue
        if (!cand.lat || !cand.lng) continue
        const d = haversineKm(cand.lat, cand.lng, gap.midLat, gap.midLng)
        if (d > REST_STOP_RADIUS_KM) continue
        if (!best || d < best.dist) best = { place: cand, dist: d }
      }
      if (best) {
        result.push({ place: best.place, gap, distFromMidKm: best.dist })
        used.add(best.place.placeId)
      }
    }
    return result
  }, [aiSuggestions, farGaps, allowAiSuggestions])

  const restStopIds = new Set(restStopSuggestions.map((r) => r.place.placeId))
  const regularSuggestions = aiSuggestions.filter((p) => !restStopIds.has(p.placeId))

  const detourSuggestions: DetourSuggestion[] = useMemo(() => {
    const detours: DetourSuggestion[] = []
    if (routePlaces.length < 2) return detours

    // Phát hiện các CẶP điểm liền kề có khoảng cách quá xa nhau
    const seen = new Set<string>()
    for (let i = 0; i < routePlaces.length - 1; i++) {
      const a = routePlaces[i]
      const b = routePlaces[i + 1]
      if (!a.place.lat || !a.place.lng || !b.place.lat || !b.place.lng) continue
      // Nếu cả 2 đều mustVisit thì bỏ qua
      if (a.mustVisit && b.mustVisit) continue

      const leg = osrmRoute?.legs?.[i]
      const gapKm = leg ? leg.distance / 1000 : haversineKm(a.place.lat, a.place.lng, b.place.lat, b.place.lng)
      const gapMin = travelMinFromKm(gapKm)

      if (gapMin > 20) {
        // Tạo key duy nhất từ cặp placeId (tránh trùng lặp)
        const key = [a.place.placeId, b.place.placeId].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)

        detours.push({
          idxA: i,
          placeA: a.place,
          idxB: i + 1,
          placeB: b.place,
          gapKm,
          extraMin: Math.round(gapMin),
        })
      }
    }

    // Ưu tiên hiển thị cặp tốn nhiều thời gian nhất trước
    return detours.sort((a, b) => b.gapKm - a.gapKm)
  }, [routePlaces, osrmRoute])

  // Tổng thời gian thực tế = visit + travel (haversine / 30km/h). Dùng để cảnh báo
  // route quá dài, không phải để hiển thị trong "Tổng kết" (giữ format cũ).
  const actualTravelMin = useMemo(() => {
    if (osrmRoute) {
      return Math.round(osrmRoute.duration / 60)
    }
    let sum = 0
    for (let i = 1; i < routePlaces.length; i++) {
      const a = routePlaces[i - 1].place
      const b = routePlaces[i].place
      if (a.lat && a.lng && b.lat && b.lng) {
        sum += travelMinFromKm(haversineKm(a.lat, a.lng, b.lat, b.lng))
      }
    }
    return Math.round(sum)
  }, [routePlaces, osrmRoute])

  const totalVisitMin = routePlaces.reduce((s, rp) => s + rp.visitMinutes, 0)
  const totalActiveMin = totalVisitMin + actualTravelMin
  const dayOverrunMin = totalActiveMin - DAILY_TIME_BUDGET_MIN * tripDays  // > 0 = vượt budget

  const dayStartsForRequest = useMemo(() => {
    return Object.entries(dayStartPoints).map(([d, v]) => ({
      dayIndex: Number(d),
      lat: v.lat,
      lng: v.lng,
      name: v.name,
    }))
  }, [dayStartPoints])

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Chưa đăng nhập')
      // Nếu user đã set điểm bắt đầu ngày → tắt strictMode để greedy planner
      // tính khoảng cách từ dayStart tới slot đầu mỗi ngày.
      const useAiMode = dayStartsForRequest.length > 0
      const req: PlanRequest = {
        ...destinationFieldsFor(city),
        startDate,
        endDate: format(addDays(new Date(startDate), tripDays - 1), 'yyyy-MM-dd'),
        budgetTotal: budget,
        anchorPlaceIds: routePlaces.map((rp) => rp.place.placeId),
        preferences: initialRequest?.preferences,
        experienceKeywords: initialRequest?.experienceKeywords,
        additionalNotes: additionalNotes || undefined,
        strictMode: !useAiMode,
        ...(useAiMode ? { dayStarts: dayStartsForRequest } : {}),
      }
      return tripService.generate(req)
    },
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.success('Hành trình đã được lưu!')
      clearPlanningSession()
      navigate(`/trip/${trip.tripId}`)
    },
    onError: () => toast.error('Không thể lưu hành trình. Thử lại sau.'),
  })

  function moveUp(i: number) {
    if (i === 0) return
    setRoutePlaces((prev) => {
      const arr = [...prev]
      ;[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]
      return arr
    })
  }

  function moveDown(i: number) {
    setRoutePlaces((prev) => {
      if (i >= prev.length - 1) return prev
      const arr = [...prev]
      ;[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]
      return arr
    })
  }

  function setAsStart(i: number) {
    if (i === 0) return
    setRoutePlaces((prev) => {
      const arr = [...prev]
      const [item] = arr.splice(i, 1)
      arr.unshift(item)
      return arr
    })
  }

  function optimizeOrder() {
    setRoutePlaces((prev) => {
      if (prev.length <= 2) return prev
      const optimized = nearestNeighborOrder(prev)
      const before = totalRouteKm(prev)
      const after = totalRouteKm(optimized)
      if (after + 0.01 >= before) {
        toast.info('Thứ tự hiện tại đã gần tối ưu.')
        return prev
      }
      toast.success(`Tối ưu thứ tự: ${before.toFixed(1)}km → ${after.toFixed(1)}km`)
      return optimized
    })
  }

  function updateNickname(i: number, value: string) {
    setRoutePlaces((prev) =>
      prev.map((rp, idx) => (idx === i ? { ...rp, nickname: value } : rp)),
    )
  }

  function updateVisitMinutes(i: number, value: number) {
    setRoutePlaces((prev) =>
      prev.map((rp, idx) => (idx === i ? { ...rp, visitMinutes: value } : rp)),
    )
  }

  function removePlace(idx: number) {
    setRoutePlaces((prev) => prev.filter((_, i) => i !== idx))
  }

  function toggleMustVisit(idx: number, value?: boolean) {
    setRoutePlaces((prev) =>
      prev.map((rp, i) => (i === idx ? { ...rp, mustVisit: value ?? !rp.mustVisit } : rp)),
    )
  }

  function computeSchedule() {
    const [h, m] = startTime.split(':').map(Number)
    const base = new Date(startDate)
    base.setHours(h, m, 0, 0)
    let cursor = base
    return routePlaces.map((rp, i) => {
      const start = new Date(cursor)
      const end = addMinutes(start, rp.visitMinutes)
      if (i < routePlaces.length - 1) {
        const leg = osrmRoute?.legs?.[i]
        let travelMin = 0
        if (leg) {
          travelMin = Math.round(leg.duration / 60)
        } else {
          const a = rp.place
          const b = routePlaces[i + 1].place
          if (a.lat && a.lng && b.lat && b.lng) {
            travelMin = Math.round(travelMinFromKm(haversineKm(a.lat, a.lng, b.lat, b.lng)))
          }
        }
        cursor = addMinutes(end, travelMin)
      } else {
        cursor = end
      }
      return { start, end }
    })
  }

  const schedule = computeSchedule()
  const totalMin = totalVisitMin + actualTravelMin
  const totalCost = routePlaces.reduce((s, rp) => s + (rp.place.minPrice || 0), 0)

  const mapSlots: TripSlot[] = routePlaces.map((rp, i) => ({
    slotId: `route-${rp.place.placeId}`,
    tripId: '',
    dayIndex: 0,
    slotOrder: i,
    placeId: rp.place.placeId,
    place: rp.place,
    status: 'planned' as const,
    plannedStart: schedule[i].start.toISOString(),
    plannedEnd: schedule[i].end.toISOString(),
    estimatedCost: rp.place.minPrice || 0,
    activityType: 'sightseeing' as const,
  }))

  if (routePlaces.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="font-semibold text-slate-600">Chưa có địa điểm nào được chọn</p>
          <button
            onClick={() => navigate('/plan')}
            className="mt-4 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Quay lại chọn địa điểm
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-52 bg-slate-900 flex-col shrink-0">
        <div className="px-4 pt-5 pb-4 border-b border-slate-700">
          <p className="text-[11px] font-bold text-slate-200 uppercase tracking-widest truncate">
            {city ? `ĐẾN ${city.toUpperCase()}` : 'CHUYẾN ĐI MỚI'}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-widest">Giai đoạn: Lên kế hoạch</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {[
            { id: 'destinations', label: 'ĐỊA ĐIỂM',  Icon: PersonStanding },
            { id: 'route',        label: 'LỘ TRÌNH',   Icon: Route },
          ].map(({ id, label, Icon }) => {
            const active = id === 'route'
            return (
              <button
                key={id}
                onClick={id === 'destinations'
                  ? () => navigate('/plan', { state: { selectedPlaces: routePlaces.map((rp) => rp.place), planRequest: null } })
                  : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-all ${
                  active
                    ? 'border-l-[3px] border-blue-500 bg-slate-800 text-white pl-[9px]'
                    : 'border-l-[3px] border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[11px] font-bold tracking-widest">{label}</span>
              </button>
            )
          })}
        </nav>

        <div className="px-2 py-3 border-t border-slate-700">
          <button className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
            <Share2 className="w-3.5 h-3.5" />
            <span className="text-[11px] font-bold tracking-widest">Chia sẻ</span>
          </button>
        </div>
      </aside>

      {/* Left panel — Timeline */}
      <div className="w-full md:w-[420px] flex flex-col bg-white border-r border-slate-200 shrink-0 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() =>
                navigate('/plan', {
                  state: { selectedPlaces: routePlaces.map((rp) => rp.place), planRequest: null },
                })
              }
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-slate-900">Sắp xếp lộ trình</h1>
              <p className="text-xs text-slate-500">Bước 2 / 2</p>
            </div>
            <button
              onClick={optimizeOrder}
              disabled={routePlaces.length <= 2}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Tự động sắp xếp theo khoảng cách (nearest-neighbor, giữ điểm đầu tiên)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Tối ưu thứ tự
            </button>
          </div>

          <button
            onClick={() => setIsConstraintsExpanded(!isConstraintsExpanded)}
            className="w-full flex items-center justify-between py-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 mb-3 hover:bg-slate-100 transition-colors"
          >
            <span>Ràng buộc cứng</span>
            {isConstraintsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {/* Trip config */}
          {isConstraintsExpanded && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
              <label className="text-xs text-slate-500 font-medium">Thành phố</label>
              <input
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Ngân sách (đ)</label>
              <input
                type="number"
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Ngày đi</label>
              <input
                type="date"
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Số ngày</label>
              <input
                type="number"
                min={1}
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={tripDays}
                onChange={(e) => setTripDays(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Giờ bắt đầu</label>
              <input
                type="time"
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 font-medium">Yêu cầu thêm (tuỳ chọn)</label>
              <textarea
                rows={2}
                placeholder="VD: cần lối đi cho xe lăn, ăn chay, tránh chỗ đông người..."
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <div className="relative mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={allowAiSuggestions}
                    onChange={(e) => void handleToggleAi(e.target.checked)}
                  />
                  <div className={`w-9 h-5 rounded-full transition-colors ${allowAiSuggestions ? 'bg-blue-600' : 'bg-slate-300'}`} />
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${allowAiSuggestions ? 'translate-x-4' : ''}`} />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-700 leading-tight flex items-center gap-1.5">
                    Để AI gợi ý thêm địa điểm
                    {loadingAi && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                    {allowAiSuggestions
                      ? 'Chọn từ danh sách bên dưới để thêm vào lộ trình'
                      : 'Bật để xem gợi ý phù hợp từ AI'}
                  </p>
                </div>
              </label>
            </div>
          </div>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Dropdown chọn điểm xuất phát */}
          {routePlaces.length > 0 && (
            <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">
                Vị trí xuất phát của bạn
              </label>
              <div className="relative">
                <select
                  className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-8 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 appearance-none cursor-pointer"
                  value={routePlaces[0]?.place.placeId || ''}
                  onChange={(e) => {
                    const idx = routePlaces.findIndex((rp) => rp.place.placeId === Number(e.target.value))
                    if (idx > 0) setAsStart(idx)
                  }}
                >
                  {routePlaces.map((rp, i) => (
                    <option key={rp.place.placeId} value={rp.place.placeId}>
                      {rp.nickname}
                    </option>
                  ))}
                </select>
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-green-600 pointer-events-none">
                  <Flag className="w-4 h-4" />
                </div>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>
          )}

          {/* Per-day start point picker. Khi có ít nhất 1 entry → backend switch AI mode. */}
          <div className="mb-4">
            <DayStartsPicker
              tripDays={tripDays}
              values={dayStartPoints}
              anchorPlaces={routePlaces.map((rp) => rp.place)}
              pickingDay={pickingDayStart}
              onStartPickingDay={(d) => {
                setPickingDayStart(d)
                toast.info(`Nhấn vào bản đồ để chọn điểm bắt đầu ngày ${d + 1}`)
              }}
              onClearDay={(d) => {
                setDayStartPoints((prev) => {
                  const next = { ...prev }
                  delete next[d]
                  return next
                })
                if (pickingDayStart === d) setPickingDayStart(null)
              }}
              onSelectPlace={(d, p) => {
                if (p.lat == null || p.lng == null) {
                  toast.error('Địa điểm này không có toạ độ')
                  return
                }
                setDayStartPoints((prev) => ({
                  ...prev,
                  [d]: { lat: p.lat!, lng: p.lng!, name: p.name },
                }))
                if (pickingDayStart === d) setPickingDayStart(null)
              }}
            />
            {dayStartsForRequest.length > 0 && (
              <p className="mt-1.5 text-[10px] text-blue-600">
                Đã set {dayStartsForRequest.length} điểm bắt đầu → planner sẽ tự xếp lại thứ tự để tối ưu khoảng cách.
              </p>
            )}
          </div>

          {/* Warning: lộ trình quá dài cho X ngày */}
          {dayOverrunMin > 0 && (
            <div className="mb-3 flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800">
                  Lộ trình có thể không đi hết trong {tripDays} ngày
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                  Ước tính cần {Math.floor(totalActiveMin / 60)}h{totalActiveMin % 60 ? String(totalActiveMin % 60).padStart(2, '0') : ''}
                  {' '}(thăm {Math.round(totalVisitMin / 60 * 10) / 10}h + di chuyển {Math.round(actualTravelMin / 60 * 10) / 10}h),
                  vượt quỹ ngày {Math.floor((DAILY_TIME_BUDGET_MIN * tripDays) / 60)}h khoảng {Math.round(dayOverrunMin / 60 * 10) / 10}h.
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setTripDays(Math.ceil(totalActiveMin / DAILY_TIME_BUDGET_MIN))}
                    className="px-2.5 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    Kéo dài thành {Math.ceil(totalActiveMin / DAILY_TIME_BUDGET_MIN)} ngày
                  </button>
                  <button
                    onClick={() => {
                      if (routePlaces.length > 1) {
                        setRoutePlaces(prev => prev.slice(0, prev.length - 1))
                      }
                    }}
                    className="px-2.5 py-1.5 bg-white border border-amber-200 text-amber-700 text-xs font-semibold rounded-lg hover:bg-amber-50 transition-colors"
                  >
                    Bỏ 1 điểm ở cuối
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Warning: Điểm gây vòng vèo */}
          {detourSuggestions.length > 0 && (
            <div className="mb-3 space-y-2">
              {detourSuggestions.map((ds) => (
                <div key={`${ds.placeA.placeId}-${ds.placeB.placeId}`} className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <div className="flex gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-rose-800">
                        "{ds.placeA.name}" và "{ds.placeB.name}" cách nhau quá xa (~{ds.gapKm.toFixed(1)}km · {ds.extraMin} phút)
                      </p>
                      <p className="text-[11px] text-rose-700 mt-0.5 leading-relaxed">
                        Hai điểm này nằm xa nhau, khiến lộ trình bị kéo dài. Hãy chọn bỏ 1 trong 2 hoặc giữ cả hai nếu bạn muốn.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2.5 pl-6">
                    {!routePlaces[ds.idxA]?.mustVisit && (
                      <button
                        onClick={() => removePlace(ds.idxA)}
                        className="px-2.5 py-1.5 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 transition-colors"
                      >
                        Bỏ "{ds.placeA.name}"
                      </button>
                    )}
                    {!routePlaces[ds.idxB]?.mustVisit && (
                      <button
                        onClick={() => removePlace(ds.idxB)}
                        className="px-2.5 py-1.5 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 transition-colors"
                      >
                        Bỏ "{ds.placeB.name}"
                      </button>
                    )}
                    <button
                      onClick={() => {
                        toggleMustVisit(ds.idxA, true)
                        toggleMustVisit(ds.idxB, true)
                      }}
                      className="px-2.5 py-1.5 bg-white border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg hover:bg-rose-50 transition-colors"
                    >
                      Giữ cả hai
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Warning: có gap xa, gợi ý bật AI để tìm điểm dừng */}
          {farGaps.length > 0 && !allowAiSuggestions && (
            <div className="mb-3 flex gap-2.5 bg-orange-50 border border-orange-200 rounded-xl p-3">
              <Coffee className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-orange-800">
                  Có {farGaps.length} đoạn đường xa (&gt;{FAR_GAP_KM}km)
                </p>
                <p className="text-[11px] text-orange-700 mt-0.5 leading-relaxed">
                  Bật <span className="font-semibold">"Để AI gợi ý thêm địa điểm"</span> để xem điểm dừng chân giữa đường.
                </p>
              </div>
            </div>
          )}

          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[22px] top-3 bottom-3 w-0.5 bg-slate-200" />

            {routePlaces.map((rp, i) => (
              <div key={rp.place.placeId} className="relative flex gap-3 mb-1">
                {/* Numbered dot */}
                <div className="w-11 shrink-0 flex flex-col items-center pt-1 z-10">
                  <div className={`rounded-full border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold ${i === 0 ? 'w-6 h-6 bg-green-500' : 'w-5 h-5 bg-blue-600'}`}>
                    {i === 0 ? <Flag className="w-3 h-3" /> : i + 1}
                  </div>
                </div>

                {/* Card */}
                <div className="flex-1 pb-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <input
                          className="w-full font-semibold text-sm text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none pb-0.5 transition-colors"
                          value={rp.nickname}
                          onChange={(e) => updateNickname(i, e.target.value)}
                        />
                        {rp.nickname !== rp.place.name && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate">{rp.place.name}</p>
                        )}
                        {i === 0 && (
                          <span className="inline-block mt-1.5 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold uppercase tracking-widest rounded">
                            Điểm xuất phát
                          </span>
                        )}
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <button
                          onClick={() => setSelectedSuggestion(rp.place)}
                          className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 hover:text-blue-500"
                          title="Xem thông tin địa điểm"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                        {i > 0 && (
                          <button
                            onClick={() => setAsStart(i)}
                            className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 hover:text-green-600"
                            title="Đặt làm điểm xuất phát"
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => toggleMustVisit(i)}
                          className={`p-1 rounded hover:bg-slate-200 transition-colors ${rp.mustVisit ? 'text-rose-500' : 'text-slate-400'}`}
                          title={rp.mustVisit ? 'Đã đánh dấu bắt buộc đi' : 'Đánh dấu bắt buộc đi'}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => removePlace(i)}
                          className="p-1 rounded hover:bg-slate-200 transition-colors text-slate-400 hover:text-red-500"
                          title="Xóa khỏi lộ trình"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveUp(i)}
                          disabled={i === 0}
                          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                        <button
                          onClick={() => moveDown(i)}
                          disabled={i === routePlaces.length - 1}
                          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span className="font-medium text-blue-600">
                        {format(schedule[i].start, 'HH:mm')} – {format(schedule[i].end, 'HH:mm')}
                      </span>
                      <select
                        className="ml-auto bg-white border border-slate-200 rounded text-xs px-1.5 py-0.5 text-slate-600 focus:outline-none"
                        value={rp.visitMinutes}
                        onChange={(e) => updateVisitMinutes(i, Number(e.target.value))}
                      >
                        {[30, 45, 60, 90, 120, 180].map((m) => (
                          <option key={m} value={m}>
                            {m < 60 ? `${m}p` : `${m / 60}h`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Explanation panel — shown when place has scoreBreakdown */}
                    {rp.place.scoreBreakdown && (() => {
                      const comps = breakdownToComponents(rp.place.scoreBreakdown!)
                      const summary = comps.filter(c => c.positive).slice(0, 3).map(c => c.label).join(' · ')
                      const isExpanded = expandedExplanationIdx === i
                      return (
                        <div className="mt-2 border-t border-slate-100 pt-2">
                          {/* Summary line — always visible */}
                          {summary && (
                            <p className="text-[11px] text-slate-500 leading-relaxed mb-1">{summary}</p>
                          )}
                          <button
                            onClick={() => setExpandedExplanationIdx(isExpanded ? null : i)}
                            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700 transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            {isExpanded ? 'Thu gọn' : 'Xem chi tiết'}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 space-y-1.5">
                              {comps.map(c => (
                                <div key={c.name} className="flex items-center gap-2">
                                  <div className="w-28 shrink-0 text-[10px] text-slate-500 truncate">{c.label}</div>
                                  <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${c.positive ? 'bg-blue-400' : 'bg-red-300'}`}
                                      style={{ width: `${c.pct}%` }}
                                    />
                                  </div>
                                  <div className="w-7 text-right text-[10px] text-slate-400">{c.pct}%</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Transit gap */}
                  {i < routePlaces.length - 1 && (() => {
                    const a = rp.place
                    const b = routePlaces[i + 1].place
                    
                    let distKm = 0
                    let travelMin = 0
                    const leg = osrmRoute?.legs?.[i]

                    if (leg) {
                      distKm = leg.distance / 1000
                      travelMin = Math.round(leg.duration / 60)
                    } else if (a.lat && a.lng && b.lat && b.lng) {
                      distKm = haversineKm(a.lat, a.lng, b.lat, b.lng)
                      travelMin = Math.round(travelMinFromKm(distKm))
                    }
                    
                    const isFar = distKm > FAR_GAP_KM
                    return (
                      <div className="flex items-center gap-2 py-1 pl-1">
                        <span className={`text-xs pl-3 ${isFar ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                          ↓ {distKm.toFixed(1)} km · ~{travelMin} phút di chuyển
                          {isFar && ' · xa'}
                        </span>
                      </div>
                    )
                  })()}
                </div>
              </div>
            ))}
          </div>

          {/* Summary card */}
          <div className="mt-1 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-800 mb-2">Tổng kết lộ trình</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-base font-bold text-slate-900">{routePlaces.length}</p>
                <p className="text-xs text-slate-500">Địa điểm</p>
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  {totalMin >= 60
                    ? `${Math.floor(totalMin / 60)}h${totalMin % 60 ? String(totalMin % 60).padStart(2, '0') : ''}`
                    : `${totalMin}p`}
                </p>
                <p className="text-xs text-slate-500">Thời gian</p>
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  {totalCost > 0 ? `${(totalCost / 1000).toFixed(0)}K` : 'Miễn phí'}
                </p>
                <p className="text-xs text-slate-500">Chi phí</p>
              </div>
            </div>
          </div>

          {/* AI suggestions list */}
          {allowAiSuggestions && (
            <div className="mt-4 px-1">
              {loadingAi ? (
                <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang tìm địa điểm phù hợp...
                </div>
              ) : aiSuggestions.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-4">
                  Tất cả địa điểm phù hợp đã được thêm vào lộ trình.
                </p>
              ) : (
                <>
                  {/* Rest stops — ưu tiên hiển thị trước, có badge giải thích vị trí */}
                  {restStopSuggestions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Coffee className="w-3 h-3" /> Điểm dừng chân giữa đường
                      </p>
                      <div className="space-y-2">
                        {restStopSuggestions.map(({ place, gap, distFromMidKm }) => (
                          <div
                            key={place.placeId}
                            className="flex items-center gap-2.5 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 hover:bg-orange-100 transition-colors"
                          >
                            <button
                              onClick={() => setSelectedSuggestion(place)}
                              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                            >
                              <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-orange-200">
                                {place.imageUrl ? (
                                  <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-base">☕</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate">{place.name}</p>
                                <p className="text-[10px] text-orange-700 truncate">
                                  Giữa <span className="font-medium">{gap.fromName}</span> → <span className="font-medium">{gap.toName}</span>
                                  {' '}({gap.distKm.toFixed(0)}km, lệch {distFromMidKm.toFixed(1)}km)
                                </p>
                              </div>
                            </button>
                            <button
                              onClick={() => addRestStopAt(place, gap.afterIdx)}
                              className="shrink-0 w-7 h-7 rounded-full bg-orange-600 text-white flex items-center justify-center hover:bg-orange-700 transition-colors"
                              title="Chèn vào giữa 2 điểm trên"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setAiSuggestions((prev) => prev.filter((p) => p.placeId !== place.placeId))}
                              className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-slate-200 transition-colors"
                              title="Bỏ qua"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Regular AI suggestions */}
                  {regularSuggestions.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2">
                        Gợi ý từ AI
                      </p>
                      <div className="space-y-2">
                        {regularSuggestions.map((place) => (
                          <div
                            key={place.placeId}
                            className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 hover:bg-blue-100 transition-colors"
                          >
                            <button
                              onClick={() => setSelectedSuggestion(place)}
                              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                            >
                              <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-blue-200">
                                {place.imageUrl ? (
                                  <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-base">🏛️</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate">{place.name}</p>
                                {place.description && (
                                  <p className="text-[10px] text-slate-500 truncate">{place.description}</p>
                                )}
                              </div>
                            </button>
                            <button
                              onClick={() => addAiSuggestion(place)}
                              className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 transition-colors"
                              title="Thêm vào lộ trình"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setAiSuggestions((prev) => prev.filter((p) => p.placeId !== place.placeId))}
                              className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-slate-200 transition-colors"
                              title="Bỏ qua"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Save button */}
        <div className="px-4 py-3 border-t border-slate-100 shrink-0">
          <button
            onClick={() => save()}
            disabled={isPending || routePlaces.length === 0}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {isPending ? 'Đang lưu hành trình...' : 'Lưu hành trình'}
          </button>
        </div>
      </div>

      {/* Right panel — Map */}
      <div className="hidden md:flex flex-1 relative">
        <TripMap
          slots={mapSlots}
          className="w-full h-full rounded-none"
          onMapClick={(lat, lng) => {
            if (pickingDayStart === null) return
            const day = pickingDayStart
            setDayStartPoints((prev) => ({ ...prev, [day]: { lat, lng } }))
            setPickingDayStart(null)
            toast.info(`Đã chọn điểm bắt đầu ngày ${day + 1}`)
          }}
        />
        {pickingDayStart !== null && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-xl px-4 py-2 shadow-lg text-sm font-medium text-blue-700 pointer-events-none z-10">
            📍 Nhấn vào bản đồ để chọn điểm bắt đầu ngày {pickingDayStart + 1}
          </div>
        )}
        <DestinationDetailPanel
          place={selectedSuggestion}
          onClose={() => setSelectedSuggestion(null)}
          onAdd={addAiSuggestion}
          alreadyAdded={
            selectedSuggestion !== null &&
            routePlaces.some((rp) => rp.place.placeId === selectedSuggestion.placeId)
          }
        />
      </div>
    </div>
  )
}
