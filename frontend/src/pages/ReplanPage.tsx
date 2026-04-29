import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, CloudLightning, X, Sparkles, CheckCircle,
  Ban, Coffee, PlusCircle, Lightbulb, UserCircle, Bell,
} from 'lucide-react'
import { tripService } from '@/services/tripService'
import { monitorService } from '@/services/monitorService'
import { placeService } from '@/services/placeService'
import { useReplanProposal } from '@/components/replan/useReplanProposal'
import { useTripStore } from '@/store/tripStore'
import { PageSpinner } from '@/components/ui/Spinner'
import { TripMap } from '@/components/map/TripMap'
import { toast } from '@/store/toastStore'
import { format, parseISO } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import type { Place } from '@/types'


export default function ReplanPage() {
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null)
  const [showIncident, setShowIncident] = useState(true)
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { setTrip, trip } = useTripStore()

  const triggeredByEventId = useMemo(() => 
    (location.state as { triggeredByEventId?: string })?.triggeredByEventId
  , [location.state])

  const { data, isLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

  const { data: incidentData } = useQuery({
    queryKey: ['check-incident', tripId],
    queryFn: () => monitorService.checkIncident(),
    enabled: !!tripId,
  })

  // Fetch all places for the destination city to ensure we have coordinates for proposed places
  const { data: cityPlaces } = useQuery({
    queryKey: ['city-places', trip?.destinationCity],
    queryFn: () => tripService.candidates({
      destinationCity: trip!.destinationCity,
      startDate: trip!.startDate,
      endDate: trip!.endDate,
      budgetTotal: trip!.budgetTotal
    }),
    enabled: !!trip?.destinationCity,
  })

  const { proposal, isLoading: proposalLoading, accept, reject } = useReplanProposal(tripId!)

  const { mutate: triggerReplan, isPending: isReplanning } = useMutation({
    mutationFn: () => tripService.replan(tripId!, 'remaining_trip', triggeredByEventId),
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      // TODO: delete debug log
      console.log(`>>>>>>> error: ${err}`);
      if (status !== 409) toast.error('Không thể tạo đề xuất. Thử lại sau.')
    },
  })

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

  useEffect(() => {
    if (tripId && !proposal && !proposalLoading) {
      triggerReplan()
    }
  }, [tripId, proposal, proposalLoading])

  const hasIncident = !!(incidentData && 'type' in incidentData && incidentData.type)
  const incidentReason = hasIncident && 'reason' in incidentData ? incidentData.reason : null

  const handleAccept = () => {
    if (!proposal) return
    accept.mutate(proposal.proposalId)
    queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
    toast.success('Đã áp dụng lịch trình mới!')
    navigate(`/trip/${tripId}/live`)
  }

  const handleReject = () => {
    if (!proposal) return
    reject.mutate({ proposalId: proposal.proposalId, reason: 'user_rejected' })
    toast.info('Đã từ chối đề xuất')
    navigate(-1)
  }

  const slots = trip?.slots ?? []
  const sortedSlots = useMemo(() => {
    return [...slots].sort(
      (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
    )
  }, [slots])
  
  const originalSlots = useMemo(() => sortedSlots.slice(0, 3), [sortedSlots])

  // Build a comprehensive places map
  const placesMap = useMemo(() => {
    const map = new Map<number, Place>()
    // 1. From original trip slots
    slots.forEach(s => {
      if (s.place) map.set(s.placeId, s.place)
    })
    // 2. From city candidates (if any new places are proposed)
    cityPlaces?.forEach(p => {
      map.set(p.placeId, p)
    })
    return map
  }, [slots, cityPlaces])

  // placeId → name lookup from current trip slots
  const placeNameMap = useMemo(() => 
    new Map(Array.from(placesMap.entries()).map(([id, p]) => [id, p.name]))
  , [placesMap])
  
  const rawProposedSlots = proposal?.newPlanSnapshot ?? []
  const proposedSlots = useMemo(() => {
    return rawProposedSlots.map(slot => ({
      ...slot,
      place: placesMap.get(slot.placeId)
    }))
  }, [rawProposedSlots, placesMap])

  if (isLoading || proposalLoading || isReplanning) return <PageSpinner />

  return (
    <div className="bg-slate-50 font-sans text-slate-900 min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b-2 border-slate-100">
        <div className="flex justify-between items-center w-full px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <span className="text-2xl font-black tracking-tighter text-blue-600">HORIZON</span>
          </div>
          <div className="flex items-center gap-4">
            <button><Bell className="w-5 h-5 text-slate-500" /></button>
            <button onClick={() => navigate('/profile')}><UserCircle className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Incident Banner */}
        {hasIncident && showIncident && (
          <div className="mb-10 bg-red-50 border-2 border-red-500 p-6 rounded-xl flex items-start gap-6">
            <div className="bg-red-600 text-white p-2 rounded-full shrink-0">
              <CloudLightning className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-xl text-red-900">Cảnh báo</h2>
              <p className="text-red-800/90 text-base mt-1">
                {incidentReason ?? 'Phát hiện sự kiện ảnh hưởng đến lịch trình của bạn. Chúng tôi đề xuất điều chỉnh để tránh gián đoạn.'}
              </p>
            </div>
            <button 
              onClick={() => setShowIncident(false)}
              className="text-red-800/50 hover:text-red-800 p-1 hover:bg-red-100 rounded-md transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left: Schedule Comparison */}
          <div className="lg:col-span-8 space-y-10">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-slate-900">So sánh lịch trình</h3>
                <div className="flex gap-2">
                  <span className="px-3 py-1 bg-slate-100 text-slate-500 font-bold rounded-full border border-slate-200 text-sm">GỐC</span>
                  <span className="px-3 py-1 bg-blue-600 text-white font-bold rounded-full text-sm">AI ĐỀ XUẤT</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Original */}
                <div className="bg-white border-2 border-slate-100 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 p-4 border-b border-slate-100 font-bold text-slate-500 uppercase tracking-widest text-xs">
                    Lịch trình ban đầu
                  </div>
                  <div className="p-6 space-y-4">
                    {originalSlots.length > 0 ? originalSlots.map((slot, i) => (
                      <div 
                        key={slot.slotId} 
                        className={`flex items-center gap-4 transition-all cursor-pointer group ${i === 0 && hasIncident ? 'opacity-50 line-through' : ''}`}
                        onClick={() => setFocusedSlotId(slot.slotId)}
                      >
                        <div className="w-14 text-sm font-bold text-slate-400 shrink-0 group-hover:text-slate-600">
                          {format(parseISO(slot.plannedStart), 'HH:mm')}
                        </div>
                        <div className={`p-3 rounded-lg flex-1 font-bold text-sm transition-all ${focusedSlotId === slot.slotId ? 'bg-slate-100 border-slate-300 ring-2 ring-slate-100' : (i === 0 && hasIncident ? 'bg-slate-50 border border-slate-200' : 'bg-white border-2 border-slate-100 hover:border-slate-300')}`}>
                          {slot.place?.name ?? `Địa điểm ${i + 1}`}
                        </div>
                      </div>
                    )) : (
                      <p className="text-slate-400 text-sm text-center py-4">Không có dữ liệu lịch trình</p>
                    )}
                  </div>
                </div>

                {/* AI Proposed */}
                <div className="bg-white border-2 border-blue-200 rounded-xl overflow-hidden ring-4 ring-blue-100">
                  <div className="bg-blue-600 p-4 border-b border-blue-600 font-bold text-white uppercase tracking-widest text-xs flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Đề xuất mới từ AI
                  </div>
                  <div className="p-6 space-y-4">
                    {proposedSlots.length > 0 ? proposedSlots.map((slot, i) => (
                      <div key={i} className="flex items-center gap-4">
                        <div className="w-14 text-sm font-bold text-blue-600 shrink-0">
                          {slot.plannedStart ? format(parseISO(slot.plannedStart), 'HH:mm') : '--:--'}
                        </div>
                        <div 
                          className={`p-3 bg-blue-50 border-2 text-blue-900 rounded-lg flex-1 font-bold text-sm flex items-center justify-between transition-all cursor-pointer ${focusedSlotId === slot.slotId ? 'border-blue-500 ring-2 ring-blue-200' : 'border-blue-300 hover:border-blue-400'}`}
                          onClick={() => setFocusedSlotId(slot.slotId)}
                        >
                          <span>{placeNameMap.get(slot.placeId) ?? `Địa điểm đề xuất ${i + 1}`}</span>
                          <button 
                            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] rounded uppercase transition-colors shadow-sm active:scale-95"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusedSlotId(slot.slotId);
                            }}
                          >
                            Thay thế
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="space-y-4">
                        <p className="text-slate-400 text-sm text-center py-2">
                          {isReplanning ? 'Đang tạo đề xuất...' : 'AI đang phân tích lộ trình tối ưu cho bạn'}
                        </p>
                        {originalSlots.slice(1).map((slot, i) => (
                          <div key={slot.slotId} className="flex items-center gap-4">
                            <div className="w-14 text-sm font-bold text-slate-600 shrink-0">
                              {format(parseISO(slot.plannedStart), 'HH:mm')}
                            </div>
                            <div className="p-3 bg-white border-2 border-slate-100 rounded-lg flex-1 font-bold text-sm">
                              {slot.place?.name ?? `Địa điểm ${i + 2}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Action Items */}
            <section className="space-y-4">
              <h4 className="text-xl font-bold text-slate-900">Hành động đề xuất</h4>
              <div className="space-y-3">
                {hasIncident && (
                  <div className="bg-white p-6 border-2 border-slate-100 rounded-xl flex items-center gap-6">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                      <Ban className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-xs text-slate-500 uppercase tracking-wider">Bỏ qua</p>
                      <p className="font-bold text-slate-900">{originalSlots[0]?.place?.name ?? 'Địa điểm bị ảnh hưởng'} (Bị ảnh hưởng)</p>
                    </div>
                  </div>
                )}
                <div className="bg-white p-6 border-2 border-blue-200 rounded-xl flex items-center gap-6">
                  <div className="w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
                    <Coffee className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-blue-600 uppercase tracking-wider">Thay thế (Trong nhà)</p>
                    <p className="font-bold text-slate-900">Địa điểm trong nhà gần đó</p>
                  </div>
                  <CheckCircle className="w-5 h-5 text-blue-600 shrink-0" />
                </div>
                <div className="bg-white p-6 border-2 border-teal-200 rounded-xl flex items-center gap-6">
                  <div className="w-12 h-12 rounded-lg bg-teal-600 flex items-center justify-center text-white shrink-0">
                    <PlusCircle className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-teal-600 uppercase tracking-wider">Thêm vào</p>
                    <p className="font-bold text-slate-900">Hoạt động bổ sung sau khi tình huống được giải quyết</p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right: Map + Actions */}
          <div className="lg:col-span-4 space-y-6">
            {/* Map */}
            <div className="bg-white border-2 border-slate-100 rounded-xl overflow-hidden shadow-sm flex flex-col">
              <div className="relative h-80 w-full bg-slate-100">
                <TripMap 
                  slots={slots}
                  pendingSlots={proposedSlots.length > 0 ? (proposedSlots as any) : null}
                  focusedSlotId={focusedSlotId}
                  className="w-full h-full"
                />
                <div className="absolute bottom-4 right-4 bg-white px-3 py-1.5 rounded-full shadow-lg border border-slate-200 flex items-center gap-2 z-[1000]">
                  <span className="w-3 h-3 rounded-full bg-blue-600" />
                  <span className="text-xs font-bold">Lộ trình mới</span>
                </div>
              </div>
              <div className="p-4">
                <h5 className="font-bold text-slate-500 uppercase text-xs mb-2">Lộ trình thay đổi</h5>
                <p className="text-sm text-slate-600">Quãng đường điều chỉnh nhưng vẫn đảm bảo an toàn và tối ưu thời gian.</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-4">
              <button
                onClick={handleAccept}
                disabled={accept.isPending || !proposal}
                className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 text-base"
              >
                {accept.isPending ? 'Đang áp dụng...' : 'Chấp nhận thay đổi'}
              </button>
              <button
                onClick={() => navigate(`/trip/${tripId}`)}
                className="w-full py-4 bg-white text-slate-900 font-bold rounded-xl border-2 border-slate-200 hover:border-blue-300 transition-colors text-base"
              >
                Tự điều chỉnh
              </button>
              <button
                onClick={handleReject}
                disabled={reject.isPending}
                className="w-full py-4 bg-slate-100 text-slate-500 font-bold rounded-xl border-2 border-transparent hover:bg-slate-200 transition-colors text-sm disabled:opacity-50"
              >
                Giữ nguyên lịch trình
              </button>
            </div>

            {/* Tip */}
            <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
              <div className="flex items-center gap-2 text-blue-700 font-bold mb-2">
                <Lightbulb className="w-5 h-5" />
                <span>Mẹo du lịch</span>
              </div>
              <p className="text-sm text-blue-700/80">
                Các địa điểm trong nhà có thể là lựa chọn tuyệt vời để tránh thời tiết xấu và khám phá văn hóa địa phương sâu hơn.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Nav - Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center bg-white border-t-2 border-slate-100 px-4 pb-safe z-50">
        <button onClick={() => navigate('/')} className="flex flex-col items-center text-blue-600 border-t-4 border-blue-600 pt-2 pb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest mt-1">Explore</span>
        </button>
        <button onClick={() => navigate('/trips')} className="flex flex-col items-center text-slate-400 pt-2 pb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest mt-1">My Trips</span>
        </button>
        <button onClick={() => navigate('/profile')} className="flex flex-col items-center text-slate-400 pt-2 pb-1">
          <span className="text-[11px] font-bold uppercase tracking-widest mt-1">Profile</span>
        </button>
      </nav>
      <div className="h-20 md:hidden" />
    </div>
  )
}
