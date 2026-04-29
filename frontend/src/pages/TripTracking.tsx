import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Lightbulb, MapPin, Utensils, CheckCircle,
  Building2, Search, LocateFixed, Plus, Minus,
  Navigation, Bell, Settings, UserCircle, GitBranch, Zap,
} from 'lucide-react'
import { tripService } from '@/services/tripService'
import { toast } from '@/store/toastStore'
import { monitorService } from '@/services/monitorService'
import { useTripStore } from '@/store/tripStore'
import { PageSpinner } from '@/components/ui/Spinner'
import { TripMap } from '@/components/map/TripMap'
import { format, parseISO, isBefore, isAfter } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useMemo, useState } from 'react'

export default function TripTracking() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const { setTrip, trip, focusedSlotId } = useTripStore()
  const queryClient = useQueryClient()
  const [now] = useState(new Date()) // Pin 'now' to prevent recalculation on every render

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

  const { data: incidentData } = useQuery({
    queryKey: ['check-incident', tripId],
    queryFn: () => monitorService.checkIncident(),
    refetchInterval: 30_000,
    enabled: !!tripId,
  })

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

  if (isLoading) return <PageSpinner />
  if (error || !trip) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-slate-500">Không tìm thấy chuyến đi</p>
        <button onClick={() => navigate('/')} className="btn-secondary">Về trang chủ</button>
      </div>
    )
  }

  const sortedSlots = useMemo(() => {
    if (!trip) return []
    return [...trip.slots].sort(
      (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
    )
  }, [trip?.slots])
  
  const { completedSlots, currentSlot, upcomingSlots } = useMemo(() => {
    if (!sortedSlots.length) return { completedSlots: [], currentSlot: null, upcomingSlots: [] }
    
    const completed = sortedSlots.filter((s) =>
      s.status === 'completed' || isBefore(parseISO(s.plannedEnd), now)
    )
    
    const current = sortedSlots.find((s) =>
      !isBefore(parseISO(s.plannedEnd), now) && !isAfter(parseISO(s.plannedStart), now)
    ) ?? sortedSlots.find((s) => s.status !== 'completed' && isAfter(parseISO(s.plannedStart), now))
    
    const upcoming = sortedSlots.filter((s) =>
      s !== current && !completed.includes(s) && isAfter(parseISO(s.plannedStart), now)
    ).slice(0, 3)
    
    return { completedSlots: completed, currentSlot: current, upcomingSlots: upcoming }
  }, [sortedSlots, now])

  const hasIncident = !!(incidentData && 'type' in incidentData && incidentData.type)
  const incidentReason = hasIncident && 'reason' in incidentData ? incidentData.reason : null

  const mapImageUrl = 'https://lh3.googleusercontent.com/aida-public/AB6AXuAIIRWkmU61v_98zEqO2QOIhonwPwMkr32uuAmB5OANkJ27V_wg6IxsEmiccW21Q7RCt8wd_VCXhDEVcS05Q6_8gJ-2oBLT2PLyB-lFlFBfHrsDapoEqwAyuDP_noQbamEP9D-v-FOYkitwomjR_l-mA9rqWYJdH9b3rJJETFoDoMEZP4Zklr2BwaA8JzDPEY_qXyqKk0v1Tr8Jg2KT5W5Esj9ygtQB0ffBVBCXQOiOhX0RVffSOjFmv0FbStS8P22w6Q378quP_RM'

  return (
    <div className="bg-slate-50 font-sans text-slate-900 min-h-screen">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-16 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold tracking-tight text-slate-900">
            {trip.title ?? trip.destinationCity}
          </span>
          <nav className="hidden md:flex items-center gap-6">
            <span className="text-blue-600 border-b-2 border-blue-600 font-semibold pb-1 text-sm">Live Track</span>
            <button onClick={() => navigate(`/trip/${tripId}`)} className="text-slate-500 hover:text-blue-600 text-sm font-medium">Timeline</button>
            <button className="text-slate-500 hover:text-blue-600 text-sm font-medium">Alerts</button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-slate-50 rounded-full">
            <Bell className="w-5 h-5 text-slate-600" />
          </button>
          <button className="p-2 hover:bg-slate-50 rounded-full">
            <Settings className="w-5 h-5 text-slate-600" />
          </button>
          <button onClick={() => navigate('/profile')} className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            <UserCircle className="w-6 h-6 text-blue-600" />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="pt-16 pb-20 md:pb-0 min-h-screen flex flex-col md:flex-row overflow-hidden">
        {/* Left: Timeline */}
        <section className="w-full md:w-5/12 lg:w-4/12 h-[calc(100vh-64px)] overflow-y-auto bg-white border-r border-slate-200 p-6">
          <div className="mb-8">
            <h1 className="text-xl font-bold text-slate-900 mb-1">Chuyến đi đang diễn ra</h1>
            <p className="text-slate-500 text-sm">
              {format(new Date(), 'EEEE, dd MMMM, yyyy', { locale: vi })}
            </p>
          </div>

          {/* Incident Alert */}
          {hasIncident && (
            <div className="mb-8 p-4 bg-red-50 border-2 border-red-500 rounded-xl shadow-sm">
              <div className="flex gap-3 mb-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-xs tracking-widest text-red-800 uppercase mb-1">Sự kiện bất thường</h3>
                  <p className="text-red-800 text-sm opacity-90">
                    {incidentReason ?? 'Phát hiện sự kiện ảnh hưởng đến lịch trình. Hoạt động có thể bị thay đổi.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate(`/trip/${tripId}/replan`)}
                className="w-full py-3 bg-red-600 text-white font-bold rounded-lg hover:brightness-110 transition-all flex items-center justify-center gap-2 text-sm"
              >
                <Lightbulb className="w-4 h-4" />
                Xem gợi ý điều chỉnh
              </button>
            </div>
          )}

          {/* Timeline items */}
          <div className="relative space-y-8">
            {/* Current */}
            {currentSlot && (
              <div className="relative pl-12">
                <div className="absolute left-0 top-0 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center z-10 shadow-lg shadow-blue-200">
                  <MapPin className="w-5 h-5 text-white fill-white" />
                </div>
                <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-blue-200" />
                <div className="bg-white border-2 border-blue-200 p-4 rounded-xl">
                  <div className="flex justify-between items-start mb-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-[10px] font-bold rounded uppercase">Đang ở đây</span>
                    <span className="text-slate-400 text-xs font-semibold">
                      {format(parseISO(currentSlot.plannedStart), 'HH:mm')}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-base">{currentSlot.place?.name ?? 'Địa điểm hiện tại'}</h4>
                  {currentSlot.place?.description && (
                    <p className="text-slate-500 text-sm mt-1 line-clamp-2">{currentSlot.place.description}</p>
                  )}
                  <button
                    onClick={() => {
                      tripService.completeSlot(trip.tripId, currentSlot.slotId)
                        .then(() => {
                          queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
                          toast.success('Hoàn thành địa điểm!')
                        })
                        .catch(() => toast.error('Không thể cập nhật'))
                    }}
                    className="mt-3 w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Đã hoàn thành
                  </button>
                </div>
              </div>
            )}

            {/* Upcoming slots */}
            {upcomingSlots.map((slot, idx) => {
              const isRisk = hasIncident && idx === 0
              return (
                <div key={slot.slotId} className="relative pl-12">
                  <div className={`absolute left-0 top-0 w-10 h-10 bg-white border-2 rounded-full flex items-center justify-center z-10 ${isRisk ? 'border-red-500' : 'border-slate-200'}`}>
                    {slot.activityType === 'meal'
                      ? <Utensils className={`w-5 h-5 ${isRisk ? 'text-red-500' : 'text-slate-400'}`} />
                      : <Building2 className={`w-5 h-5 ${isRisk ? 'text-red-500' : 'text-slate-400'}`} />
                    }
                  </div>
                  {idx < upcomingSlots.length - 1 && (
                    <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-slate-200" />
                  )}
                  <div className={`p-4 rounded-xl border ${isRisk ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase ${isRisk ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-500'}`}>
                        {isRisk ? 'Sắp tới (Rủi ro)' : 'Kế hoạch'}
                      </span>
                      <span className="text-slate-400 text-xs font-semibold">
                        {format(parseISO(slot.plannedStart), 'HH:mm')}
                      </span>
                    </div>
                    <h4 className="font-bold text-slate-900 text-base">{slot.place?.name ?? `Địa điểm ${idx + 2}`}</h4>
                    {slot.place?.description && (
                      <p className="text-slate-500 text-sm mt-1 line-clamp-2">{slot.place.description}</p>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Completed slots */}
            {completedSlots.slice(-1).map((slot) => (
              <div key={slot.slotId} className="relative pl-12">
                <div className="absolute left-0 top-0 w-10 h-10 bg-slate-100 border-2 border-slate-200 rounded-full flex items-center justify-center z-10">
                  <CheckCircle className="w-5 h-5 text-slate-300" />
                </div>
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl opacity-60">
                  <div className="flex justify-between items-start mb-2">
                    <span className="px-2 py-1 bg-slate-200 text-slate-500 text-[10px] font-bold rounded uppercase">Đã hoàn thành</span>
                    <span className="text-slate-400 text-xs font-semibold">
                      {format(parseISO(slot.plannedStart), 'HH:mm')}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-base">{slot.place?.name ?? 'Địa điểm đã qua'}</h4>
                </div>
              </div>
            ))}

            {/* Proactive suggestion */}
            {!hasIncident && currentSlot && (
              <div className="mt-10 p-5 bg-blue-50 border-2 border-blue-600 rounded-2xl shadow-md">
                <div className="flex items-start gap-4 mb-4">
                  <div className="p-2 bg-blue-600 rounded-xl shrink-0">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base mb-1">Bạn muốn ở lại đây lâu hơn?</h3>
                    <p className="text-slate-600 text-sm">
                      Hệ thống nhận thấy bạn đang tận hưởng không khí tại đây. Bạn có muốn chuyển sang chế độ di chuyển thong thả?
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/trip/${tripId}/replan`)}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:brightness-110 shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
                >
                  Điều chỉnh lộ trình
                </button>
                <p className="text-center text-[11px] text-blue-600 font-medium mt-3 uppercase tracking-wider">
                  Lịch trình sẽ tự động lùi lại 45 phút
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Right: Map */}
        <section className="w-full md:w-7/12 lg:w-8/12 h-64 md:h-[calc(100vh-64px)] relative bg-slate-200 overflow-hidden">
          <div className="absolute inset-0">
            <TripMap 
              slots={trip.slots}
              focusedSlotId={focusedSlotId}
              className="w-full h-full rounded-none"
            />
          </div>

          {/* Search bar */}
          <div className="absolute top-6 left-6 right-6 z-10">
            <div className="max-w-md w-full bg-white rounded-xl shadow-lg border border-slate-200 p-2 flex items-center gap-3">
              <Search className="w-5 h-5 text-blue-600 ml-2 shrink-0" />
              <input
                className="flex-1 border-none focus:ring-0 text-sm bg-transparent outline-none"
                placeholder="Tìm kiếm địa điểm lân cận..."
              />
            </div>
          </div>

          {/* Map controls */}
          <div className="absolute bottom-6 right-6 z-10 flex flex-col gap-3">
            <button className="w-12 h-12 bg-white rounded-xl shadow-lg flex items-center justify-center hover:bg-slate-50">
              <LocateFixed className="w-5 h-5 text-slate-600" />
            </button>
            <button className="w-12 h-12 bg-white rounded-xl shadow-lg flex items-center justify-center hover:bg-slate-50">
              <Plus className="w-5 h-5 text-slate-600" />
            </button>
            <button className="w-12 h-12 bg-white rounded-xl shadow-lg flex items-center justify-center hover:bg-slate-50">
              <Minus className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Current location marker */}
          {currentSlot && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
              <div className="bg-blue-600 text-white px-4 py-2 rounded-full font-bold shadow-xl mb-2 flex items-center gap-2 text-sm">
                <Navigation className="w-4 h-4" />
                {currentSlot.place?.name ?? 'Vị trí hiện tại'}
              </div>
              <div className="w-8 h-8 bg-blue-600 border-4 border-white rounded-full shadow-lg animate-pulse" />
            </div>
          )}

          {/* Incident marker */}
          {hasIncident && upcomingSlots[0] && (
            <div className="absolute top-[35%] left-[65%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
              <div className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold shadow-2xl mb-2 flex flex-col items-center border-2 border-white">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wider font-bold">{upcomingSlots[0].place?.name ?? 'Địa điểm tiếp theo'}</span>
                </div>
                <div className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-medium">
                  Cảnh báo — ảnh hưởng lịch trình
                </div>
              </div>
              <div className="relative flex items-center justify-center">
                <div className="w-8 h-8 bg-red-600 border-4 border-white rounded-full shadow-lg z-10" />
                <div className="absolute w-12 h-12 bg-red-600 rounded-full animate-ping opacity-40" />
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Bottom Nav - Mobile */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-20 bg-white border-t border-slate-200 px-4 md:hidden">
        <div className="flex flex-col items-center text-blue-600 border-t-2 border-blue-600 pt-2 flex-1">
          <MapPin className="w-5 h-5 fill-blue-600" />
          <span className="text-[11px] font-semibold mt-1">Track</span>
        </div>
        <button onClick={() => navigate(`/trip/${tripId}`)} className="flex flex-col items-center text-slate-400 pt-2 flex-1">
          <GitBranch className="w-5 h-5" />
          <span className="text-[11px] font-semibold mt-1">Route</span>
        </button>
        <button className="flex flex-col items-center text-slate-400 pt-2 flex-1">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-[11px] font-semibold mt-1">Alerts</span>
        </button>
        <button onClick={() => navigate(`/trip/${tripId}/replan`)} className="flex flex-col items-center text-slate-400 pt-2 flex-1">
          <Zap className="w-5 h-5" />
          <span className="text-[11px] font-semibold mt-1">Plan</span>
        </button>
      </nav>
    </div>
  )
}
