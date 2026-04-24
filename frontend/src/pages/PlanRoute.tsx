import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Clock, ChevronUp, ChevronDown, ArrowLeft,
  Bookmark, Map, User, Save, AlertCircle,
} from 'lucide-react'
import { format, addMinutes } from 'date-fns'
import { TripMap } from '@/components/map/TripMap'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import type { Place, PlanRequest, TripSlot } from '@/types'

interface RoutePlace {
  place: Place
  nickname: string
  visitMinutes: number
}

export default function PlanRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const state = location.state as { selectedPlaces?: Place[]; planRequest?: PlanRequest } | null
  const initialPlaces: Place[] = state?.selectedPlaces ?? []
  const initialRequest: PlanRequest | null = state?.planRequest ?? null

  const [routePlaces, setRoutePlaces] = useState<RoutePlace[]>(
    initialPlaces.map((p) => ({
      place: p,
      nickname: p.name,
      visitMinutes: p.avgVisitDurationMin || 60,
    })),
  )
  const [startTime, setStartTime] = useState('08:00')
  const [startDate, setStartDate] = useState(
    initialRequest?.startDate ?? format(new Date(), 'yyyy-MM-dd'),
  )
  const [budget, setBudget] = useState(initialRequest?.budgetTotal ?? 3_000_000)
  const [city, setCity] = useState(initialRequest?.destinationCity ?? 'Đà Nẵng')

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Chưa đăng nhập')
      const req: PlanRequest = {
        destinationCity: city,
        startDate,
        endDate: startDate,
        budgetTotal: budget,
        anchorPlaceIds: routePlaces.map((rp) => rp.place.placeId),
      }
      return tripService.generate(req)
    },
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.success('Hành trình đã được lưu!')
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

  function computeSchedule() {
    const [h, m] = startTime.split(':').map(Number)
    const base = new Date(startDate)
    base.setHours(h, m, 0, 0)
    let cursor = base
    return routePlaces.map((rp) => {
      const start = new Date(cursor)
      const end = addMinutes(start, rp.visitMinutes)
      cursor = addMinutes(end, 30)
      return { start, end }
    })
  }

  const schedule = computeSchedule()
  const totalMin =
    routePlaces.reduce((s, rp) => s + rp.visitMinutes, 0) +
    Math.max(0, routePlaces.length - 1) * 30
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

  if (initialPlaces.length === 0) {
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
      <aside className="w-16 lg:w-56 bg-slate-900 flex flex-col shrink-0 z-20">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <span className="hidden lg:block font-bold text-white text-lg">VOYAGER</span>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          <button
            onClick={() =>
              navigate('/plan', { state: { selectedPlaces: routePlaces.map((rp) => rp.place) } })
            }
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-left"
          >
            <MapPin className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block text-sm font-medium">Địa điểm</span>
          </button>
          <button
            onClick={() => navigate('/trips')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-left"
          >
            <Bookmark className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block text-sm font-medium">Chuyến đi</span>
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-blue-600 text-white text-left">
            <Map className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block text-sm font-medium">Lộ trình</span>
          </button>
        </nav>

        <div className="p-2 border-t border-slate-700">
          <button
            onClick={() => navigate('/profile')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <User className="w-5 h-5 shrink-0" />
            <span className="hidden lg:block text-sm font-medium">Cá nhân</span>
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
            <div>
              <h1 className="font-bold text-slate-900">Sắp xếp lộ trình</h1>
              <p className="text-xs text-slate-500">Bước 2 / 2</p>
            </div>
          </div>

          {/* Trip config */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 font-medium">Thành phố</label>
              <input
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={city}
                onChange={(e) => setCity(e.target.value)}
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
              <label className="text-xs text-slate-500 font-medium">Giờ bắt đầu</label>
              <input
                type="time"
                className="w-full mt-0.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
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
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-[22px] top-3 bottom-3 w-0.5 bg-slate-200" />

            {routePlaces.map((rp, i) => (
              <div key={rp.place.placeId} className="relative flex gap-3 mb-1">
                {/* Numbered dot */}
                <div className="w-11 shrink-0 flex flex-col items-center pt-1 z-10">
                  <div className="w-5 h-5 rounded-full bg-blue-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[10px] font-bold">
                    {i + 1}
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
                      </div>
                      <div className="flex gap-0.5 shrink-0">
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
                  </div>

                  {/* Transit gap */}
                  {i < routePlaces.length - 1 && (
                    <div className="flex items-center gap-2 py-1 pl-1">
                      <span className="text-xs text-slate-400 pl-3">↓ ~30 phút di chuyển</span>
                    </div>
                  )}
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
        <TripMap slots={mapSlots} className="w-full h-full rounded-none" />
      </div>
    </div>
  )
}
