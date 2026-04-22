import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Map, List, Share2, Play, QrCode } from 'lucide-react'
import { tripService } from '@/services/tripService'
import { useTripStore } from '@/store/tripStore'
import { TripMap } from '@/components/map/TripMap'
import { Timeline } from '@/components/timeline/Timeline'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from '@/store/toastStore'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'

type MobileTab = 'map' | 'list'

export default function TripDetail() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const { setTrip, trip, pendingSlots, focusedSlotId } = useTripStore()
  const [mobileTab, setMobileTab] = useState<MobileTab>('list')
  const [shareModal, setShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [qrModal, setQrModal] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => tripService.get(tripId!),
    enabled: !!tripId,
  })

  useEffect(() => {
    if (data) setTrip(data)
  }, [data, setTrip])

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
            <Map className="w-3.5 h-3.5" />
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
            <div className="border-t border-gray-100 p-3 shrink-0">
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
    </div>
  )
}
