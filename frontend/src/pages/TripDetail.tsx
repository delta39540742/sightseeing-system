import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Map as MapIcon, List, Share2, Play, QrCode, Camera, RefreshCw, Plus, Activity, Lock, LockOpen } from 'lucide-react'
import type { TripSlot, Place } from '@/types'
import { tripService } from '@/services/tripService'
import { monitorService } from '@/services/monitorService'
import type { MonitorAlert } from '@/services/monitorService'
import { useTripStore } from '@/store/tripStore'
import { TripMap } from '@/components/map/TripMap'
import { Timeline } from '@/components/timeline/Timeline'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { LandmarkRecognizer } from '@/components/landmark/LandmarkRecognizer'
import { ReplanModal } from '@/components/replan/ReplanModal'
import { PlaceSearchBar } from '@/components/planning/PlaceSearchBar'
import { ConflictBanner } from '@/components/timeline/ConflictBanner'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from '@/store/toastStore'
import { format, parseISO, isBefore } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { ReplanScope } from '@/types'
import type { Place as ReplanPlace } from '@/components/replan/types'

type MobileTab = 'map' | 'list'

export default function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setTrip, trip, pendingSlots, focusedSlotId, setFocus } = useTripStore()
  const [mobileTab, setMobileTab] = useState<MobileTab>('list')
  const [shareModal, setShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [qrModal, setQrModal] = useState(false)
  const [landmarkSheet, setLandmarkSheet] = useState(false)
  const [replanModal, setReplanModal] = useState(false)
  const [replanScopeSheet, setReplanScopeSheet] = useState(false)
  const [isReplanning, setIsReplanning] = useState(false)
  const [addPlaceSheet, setAddPlaceSheet] = useState(false)
  const [addSlotDay, setAddSlotDay] = useState<number | undefined>(undefined)
  const [preferredPlace, setPreferredPlace] = useState<Place | null>(null)
  const [dismissedIncidentId, setDismissedIncidentId] = useState<string | null>(null)
  const [lockSheet, setLockSheet] = useState(false)
  const [lockingSlot, setLockingSlot] = useState<TripSlot | null>(null)
  const [lockTime, setLockTime] = useState('')
  const [dayStartSheet, setDayStartSheet] = useState(false)
  const [dayStartDayIdx, setDayStartDayIdx] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

const { data: incidentData } = useQuery<MonitorAlert | { status: string }>({
    queryKey: ['check-incident', tripId],
    queryFn: () => monitorService.checkIncident(tripId),
    refetchInterval: 30_000,
    enabled: !!tripId,
  })

  const { mutate: addSlot, isPending: isAddingSlot } = useMutation({
    mutationFn: ({ placeId, dayIndex }: { placeId: number; dayIndex?: number }) =>
      tripService.addSlot(tripId!, placeId, dayIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã thêm địa điểm vào lịch trình')
      setAddPlaceSheet(false)
      setAddSlotDay(undefined)
    },
    onError: () => toast.error('Không thể thêm địa điểm, thử lại sau'),
  })

  const handleOpenAddSlot = (dayIndex?: number) => {
    setAddSlotDay(dayIndex)
    setAddPlaceSheet(true)
  }

  const { mutate: doLockSlot, isPending: isLocking } = useMutation({
    mutationFn: ({ slotId, plannedStart }: { slotId: string; plannedStart: string }) =>
      tripService.lockSlot(tripId!, slotId, plannedStart),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã cố định giờ cho slot')
      setLockSheet(false)
      setLockingSlot(null)
    },
    onError: () => toast.error('Không thể cố định giờ, thử lại sau'),
  })

  const { mutate: doUnlockSlot, isPending: isUnlocking } = useMutation({
    mutationFn: (slotId: string) => tripService.unlockSlot(tripId!, slotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã bỏ cố định giờ')
      setLockSheet(false)
      setLockingSlot(null)
    },
    onError: () => toast.error('Không thể bỏ cố định giờ, thử lại sau'),
  })

  const { mutate: doSetDayStart, isPending: isSettingDayStart } = useMutation({
    mutationFn: (args: { dayIndex: number; lat: number; lng: number; name: string }) =>
      tripService.setDayStart(tripId!, args.dayIndex, { lat: args.lat, lng: args.lng, name: args.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã cập nhật điểm bắt đầu và sắp xếp lại ngày')
      setDayStartSheet(false)
      setDayStartDayIdx(null)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } } }
      if (e?.response?.status === 409) {
        toast.error(e.response.data?.message ?? 'Không thể đổi điểm bắt đầu')
      } else {
        toast.error('Không thể đổi điểm bắt đầu, thử lại sau')
      }
    },
  })

  const { mutate: doClearDayStart } = useMutation({
    mutationFn: (dayIndex: number) => tripService.clearDayStart(tripId!, dayIndex),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã xoá điểm bắt đầu')
    },
    onError: () => toast.error('Không thể xoá, thử lại sau'),
  })

  const openDayStartSheet = (dayIndex: number) => {
    setDayStartDayIdx(dayIndex)
    setDayStartSheet(true)
  }

  const handleLockToggle = (slot: TripSlot) => {
    setLockingSlot(slot)
    if (!slot.isLocked) {
      // Pre-fill time picker with current plannedStart (local HH:mm)
      try {
        const d = new Date(slot.plannedStart)
        const hh = String(d.getHours()).padStart(2, '0')
        const mm = String(d.getMinutes()).padStart(2, '0')
        setLockTime(`${hh}:${mm}`)
      } catch { setLockTime('08:00') }
    }
    setLockSheet(true)
  }

  const handleConfirmLock = () => {
    if (!lockingSlot || !lockTime) return
    // Build ISO datetime: take date part from plannedStart, combine with lockTime
    const baseDate = new Date(lockingSlot.plannedStart)
    const [hh, mm] = lockTime.split(':').map(Number)
    baseDate.setHours(hh, mm, 0, 0)
    doLockSlot({ slotId: lockingSlot.slotId, plannedStart: baseDate.toISOString() })
  }

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

  useEffect(() => {
    if (!data || (data.status !== 'active' && data.status !== 'confirmed')) return

    const today = new Date().getDay()
    const nowMs = Date.now()

    const sorted = [...data.slots].sort(
      (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime(),
    )

    let currentIdx = sorted.findIndex((s) => {
      const start = new Date(s.plannedStart).getTime()
      const end = new Date(s.plannedEnd).getTime()
      return nowMs >= start && nowMs <= end
    })
    if (currentIdx < 0) {
      currentIdx = sorted.findIndex((s) => new Date(s.plannedStart).getTime() > nowMs)
    }
    const resolvedIdx = Math.max(0, currentIdx)

    const tripData = {
      tripId: data.tripId,
      slots: sorted.map((s) => {
        const todayHours = s.place?.openingHours.find((h) => h.dayOfWeek === today)
        const closeHour = todayHours ? parseInt(todayHours.closeTime.split(':')[0], 10) : 22
        return {
          id: s.slotId,
          name: s.place?.name ?? s.slotId,
          type: (s.place?.indoorOutdoor === 'outdoor' ? 'outdoor' : 'indoor') as 'outdoor' | 'indoor',
          closeTime: closeHour,
        }
      }),
    }

    const state = {
      currentSlotIndex: resolvedIdx,
      plannedArrivalTime: sorted[resolvedIdx]
        ? new Date(sorted[resolvedIdx].plannedStart).getHours()
        : new Date().getHours(),
    }

    const doSync = (location?: { lat: number; lon: number }) =>
      monitorService.syncTrip(tripData, state, location).catch(() => {})

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => doSync({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => doSync(),
        { timeout: 5000 },
      )
    } else {
      doSync()
    }
  }, [data?.tripId, data?.status])

  // Build placesMap for ReplanModal
  const placesMap = useMemo(() => {
    const map = new Map<number, ReplanPlace>()
    trip?.slots.forEach((s) => {
      if (s.place) {
        map.set(s.place.placeId, {
          placeId: s.place.placeId,
          name: s.place.name,
          lat: s.place.lat,
          lng: s.place.lng,
        } as ReplanPlace)
      }
    })
    return map
  }, [trip])

  const handleReplan = async (scope: ReplanScope) => {
    if (!tripId) return
    setReplanScopeSheet(false)
    setIsReplanning(true)
    const placeIdToForce = preferredPlace?.placeId
    setPreferredPlace(null)
    try {
      const triggeredByEventId = incidentData && 'eventId' in incidentData ? incidentData.eventId : undefined
      await tripService.replan(tripId, scope, triggeredByEventId, undefined, placeIdToForce)
      setReplanModal(true)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        // Proposal đang pending — mở thẳng modal
        setReplanModal(true)
      } else {
        toast.error('Không thể tạo đề xuất. Thử lại sau.')
      }
    } finally {
      setIsReplanning(false)
    }
  }

  if (isLoading) return <PageSpinner />
  if (error || !trip) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <p className="text-gray-500">Không tìm thấy chuyến đi</p>
      <button onClick={() => navigate('/')} className="btn-secondary">Về trang chủ</button>
    </div>
  )

  const slots = pendingSlots ?? trip.slots
  const conflictCount = slots.filter((s) => s.conflict).length

  // Gate banner: chỉ hiện khi sự cố thực sự ảnh hưởng đến slot đang/sắp diễn ra.
  // Một số nguồn (script pump-rain) ghi affected_slot_ids = toàn bộ planned slot,
  // không lọc indoor/outdoor → phải lọc lại ở client theo event type.
  const incidentAffectsActiveSlots = (() => {
    if (!incidentData || !('type' in incidentData) || !incidentData.type) return false
    const ids = (incidentData as MonitorAlert).affectedSlotIds ?? []
    if (ids.length === 0) return false
    const eventType = incidentData.type
    const expiresAt = (incidentData as MonitorAlert).expiresAt
      ? new Date((incidentData as MonitorAlert).expiresAt!)
      : null
    const nowDate = new Date()
    return ids.some((id) => {
      const slot = trip.slots.find((s) => s.slotId === id)
      if (!slot) return false
      if (slot.status === 'completed' || slot.status === 'skipped') return false
      // Rain chỉ ảnh hưởng outdoor (mixed coi như có rủi ro). Indoor → bỏ qua.
      if (eventType === 'rain_heavy') {
        const io = slot.place?.indoorOutdoor
        if (io === 'indoor') return false
      }
      const slotStart = parseISO(slot.plannedStart)
      const withinWindow = !expiresAt || isBefore(slotStart, expiresAt)
      return withinWindow && !isBefore(parseISO(slot.plannedEnd), nowDate)
    })
  })()

  const handleGoogleMaps = () => {
    const waypoints = slots
      .filter((s) => s.place)
      .map((s) => `${s.place!.lat},${s.place!.lng}`)
      .join('|')
    const url = `https://www.google.com/maps/dir/?api=1&waypoints=${waypoints}&travelmode=driving`
    window.open(url, '_blank', 'noopener')
  }

  const handleShare = async () => {
    try {
      const res = await tripService.share(trip.tripId, 7)
      setShareUrl(res.shareUrl)
      setShareModal(true)
    } catch {
      const localUrl = `${window.location.origin}/trip/${trip.tripId}`
      setShareUrl(localUrl)
      setShareModal(true)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl)
    toast.success('Đã sao chép link')
  }

  const tripUrl = `${window.location.origin}/trip/${trip.tripId}`

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0 z-10">
        <button onClick={() => navigate('/')} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 truncate">
            {trip.title ?? trip.destinationCity}
          </h1>
          <p className="text-xs text-gray-400">
            {format(parseISO(trip.startDate), 'dd MMM', { locale: vi })}
            {' – '}
            {format(parseISO(trip.endDate), 'dd MMM yyyy', { locale: vi })}
            {conflictCount > 0 && (
              <span className="ml-2 text-red-500 font-medium">{conflictCount} xung đột</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => setLandmarkSheet(true)} aria-label="Nhận diện địa điểm" className="p-2 hover:bg-gray-100 rounded-lg" title="Nhận diện từ ảnh">
            <Camera className="w-5 h-5 text-gray-500" />
          </button>
          <button onClick={() => setQrModal(true)} aria-label="QR Sync" className="p-2 hover:bg-gray-100 rounded-lg" title="QR Sync">
            <QrCode className="w-5 h-5 text-gray-500" />
          </button>
          <button onClick={handleShare} aria-label="Chia sẻ" className="p-2 hover:bg-gray-100 rounded-lg">
            <Share2 className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Mobile tabs */}
        <div className="flex md:hidden bg-gray-100 rounded-lg p-1 gap-1 ml-1">
          <button
            onClick={() => setMobileTab('map')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'map' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <MapIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setMobileTab('list')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'list' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full flex">
          {/* Timeline (left on desktop) */}
          <div className={`w-full md:w-[380px] md:flex flex-col h-full bg-white border-r border-gray-100 ${mobileTab === 'list' ? 'flex' : 'hidden'}`}>
            {incidentAffectsActiveSlots && incidentData && 'type' in incidentData && incidentData.type && (
              (() => {
                const eventId = 'eventId' in incidentData ? incidentData.eventId : (incidentData as any).timestamp;
                if (dismissedIncidentId === eventId) return null;

                return (
                  <div className="pt-3">
                    <ConflictBanner
                      conflict={{
                        type: 'time',
                        message: ('reason' in incidentData ? incidentData.reason : null) || 'Cảnh báo hệ thống',
                        cause: incidentData.type,
                        suggestion: 'Lộ trình có thể không tối ưu do thay đổi ngoại cảnh.',
                      }}
                      onViewProposal={() => navigate(`/trip/${tripId}/replan`, { 
                        state: { triggeredByEventId: 'eventId' in incidentData ? incidentData.eventId : undefined } 
                      })}
                      onDismiss={() => setDismissedIncidentId(eventId)}
                    />
                  </div>
                );
              })()
            )}
            <Timeline
              onAddSlot={handleOpenAddSlot}
              onLockToggle={handleLockToggle}
              onEditDayStart={openDayStartSheet}
              onClearDayStart={(d) => doClearDayStart(d)}
            />

            {/* Bottom action bar */}
            <div className="border-t border-gray-100 p-3 shrink-0 space-y-2">
              {trip.status === 'active' && (
                <button
                  onClick={() => navigate(`/trip/${tripId}/live`)}
                  className="btn-secondary w-full py-2 text-sm flex items-center justify-center gap-2 border-green-200 text-green-700 hover:bg-green-50"
                >
                  <Activity className="w-4 h-4" />
                  Xem Live Tracking
                </button>
              )}
              <button
                onClick={() => navigate(`/trip/${tripId}/replan`)}
                disabled={isReplanning}
                className="btn-secondary w-full py-2 text-sm flex items-center justify-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isReplanning ? 'animate-spin' : ''}`} />
                {isReplanning ? 'Đang tạo đề xuất…' : 'Điều chỉnh lộ trình'}
              </button>
              <button
                onClick={handleGoogleMaps}
                className="btn-primary w-full py-2.5 text-sm"
              >
                <Play className="w-4 h-4" />
                Bắt đầu chuyến đi trên Google Maps
              </button>
            </div>
          </div>

          {/* Map (right on desktop) — isolate creates a stacking context so Leaflet's internal z-indexes don't bleed through to modals */}
          <div className={`flex-1 h-full md:flex isolate ${mobileTab === 'map' ? 'flex' : 'hidden'}`}>
            <TripMap
              slots={trip.slots}
              pendingSlots={pendingSlots}
              focusedSlotId={focusedSlotId}
              onMarkerClick={(slotId) => {
                // Highlight slot tương ứng trong timeline
                setFocus(slotId)
                // Trên mobile: chuyển sang tab list để user thấy slot được highlight
                setMobileTab('list')
              }}
              className="w-full h-full rounded-none"
            />
          </div>
        </div>
      </div>

      {/* QR Modal */}
      <Modal open={qrModal} onClose={() => setQrModal(false)} title="QR Sync — Chuyển sang điện thoại">
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-white rounded-xl border-2 border-gray-100">
            <QRCodeSVG value={tripUrl} size={200} />
          </div>
          <p className="text-sm text-gray-500 text-center">
            Quét mã QR bằng điện thoại để mở kế hoạch này ngay lập tức
          </p>
          <button onClick={handleCopyLink} className="btn-secondary w-full">
            Sao chép link
          </button>
        </div>
      </Modal>

      {/* Share Modal */}
      <Modal open={shareModal} onClose={() => setShareModal(false)} title="Chia sẻ kế hoạch">
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={shareUrl} readOnly className="input flex-1 text-xs" />
            <button onClick={handleCopyLink} className="btn-primary shrink-0">Sao chép</button>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">QR Code chia sẻ:</p>
            <div className="flex justify-center p-4 bg-gray-50 rounded-xl">
              <QRCodeSVG value={shareUrl} size={150} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Landmark Recognition BottomSheet */}
      <BottomSheet open={landmarkSheet} onClose={() => setLandmarkSheet(false)}>
        <LandmarkRecognizer
          tripId={tripId!}
          onProposalCreated={() => {
            setLandmarkSheet(false)
            setReplanModal(true)
          }}
        />
      </BottomSheet>

      {/* Replan Scope Selector BottomSheet */}
      <BottomSheet open={replanScopeSheet} onClose={() => { setReplanScopeSheet(false); setPreferredPlace(null) }}>
        <div className="p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">Điều chỉnh lộ trình</h2>

          <div className="pb-1">
            <PlaceSearchBar
              label="Địa điểm muốn thêm vào (tùy chọn)"
              placeholder="Tìm tên hoặc dán link Google Maps..."
              onPlaceSelect={(p) => setPreferredPlace(p)}
            />
            {preferredPlace && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <span className="text-blue-700 font-medium truncate flex-1">{preferredPlace.name}</span>
                <button onClick={() => setPreferredPlace(null)} className="text-blue-400 hover:text-blue-600 shrink-0">✕</button>
              </div>
            )}
          </div>

          <p className="text-sm text-gray-500">Chọn phạm vi điều chỉnh:</p>
          <button
            onClick={() => void handleReplan('remaining_day')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <p className="font-medium text-gray-900">Còn lại hôm nay</p>
            <p className="text-xs text-gray-500 mt-0.5">Chỉ tối ưu các địa điểm còn lại trong ngày hôm nay</p>
          </button>
          <button
            onClick={() => void handleReplan('remaining_trip')}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <p className="font-medium text-gray-900">Toàn bộ chuyến đi</p>
            <p className="text-xs text-gray-500 mt-0.5">Tối ưu lại tất cả các ngày còn lại trong chuyến đi</p>
          </button>
        </div>
      </BottomSheet>

      {/* Replan Modal */}
      {tripId && (
        <ReplanModal
          tripId={tripId}
          placesMap={placesMap}
          open={replanModal}
          onOpenChange={setReplanModal}
          onAccepted={() => {
            void queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
            toast.success('Đã áp dụng lộ trình mới!')
          }}
          onRejected={() => toast.info('Đã từ chối đề xuất')}
        />
      )}

      {/* FAB thêm địa điểm */}
      <button
        onClick={() => handleOpenAddSlot()}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all z-30"
        aria-label="Thêm địa điểm"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* BottomSheet thêm địa điểm */}
      <BottomSheet
        open={addPlaceSheet}
        onClose={() => { setAddPlaceSheet(false); setAddSlotDay(undefined) }}
        title={addSlotDay !== undefined ? `Thêm địa điểm — Ngày ${addSlotDay + 1}` : 'Thêm địa điểm'}
      >
        <div className="px-4 pb-6 space-y-3">
          <PlaceSearchBar
            placeholder="Tên địa điểm hoặc dán link Google Maps..."
            onPlaceSelect={(place) => {
              addSlot({ placeId: place.placeId, dayIndex: addSlotDay })
            }}
          />
          {isAddingSlot && (
            <p className="text-xs text-center text-gray-400">Đang thêm địa điểm…</p>
          )}
        </div>
      </BottomSheet>

      {/* Lock / Unlock slot BottomSheet */}
      <BottomSheet open={lockSheet} onClose={() => { setLockSheet(false); setLockingSlot(null) }}>
        <div className="p-4 space-y-4">
          {lockingSlot?.isLocked ? (
            <>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <LockOpen className="w-4 h-4 text-amber-500" />
                Bỏ cố định giờ
              </h2>
              <p className="text-sm text-gray-500">
                Slot <span className="font-medium text-gray-800">{lockingSlot.place?.name ?? `#${lockingSlot.placeId}`}</span> sẽ được phép điều chỉnh thời gian bởi hệ thống.
              </p>
              <button
                onClick={() => doUnlockSlot(lockingSlot.slotId)}
                disabled={isUnlocking}
                className="btn-secondary w-full py-2.5 text-sm"
              >
                {isUnlocking ? 'Đang xử lý…' : 'Bỏ cố định giờ'}
              </button>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-500" />
                Cố định giờ
              </h2>
              <p className="text-sm text-gray-500">
                Chọn giờ cố định cho <span className="font-medium text-gray-800">{lockingSlot?.place?.name ?? `slot #${lockingSlot?.placeId}`}</span>. Hệ thống sẽ không dịch chuyển slot này khi điều chỉnh lộ trình.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Giờ bắt đầu cố định</label>
                <input
                  type="time"
                  value={lockTime}
                  onChange={(e) => setLockTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <button
                onClick={handleConfirmLock}
                disabled={isLocking || !lockTime}
                className="w-full py-2.5 text-sm font-semibold rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {isLocking ? 'Đang lưu…' : 'Cố định giờ này'}
              </button>
            </>
          )}
        </div>
      </BottomSheet>

      {/* Day-start picker BottomSheet */}
      <BottomSheet
        open={dayStartSheet}
        onClose={() => { setDayStartSheet(false); setDayStartDayIdx(null) }}
        title={dayStartDayIdx !== null ? `Điểm bắt đầu — Ngày ${dayStartDayIdx + 1}` : 'Điểm bắt đầu'}
      >
        <div className="px-4 pb-6 space-y-3">
          <p className="text-xs text-gray-500">
            Chọn nơi xuất phát buổi sáng (khách sạn, quán cafe, nhà ga…). Hệ thống sẽ tự sắp xếp lại các điểm trong ngày theo khoảng cách gần nhất từ đây.
          </p>

          {/* Quick pick từ các slot của ngày */}
          {dayStartDayIdx !== null && (() => {
            const daySlots = trip?.slots.filter((s) => s.dayIndex === dayStartDayIdx && s.place) ?? []
            if (daySlots.length === 0) return null
            return (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-gray-600">Chọn nhanh từ các điểm trong ngày:</p>
                <div className="flex flex-wrap gap-1.5">
                  {daySlots.map((s) => (
                    <button
                      key={s.slotId}
                      type="button"
                      disabled={isSettingDayStart}
                      onClick={() => doSetDayStart({
                        dayIndex: dayStartDayIdx!,
                        lat: s.place!.lat,
                        lng: s.place!.lng,
                        name: s.place!.name,
                      })}
                      className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 disabled:opacity-50 truncate max-w-[180px]"
                      title={s.place!.name}
                    >
                      {s.place!.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

          <div className="border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold text-gray-600 mb-1.5">Hoặc tìm địa điểm khác:</p>
            <PlaceSearchBar
              placeholder="Khách sạn, quán cafe, hoặc dán link Google Maps..."
              onPlaceSelect={(place) => {
                if (dayStartDayIdx === null) return
                doSetDayStart({
                  dayIndex: dayStartDayIdx,
                  lat: place.lat,
                  lng: place.lng,
                  name: place.name,
                })
              }}
            />
          </div>

          {isSettingDayStart && (
            <p className="text-xs text-center text-gray-400">Đang cập nhật và sắp xếp lại…</p>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}
