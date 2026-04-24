import { useState, useCallback, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Map, List, LocateFixed } from 'lucide-react'
import { NLPChat } from '@/components/planning/NLPChat'
import { TripMap } from '@/components/map/TripMap'
import { ComparisonPanel } from '@/components/planning/ComparisonPanel'
import { PlaceOrderStep } from '@/components/planning/PlaceOrderStep'
import { TopProgressBar } from '@/components/ui/Spinner'
import { toast } from '@/store/toastStore'
import { tripService } from '@/services/tripService'
import type { ParsedNLPResult, PlanRequest, PlaceOrderItem } from '@/types'
import { useTripStore } from '@/store/tripStore'
import { useAuthStore } from '@/store/authStore'
import { FilterBar } from '@/components/planning/FilterBar'
import type { FilterCategory } from '@/types'
import { differenceInDays, parseISO } from 'date-fns'

type MobileTab = 'form' | 'map'

export default function PlanTrip() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<ParsedNLPResult | null>(null)
  const [startPoint, setStartPoint] = useState<[number, number] | undefined>()
  const [mapClickMode, setMapClickMode] = useState(false)
  const [mobileTab, setMobileTab] = useState<MobileTab>('form')
  const lastReqRef = useRef<PlanRequest | null>(null)
  
  const user = useAuthStore((s) => s.user)

  // Filter state for candidates
  const [filterActive, setFilterActive] = useState<FilterCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [advancedFilters, setAdvancedFilters] = useState({ maxPrice: 0, minRating: 1, openNow: false, maxDistanceKm: 50 })
  
  const currentStep = useTripStore((s) => s.step)
  const setStep = useTripStore((s) => s.setStep)
  const setPlanRequest = useTripStore((s) => s.setPlanRequest)
  const planRequest = useTripStore((s) => s.planRequest)

  // Reset step khi vào trang để tránh store cũ từ session trước
  useEffect(() => {
    setStep(1)
    setPlanRequest(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [anchorIds, setAnchorIds] = useState<number[]>([])
  const toggleAnchor = (id: number) =>
    setAnchorIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])

  const candidatesReq: PlanRequest | null = parsed
    ? { destinationCity: parsed.destinationCity, startDate: parsed.startDate, endDate: parsed.endDate, budgetTotal: parsed.budget, preferences: parsed.styles }
    : null

  const { data: candidates, isFetching: candidatesLoading, isError: candidatesError } = useQuery({
    queryKey: ['candidates', candidatesReq],
    queryFn: () => tripService.candidates(candidatesReq!),
    enabled: !!candidatesReq,
    staleTime: 60_000,
    retry: 1,
  })

  const { mutate: generate, isPending } = useMutation({
    mutationFn: async (req: PlanRequest) => {
      if (!user) throw new Error('Chưa đăng nhập')
      // generate() gọi POST /api/plan/generate — tạo trip + slots tối ưu, trả về Trip đầy đủ
      return tripService.generate(req)
    },
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.success('Kế hoạch đã được tạo thành công!')
      navigate(`/trip/${trip.tripId}`)
    },
    onError: () => toast.error('Không thể tạo kế hoạch. Thử lại sau.', {
      label: 'Thử lại',
      onClick: () => {
        if (lastReqRef.current) generate(lastReqRef.current)
      },
    }),
  })

  // Filtered candidates
  const filteredCandidates = candidates?.filter((c) => {
    if (filterActive !== 'all') {
      const isSightseeing = c.tags.some(t => t.name === 'sightseeing') || !c.priceType;
      const isMeal = c.tags.some(t => t.name === 'food' || t.name === 'restaurant') || c.priceType;
      // ... basic category matching ...
      if (filterActive === 'sightseeing' && !isSightseeing) return false;
      if (filterActive === 'meal' && !isMeal) return false;
    }
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (advancedFilters.maxPrice > 0 && (c.minPrice || 0) > advancedFilters.maxPrice) return false;
    if (c.rating && c.rating < advancedFilters.minRating) return false;
    return true;
  })

  // Prepare map preview slots
  const previewSlots = candidates
    ?.filter((c) => anchorIds.includes(c.placeId))
    .map((c, i) => ({
      slotId: `preview-${c.placeId}`,
      tripId: '',
      dayIndex: 0,
      slotOrder: i,
      placeId: c.placeId,
      place: c,
      status: 'planned' as const,
      plannedStart: new Date().toISOString(),
      plannedEnd: new Date().toISOString(),
      estimatedCost: c.minPrice || 0,
      activityType: 'sightseeing' as const,
    })) || []

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

  const handleNLPConfirmed = (result: ParsedNLPResult) => {
    setParsed(result)
    const req: PlanRequest = {
      destinationCity: result.destinationCity,
      startDate: result.startDate,
      endDate: result.endDate,
      budgetTotal: result.budget,
      preferences: result.styles,
      numPeople: result.numPeople,
      startLat: startPoint?.[0],
      startLng: startPoint?.[1],
    }
    setPlanRequest(req)
    setStep(3)
  }

  const handleProceedToOrder = () => {
    if (anchorIds.length === 0) {
      toast.error('Hãy chọn ít nhất 1 địa điểm')
      return
    }
    setStep(4)
  }

  const handleGenerateFromOrder = (ordered: PlaceOrderItem[]) => {
    if (!planRequest) return
    const reqToSubmit: PlanRequest = {
      ...planRequest,
      anchorPlaceIds: anchorIds,
      orderedPlaceIds: ordered.map((o) => o.placeId),
      mustVisitPlaceIds: ordered.filter((o) => o.mustVisit).map((o) => o.placeId),
    }
    lastReqRef.current = reqToSubmit
    generate(reqToSubmit)
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
            <div className="p-5 space-y-4">
              {currentStep < 3 ? (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    Lập kế hoạch với AI
                  </p>
                  <NLPChat onConfirmed={handleNLPConfirmed} />
                </div>
              ) : currentStep === 3 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-800">Chọn địa điểm yêu thích</h2>
                    {anchorIds.length > 0 && (
                      <span className="text-xs text-blue-600 font-medium">{anchorIds.length} đã chọn</span>
                    )}
                  </div>

                  {/* Start point (optional) */}
                  <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg text-xs">
                    <LocateFixed className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="text-gray-500">Xuất phát:</span>
                    {startPoint ? (
                      <span className="text-green-600 font-medium">{startPoint[0].toFixed(4)}, {startPoint[1].toFixed(4)}</span>
                    ) : (
                      <span className="text-gray-400 italic">Chưa chọn</span>
                    )}
                    <button onClick={handleGPS} className="ml-auto text-blue-500 hover:text-blue-700 underline">GPS</button>
                    <button
                      onClick={() => { setMapClickMode(true); setMobileTab('map'); toast.info('Nhấn vào bản đồ để chọn điểm xuất phát') }}
                      className="text-blue-500 hover:text-blue-700 underline"
                    >
                      Bản đồ
                    </button>
                  </div>

                  <div className="border-b border-gray-100 pb-3">
                    <FilterBar
                      active={filterActive}
                      onChange={setFilterActive}
                      advanced={advancedFilters}
                      onAdvancedChange={setAdvancedFilters}
                      searchQuery={searchQuery}
                      onSearch={setSearchQuery}
                    />
                  </div>

                  {candidatesLoading ? (
                    <div className="space-y-2 animate-pulse">
                      <p className="text-xs text-gray-400 text-center mb-2">Đang tìm địa điểm phù hợp…</p>
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-20 rounded-xl bg-gray-100" />
                      ))}
                    </div>
                  ) : candidatesError ? (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-2xl">⚠️</p>
                      <p className="text-xs text-red-500 font-medium">Không thể tải danh sách địa điểm</p>
                      <p className="text-xs text-gray-400">Kiểm tra backend đang chạy tại localhost:3000</p>
                    </div>
                  ) : filteredCandidates !== undefined && filteredCandidates.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-400">
                      <p className="text-2xl mb-2">🗺️</p>
                      <p>Không tìm thấy địa điểm phù hợp.</p>
                      <p className="mt-1">Thử thay đổi bộ lọc hoặc sở thích.</p>
                    </div>
                  ) : (
                    <ComparisonPanel
                      candidates={filteredCandidates}
                      selectedIds={anchorIds}
                      onToggle={toggleAnchor}
                    />
                  )}

                  <div className="pt-4 space-y-2 border-t border-gray-100">
                    <button
                      onClick={handleProceedToOrder}
                      disabled={anchorIds.length === 0}
                      className="btn-primary w-full py-2.5 disabled:opacity-50"
                    >
                      Tiếp theo: Sắp xếp thứ tự →
                    </button>
                    <button
                      onClick={() => { setStep(1); setParsed(null); setPlanRequest(null) }}
                      className="btn-secondary w-full py-2.5"
                    >
                      Nhập lại yêu cầu
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 4: sắp xếp thứ tự ưu tiên */
                candidates && planRequest ? (
                  <PlaceOrderStep
                    candidates={candidates}
                    selectedIds={anchorIds}
                    tripDays={
                      differenceInDays(
                        parseISO(planRequest.endDate),
                        parseISO(planRequest.startDate),
                      ) + 1
                    }
                    isPending={isPending}
                    onConfirm={handleGenerateFromOrder}
                    onBack={() => setStep(3)}
                  />
                ) : null
              )}
            </div>
          </div>

          {/* Right map */}
          <div className={`flex-1 h-full md:flex ${mobileTab === 'map' ? 'flex' : 'hidden'} relative`}>
            <TripMap
              slots={previewSlots}
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
