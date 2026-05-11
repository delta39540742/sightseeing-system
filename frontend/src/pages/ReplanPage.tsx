import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, CloudLightning, X, Sparkles, Check,
  Utensils, Coffee, MapPin, Star, Navigation, CheckCircle2, SlidersHorizontal, ChevronRight
} from 'lucide-react'
import { tripService } from '@/services/tripService'
import { monitorService } from '@/services/monitorService'
import { useReplanProposal } from '@/components/replan/useReplanProposal'
import { useTripStore } from '@/store/tripStore'
import { PageSpinner } from '@/components/ui/Spinner'
import { TripMap } from '@/components/map/TripMap'
import { toast } from '@/store/toastStore'
import { format, parseISO, differenceInMinutes } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Place } from '@/types'
import './ReplanRedesign.css'


export default function ReplanPage() {
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null)
  const [showIncident, setShowIncident] = useState(true)
  // Tập hợp các index (trong changeableItems) mà user đã chọn để áp dụng
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())

  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { setTrip, trip } = useTripStore()

  const [isFullScreenMap, setIsFullScreenMap] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

  const { data: incidentData, isLoading: isIncidentLoading } = useQuery({
    queryKey: ['check-incident', tripId],
    queryFn: () => monitorService.checkIncident(tripId),
    enabled: !!tripId,
  })

  const triggeredByEventId = useMemo(() => {
    const fromState = (location.state as { triggeredByEventId?: string })?.triggeredByEventId
    if (fromState) return fromState
    return (incidentData as { eventId?: string } | undefined)?.eventId
  }, [location.state, incidentData])

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

  // Collect all placeIds from both snapshots to detect which ones are missing from cityPlaces
  const missingPlaceIds = useMemo(() => {
    if (!proposal) return []
    const allIds = new Set<number>()
    proposal.oldPlanSnapshot.forEach(s => allIds.add(s.placeId))
    proposal.newPlanSnapshot.forEach(s => allIds.add(s.placeId))
    const knownIds = new Set<number>()
    ;(cityPlaces ?? []).forEach(p => knownIds.add(p.placeId))
    return [...allIds].filter(id => !knownIds.has(id))
  }, [proposal, cityPlaces])

  const { data: extraPlaces } = useQuery({
    queryKey: ['places-batch', missingPlaceIds],
    queryFn: () =>
      tripService.listPlaces({ ids: missingPlaceIds }),
    enabled: missingPlaceIds.length > 0,
  })

  const replanFiredForRef = useRef<string | null>(null)
  const currentLocationRef = useRef<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      },
      () => {},
      { timeout: 5000, maximumAge: 60_000 },
    )
  }, [])

  const { mutate: triggerReplan } = useMutation({
    mutationFn: () =>
      tripService.replan(
        tripId!,
        'remaining_trip',
        triggeredByEventId,
        currentLocationRef.current ?? undefined,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['replan-pending', tripId] })
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status !== 409) toast.error('Không thể tạo đề xuất. Thử lại sau.')
    },
  })

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

  useEffect(() => {
    if (!tripId || proposalLoading || isIncidentLoading) return;
    const currentEventId = (incidentData as { eventId?: string } | undefined)?.eventId ?? null;
    const needsFire = !proposal
      ? replanFiredForRef.current !== currentEventId
      : !!(currentEventId && proposal.triggeredByEventId !== currentEventId && replanFiredForRef.current !== currentEventId);
    if (needsFire) {
      replanFiredForRef.current = currentEventId;
      triggerReplan();
    }
  }, [tripId, proposal, proposalLoading, isIncidentLoading, incidentData])

  const slots = trip?.slots ?? []
  const oldPlanSlots = useMemo(() => proposal?.oldPlanSnapshot ?? [], [proposal?.oldPlanSnapshot])

  const placesMap = useMemo(() => {
    const map = new Map<number, Place>()
    slots.forEach(s => { if (s.place) map.set(s.placeId, s.place) })
    cityPlaces?.forEach(p => { map.set(p.placeId, p) })
    extraPlaces?.forEach(p => { map.set(p.placeId, p) })
    return map
  }, [slots, cityPlaces, extraPlaces])

  const enrichedOldPlanSlots = useMemo(
    () => oldPlanSlots.map(s => ({ ...s, place: placesMap.get(s.placeId) })),
    [oldPlanSlots, placesMap],
  )

  const proposedSlots = useMemo(
    () => (proposal?.newPlanSnapshot ?? []).map(slot => ({
      ...slot,
      place: placesMap.get(slot.placeId),
    })),
    [proposal?.newPlanSnapshot, placesMap],
  )

  const hasIncident = !!(incidentData && 'type' in incidentData && incidentData.type)
  const incidentReason = hasIncident && 'reason' in incidentData ? incidentData.reason : null

  // Danh sách tất cả thay đổi (không phải UNCHANGED) — index dùng làm key cho selectedItems
  const comparison = useMemo(() => {
    const results: Array<{
      type: 'REPLACED' | 'NEW' | 'UNCHANGED' | 'REMOVED' | 'REORDER'
      original?: any
      proposed?: any
      time: string
    }> = []

    const processedPropIds = new Set<string>()
    const processedOrigIds = new Set<string>()

    enrichedOldPlanSlots.forEach(orig => {
      const prop = proposedSlots.find(p => p.slotId === orig.slotId)
      if (prop) {
        const isTimeShifted = orig.plannedStart !== prop.plannedStart
        results.push({
          type: orig.placeId === prop.placeId ? (isTimeShifted ? 'REORDER' : 'UNCHANGED') : 'REPLACED',
          original: orig,
          proposed: prop,
          time: prop.plannedStart,
        })
        processedPropIds.add(prop.slotId)
        processedOrigIds.add(orig.slotId)
      }
    })

    enrichedOldPlanSlots.filter(orig => !processedOrigIds.has(orig.slotId)).forEach(orig => {
      const prop = proposedSlots.find(p => {
        if (processedPropIds.has(p.slotId)) return false
        if (!p.placeId) return false
        return p.dayIndex === orig.dayIndex && p.slotOrder === orig.slotOrder
      })
      if (prop) {
        const isTimeShifted = orig.plannedStart !== prop.plannedStart
        results.push({
          type: orig.placeId === prop.placeId ? (isTimeShifted ? 'REORDER' : 'UNCHANGED') : 'REPLACED',
          original: orig,
          proposed: prop,
          time: prop.plannedStart,
        })
        processedPropIds.add(prop.slotId)
      } else {
        results.push({ type: 'REMOVED', original: orig, time: orig.plannedStart })
      }
      processedOrigIds.add(orig.slotId)
    })

    proposedSlots
      .filter(p => !processedPropIds.has(p.slotId) && p.placeId > 0)
      .forEach(p => results.push({ type: 'NEW', proposed: p, time: p.plannedStart }))

    return results.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  }, [proposedSlots, enrichedOldPlanSlots])

  // Chỉ các thay đổi thực sự (không UNCHANGED) — index của mảng này khớp với selectedItems
  const changeableItems = useMemo(
    () => comparison.filter(item => item.type !== 'UNCHANGED'),
    [comparison],
  )

  // Reset selection khi proposal thay đổi
  useEffect(() => {
    setSelectedItems(new Set())
  }, [proposal?.proposalId])

  const toggleItem = (i: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  // Map: slotId -> phút di chuyển đến slot tiếp theo (cùng ngày)
  const travelTimeMap = useMemo(() => {
    const sorted = [...proposedSlots].sort(
      (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime(),
    )
    const map = new Map<string, number>()
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].dayIndex !== sorted[i + 1].dayIndex) continue
      const gap = differenceInMinutes(
        parseISO(sorted[i + 1].plannedStart),
        parseISO(sorted[i].plannedEnd),
      )
      if (gap > 0) map.set(sorted[i].slotId, gap)
    }
    return map
  }, [proposedSlots])

  const stats = useMemo(() => {
    if (!proposal) return { timeSaved: 0, changes: 0, newPlaces: 0 }
    const calculateTravelTime = (s: any[]) => {
      let total = 0
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i].dayIndex === s[i + 1].dayIndex)
          total += differenceInMinutes(parseISO(s[i + 1].plannedStart), parseISO(s[i].plannedEnd))
      }
      return total
    }
    const timeSaved = Math.max(0, calculateTravelTime(enrichedOldPlanSlots) - calculateTravelTime(proposedSlots))
    const changes = changeableItems.filter(c => c.type !== 'UNCHANGED').length
    const newPlaces = changeableItems.filter(c => c.type === 'NEW' || (c.type === 'REPLACED' && c.proposed?.placeId !== c.original?.placeId)).length
    return { timeSaved, changes, newPlaces }
  }, [proposal, enrichedOldPlanSlots, proposedSlots, changeableItems])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAcceptAll = async () => {
    if (!proposal) return
    try {
      await accept.mutateAsync({ proposalId: proposal.proposalId })
      // Explicitly fetch fresh trip data and sync cache + store before navigating,
      // so TripTracking gets the new itinerar gh the Zustand store.
      const freshTrip = await tripService.get(tripId!)
      queryClient.setQueryData(['trip', tripId], freshTrip)
      setTrip(freshTrip)
      queryClient.invalidateQueries({ queryKey: ['check-incident', tripId] })
      toast.success('Đã áp dụng toàn bộ lịch trình mới!')
      navigate(`/trip/${tripId}/live`)
    } catch {
      toast.error('Không thể áp dụng. Thử lại sau.')
    }
  }

  const handleApplySelected = async () => {
    if (!proposal || selectedItems.size === 0) return
    // Lấy slotId của các slot đề xuất được chọn (chỉ các item có proposed)
    const selectedNewSlotIds = [...selectedItems]
      .map(i => changeableItems[i]?.proposed?.slotId)
      .filter((id): id is string => !!id)
    try {
      await accept.mutateAsync({ proposalId: proposal.proposalId, partialNewSlotIds: selectedNewSlotIds })
      const freshTrip = await tripService.get(tripId!)
      queryClient.setQueryData(['trip', tripId], freshTrip)
      setTrip(freshTrip)
      queryClient.invalidateQueries({ queryKey: ['check-incident', tripId] })
      toast.success(`Đã áp dụng ${selectedItems.size} thay đổi đã chọn!`)
      navigate(`/trip/${tripId}/live`)
    } catch {
      toast.error('Không thể áp dụng. Thử lại sau.')
    }
  }

  const handleReject = async () => {
    if (!proposal) return
    try {
      await reject.mutateAsync({ proposalId: proposal.proposalId, reason: 'user_rejected' })
      toast.info('Đã từ chối đề xuất')
      navigate(-1)
    } catch {
      toast.error('Không thể từ chối. Thử lại sau.')
    }
  }

  const selectedCount = selectedItems.size
  const totalChanges = changeableItems.length
  const isAllSelected = totalChanges > 0 && selectedCount === totalChanges

  if (isLoading || proposalLoading) return <PageSpinner />

  return (
    <div className="replan-container font-sans text-slate-900">
      {/* Header */}
      <header className="replan-header sticky top-0 z-50">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex flex-col items-center">
          <span className="replan-logo">HORIZON</span>
        </div>
        <div className="ai-optimized-tag">AI OPTIMIZED</div>
      </header>

      <main className="max-w-2xl mx-auto">
        {/* Incident Banner */}
        {hasIncident && showIncident && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 p-4 rounded-2xl flex items-center gap-3">
            <CloudLightning className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-red-800 text-xs font-medium flex-1">
              {incidentReason ?? 'Phát hiện sự cố. Đã tối ưu lộ trình thay thế.'}
            </p>
            <button onClick={() => setShowIncident(false)} className="text-red-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Summary Card */}
        <div className="replan-card replan-summary-card">
          <h1 className="replan-title">Lịch trình đã được tối ưu</h1>
          <p className="replan-subtitle">
            {stats.timeSaved > 0
              ? `Giảm ${stats.timeSaved} phút di chuyển và tránh khu vực đông vào buổi sáng.`
              : 'Lộ trình được điều chỉnh để đảm bảo tính khả thi và thoải mái nhất.'}
          </p>

          <div className="badge-group">
            <div className="badge badge-green">
              <Navigation className="w-3.5 h-3.5" />
              <span>-{stats.timeSaved} phút di chuyển</span>
            </div>
            <div className="badge badge-purple">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{stats.changes} thay đổi đề xuất</span>
            </div>
            <div className="badge badge-pink">
              <MapPin className="w-3.5 h-3.5" />
              <span>{stats.newPlaces} địa điểm mới</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="primary-btn flex-1"
              onClick={() => {
                const el = document.getElementById('first-change');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Xem thay đổi
            </button>
            {totalChanges > 0 && (
              <button
                className="select-all-btn"
                onClick={() => {
                  if (isAllSelected) setSelectedItems(new Set())
                  else setSelectedItems(new Set(changeableItems.map((_, i) => i)))
                }}
              >
                {isAllSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </button>
            )}
          </div>
        </div>

        {/* Map Overview — shown before the changes list */}
        <div className="replan-card map-preview-card overflow-hidden mx-4 mt-4">
          <div className="relative h-full w-full bg-slate-100">
            <TripMap
              slots={enrichedOldPlanSlots.length > 0 ? (enrichedOldPlanSlots as any) : slots}
              pendingSlots={proposedSlots.length > 0 ? (proposedSlots as any) : null}
              focusedSlotId={focusedSlotId}
              onMarkerClick={setFocusedSlotId}
              isFullScreen={isFullScreenMap}
              toggleFullScreen={() => setIsFullScreenMap(!isFullScreenMap)}
              className="w-full h-full"
            />
          </div>
        </div>
        <p className="map-caption">Lộ trình mới giúp giảm thời gian di chuyển và tránh khu vực đông.</p>

        {/* Changes Feed */}
        <div className="px-1">
          {changeableItems.map((item, i) => {
            const isReplace = item.type === 'REPLACED';
            const isAdd = item.type === 'NEW';
            const isReorder = item.type === 'REORDER';
            const isSelected = selectedItems.has(i)

            const slot = item.proposed || item.original;
            const activityType = slot?.activityType || 'sightseeing';

            let Icon = MapPin;
            if (activityType === 'meal') Icon = Utensils;
            if (activityType === 'rest') Icon = Coffee;

            return (
              <div
                key={slot?.slotId || i}
                id={i === 0 ? 'first-change' : undefined}
                className={`replan-card timeline-card ${isReplace ? 'replace' : isAdd ? 'add' : ''} ${isSelected ? 'selected' : ''}`}
              >
                {/* Selection badge */}
                {isSelected && (
                  <div className="selection-badge">
                    <Check className="w-3 h-3" />
                    <span>Đã chọn</span>
                  </div>
                )}

                <div className="card-header">
                  <div className="flex items-center">
                    <div className={`icon-box ${isReplace ? 'icon-box-red' : isAdd ? 'icon-box-green' : 'icon-box-blue'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      {isReplace && item.original && (
                        <div className="old-place-name">{item.original.place?.name || 'Địa điểm cũ'}</div>
                      )}
                      <h3 className="place-name">
                        {item.proposed?.place?.name || (activityType === 'meal' ? 'Địa điểm ăn uống' : 'Điểm nghỉ chân')}
                      </h3>
                      <div className="time-row">
                        {isReorder && item.original && (
                          <>
                            <span className="line-through">
                              Ngày {(item.original.dayIndex ?? 0) + 1}, {format(parseISO(item.original.plannedStart), 'HH:mm')}
                            </span>
                            <ChevronRight className="w-3 h-3" />
                          </>
                        )}
                        <span className="time-change">
                          Ngày {(slot.dayIndex ?? 0) + 1}, {format(parseISO(slot.plannedStart), 'HH:mm')}
                        </span>
                        {item.proposed?.place?.indoorOutdoor === 'outdoor' && (
                          <span className="ml-2 flex items-center gap-1">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            <span>4.8</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="status-label">
                    {isReplace ? 'REPLACE' : isAdd ? 'ADD' : 'REORDER'}
                  </div>
                </div>

                {/* AI Insight */}
                <div className="ai-insight">
                  <Sparkles className={`w-5 h-5 shrink-0 ${isReplace ? 'text-red-500' : isAdd ? 'text-green-500' : 'text-blue-500'}`} />
                  <p className="ai-insight-text">
                    "{item.proposed?.rationale || (isReplace ? 'Địa điểm mới gần tuyến đường hơn và phù hợp thời điểm hiện tại.' : isAdd ? 'Điểm nghỉ được thêm giữa 2 tuyến di chuyển dài.' : 'Di chuyển sớm để tránh đông khách và tối ưu thời gian.')}"
                  </p>
                </div>

                {/* Travel time to next stop */}
                {item.proposed?.slotId && travelTimeMap.has(item.proposed.slotId) && (
                  <div className="travel-time-row">
                    <Navigation className="w-3.5 h-3.5" />
                    <span>~{travelTimeMap.get(item.proposed.slotId)} phút đến điểm tiếp theo</span>
                  </div>
                )}

                {/* Card Actions */}
                <div className="card-actions">
                  <button
                    className={`btn-accept ${isReplace ? 'btn-accept-replace' : isAdd ? 'btn-accept-add' : ''} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      toggleItem(i)
                      // Focus trên bản đồ khi chọn
                      if (!isSelected && slot?.slotId) setFocusedSlotId(slot.slotId)
                    }}
                  >
                    <span className="btn-accept-inner">
                      {isSelected
                        ? <><Check className="w-4 h-4" />{isReplace ? 'Đã chọn thay thế' : isAdd ? 'Đã thêm vào lịch' : 'Đã chọn'}</>
                        : <>{isReplace ? 'Chọn thay thế' : isAdd ? 'Thêm vào lịch' : 'Chọn'}</>
                      }
                    </span>
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      if (isSelected) toggleItem(i) // bỏ chọn nếu đang chọn
                    }}
                  >
                    {isAdd ? 'Bỏ qua' : 'Giữ lịch cũ'}
                  </button>
                </div>
              </div>
            );
          })}

        </div>
      </main>

      {/* Bottom Bar */}
      <div className="bottom-bar">
        {selectedCount > 0 && !isAllSelected ? (
          // Có một số thay đổi được chọn (partial)
          <>
            <button
              className="accept-all-btn"
              onClick={handleApplySelected}
              disabled={accept.isPending}
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {accept.isPending
                  ? 'Đang áp dụng...'
                  : `Áp dụng ${selectedCount} thay đổi đã chọn`}
              </span>
            </button>
            <button
              className="reject-btn"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              <X className="w-5 h-5" />
              <span>Từ chối</span>
            </button>
          </>
        ) : (
          // Chưa chọn gì hoặc chọn tất cả → accept all
          <>
            <button
              className="accept-all-btn"
              onClick={handleAcceptAll}
              disabled={accept.isPending || !proposal}
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>
                {accept.isPending
                  ? 'Đang áp dụng...'
                  : isAllSelected
                    ? `Chấp nhận tất cả (${totalChanges})`
                    : 'Chấp nhận tất cả'}
              </span>
            </button>
            <button
              className="manual-edit-btn"
              onClick={() => navigate(`/trip/${tripId}`)}
            >
              <SlidersHorizontal className="w-5 h-5" />
              <span>Chỉnh sửa</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
