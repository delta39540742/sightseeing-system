import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Map, List } from 'lucide-react'
import { NLPInput } from '@/components/planning/NLPInput'
import { PlanForm } from '@/components/planning/PlanForm'
import { TripMap } from '@/components/map/TripMap'
import { ComparisonPanel } from '@/components/planning/ComparisonPanel'
import { TopProgressBar } from '@/components/ui/Spinner'
import { toast } from '@/store/toastStore'
import { tripService } from '@/services/tripService'
import type { ParsedNLPResult, PlanRequest } from '@/types'

type MobileTab = 'form' | 'map'

export default function PlanTrip() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<ParsedNLPResult | null>(null)
  const [startPoint, setStartPoint] = useState<[number, number] | undefined>()
  const [mapClickMode, setMapClickMode] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('form')

  const { mutate: generate, isPending } = useMutation({
    mutationFn: tripService.generate,
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.success('Kế hoạch đã được tạo thành công!')
      navigate(`/trip/${trip.tripId}`)
    },
    onError: () => toast.error('Không thể tạo kế hoạch. Thử lại sau.', {
      label: 'Thử lại',
      onClick: () => {},
    }),
  })

  const handleGPS = useCallback(() => {
    if (!navigator.geolocation) { toast.error('Thiết bị không hỗ trợ GPS'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStartPoint([pos.coords.latitude, pos.coords.longitude])
        toast.success('Đã lấy vị trí GPS')
      },
      () => toast.error('Không thể lấy vị trí. Hãy cấp quyền GPS.'),
    )
  }, [])

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!mapClickMode) return
    setStartPoint([lat, lng])
    setMapClickMode(false)
    toast.info('Đã chọn điểm xuất phát')
  }, [mapClickMode])

  const handleSubmit = (req: PlanRequest) => {
    generate({ ...req, startLat: startPoint?.[0], startLng: startPoint?.[1] })
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <TopProgressBar visible={isPending} />

      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0 z-10">
        <button onClick={() => navigate('/')} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-semibold text-gray-900">Lập kế hoạch mới</h1>

        {/* Mobile tab switcher */}
        <div className="ml-auto flex md:hidden bg-gray-100 rounded-lg p-1 gap-1">
          <button
            onClick={() => setMobileTab('form')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'form' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <List className="w-3.5 h-3.5" /> Form
          </button>
          <button
            onClick={() => setMobileTab('map')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'map' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
          >
            <Map className="w-3.5 h-3.5" /> Bản đồ
          </button>
        </div>
      </header>

      {/* Desktop split view */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full flex">
          {/* Left panel */}
          <div className={`w-full md:w-[420px] md:flex flex-col h-full overflow-y-auto scrollbar-thin bg-white border-r border-gray-100 ${mobileTab === 'form' ? 'flex' : 'hidden'}`}>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Nhập yêu cầu
                </p>
                <NLPInput onParsed={setParsed} isLoading={isPending} />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Chi tiết kế hoạch
                </p>
                <PlanForm
                  parsed={parsed}
                  onSubmit={handleSubmit}
                  onGPS={handleGPS}
                  onMapClick={() => { setMapClickMode(true); setMobileTab('map'); toast.info('Nhấn vào bản đồ để chọn điểm xuất phát') }}
                  startPoint={startPoint}
                  isLoading={isPending}
                />
              </div>

              <ComparisonPanel />
            </div>
          </div>

          {/* Right map */}
          <div className={`flex-1 h-full md:flex ${mobileTab === 'map' ? 'flex' : 'hidden'} relative`}>
            <TripMap
              slots={[]}
              startPoint={startPoint}
              onMapClick={handleMapClick}
              className="w-full h-full rounded-none"
            />
            {mapClickMode && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm rounded-xl px-4 py-2 shadow-lg text-sm font-medium text-blue-700 pointer-events-none z-10">
                📍 Nhấn vào bản đồ để chọn điểm xuất phát
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
