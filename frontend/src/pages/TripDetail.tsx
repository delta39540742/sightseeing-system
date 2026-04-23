import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Map as MapIcon, List, Share2, Play, QrCode, Camera, RefreshCw, Plus } from 'lucide-react'
import { tripService } from '@/services/tripService'
import { placeService } from '@/services/placeService'
import { useTripStore } from '@/store/tripStore'
import { TripMap } from '@/components/map/TripMap'
import { Timeline } from '@/components/timeline/Timeline'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { LandmarkRecognizer } from '@/components/landmark/LandmarkRecognizer'
import { ReplanModal } from '@/components/replan/ReplanModal'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from '@/store/toastStore'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { ReplanScope } from '@/types'
import type { Place as ReplanPlace } from '@/components/replan/types'

type MobileTab = 'map' | 'list'

export default function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setTrip, trip, pendingSlots, focusedSlotId } = useTripStore()
  const [mobileTab, setMobileTab] = useState<MobileTab>('list')
  const [shareModal, setShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [qrModal, setQrModal] = useState(false)
  const [landmarkSheet, setLandmarkSheet] = useState(false)
  const [replanModal, setReplanModal] = useState(false)
  const [replanScopeSheet, setReplanScopeSheet] = useState(false)
  const [isReplanning, setIsReplanning] = useState(false)
  const [addPlaceSheet, setAddPlaceSheet] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

  const { data: placesData } = useQuery({
    queryKey: ['places-search', searchQuery],
    queryFn: () => placeService.list({ city: trip?.destinationCity, page: 1, limit: 20 }),
    enabled: addPlaceSheet,
    staleTime: 60_000,
  })

  const { mutate: addSlot, isPending: isAddingSlot } = useMutation({
    mutationFn: ({ placeId }: { placeId: number }) =>
      tripService.addSlot(tripId!, placeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
      toast.success('Đã thêm địa điểm vào lịch trình')
      setAddPlaceSheet(false)
    },
    onError: () => toast.error('Không thể thêm địa điểm, thử lại sau'),
  })

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

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
    try {
      await tripService.replan(tripId, scope)
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
            <Timeline />

            {/* Bottom action bar */}
            <div className="border-t border-gray-100 p-3 shrink-0 space-y-2">
              <button
                onClick={() => setReplanScopeSheet(true)}
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

          {/* Map (right on desktop) */}
          <div className={`flex-1 h-full md:flex ${mobileTab === 'map' ? 'flex' : 'hidden'}`}>
            <TripMap
              slots={trip.slots}
              pendingSlots={pendingSlots}
              focusedSlotId={focusedSlotId}
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
      <BottomSheet open={replanScopeSheet} onClose={() => setReplanScopeSheet(false)}>
        <div className="p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">Điều chỉnh lộ trình</h2>
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
        onClick={() => setAddPlaceSheet(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all z-30"
        aria-label="Thêm địa điểm"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* BottomSheet thêm địa điểm */}
      <BottomSheet open={addPlaceSheet} onClose={() => setAddPlaceSheet(false)} title="Thêm địa điểm">
        <div className="px-4 pb-6 space-y-3">
          <input
            type="text"
            placeholder="Tìm địa điểm..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
            {placesData?.places
              .filter((p) => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((place) => (
                <button
                  key={place.placeId}
                  onClick={() => addSlot({ placeId: place.placeId })}
                  disabled={isAddingSlot}
                  className="text-left p-3 border border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50"
                >
                  <div className="h-14 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 mb-2" />
                  <p className="text-xs font-semibold text-gray-800 truncate">{place.name}</p>
                  <p className="text-xs text-gray-400">{place.avgVisitDurationMin} phút</p>
                </button>
              ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
