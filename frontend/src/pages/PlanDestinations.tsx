import { useState, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  MapPin, Send, X, ArrowRight, Route, Calendar, Wallet,
  Share2, Trash2, Check, Loader2, Bell, User,
  PersonStanding,
} from 'lucide-react'
import { TripMap } from '@/components/map/TripMap'
import { NluSlotEditor } from '@/components/planning/NluSlotEditor'
import { DestinationDetailPanel } from '@/components/planning/DestinationDetailPanel'
import { tripService } from '@/services/tripService'
import { nluService } from '@/services/nluService'
import { parseNLP } from '@/utils/nlpParser'
import { useAuthStore } from '@/store/authStore'
import type { Place, PlanRequest, TripSlot, NluParseResponse, ParsedNLPResult } from '@/types'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface ConflictWarning {
  newPlace: string
  existingPlace: string
  distanceKm: number
}

type ChatMessage =
  | { role: 'ai'; text: string }
  | { role: 'user'; text: string }
  | { role: 'ai-slots'; nluResponse: NluParseResponse; confirmed: boolean }

const NAV_ITEMS = [
  { id: 'destinations', label: 'ĐỊA ĐIỂM',  Icon: PersonStanding },
  { id: 'route',        label: 'LỘ TRÌNH',   Icon: Route },
  { id: 'timeline',     label: 'THỜI GIAN',  Icon: Calendar },
  { id: 'budget',       label: 'NGÂN SÁCH',  Icon: Wallet },
]

const DEFAULT_HASHTAGS = ['Đà Nẵng', 'Hội An', 'Phú Quốc']

export default function PlanDestinations() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, openLoginDrawer } = useAuthStore()

  const navState = location.state as { selectedPlaces?: Place[]; planRequest?: PlanRequest | null } | null

  const [input, setInput] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'ai',
      text: 'Chào bạn! Tôi có thể giúp bạn tìm những địa điểm tuyệt vời. Bạn muốn bắt đầu từ đâu?',
    },
  ])
  const [planRequest, setPlanRequest] = useState<PlanRequest | null>(navState?.planRequest ?? null)
  const [selectedPlaces, setSelectedPlaces] = useState<Place[]>(navState?.selectedPlaces ?? [])
  const [dismissedIds, setDismissedIds] = useState<number[]>([])
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([])
  const [showNearby, setShowNearby] = useState(false)
  const [selectedNearby, setSelectedNearby] = useState<Place | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: candidates, isLoading: candidatesLoading } = useQuery({
    queryKey: ['candidates', planRequest],
    queryFn: () => tripService.candidates(planRequest!),
    enabled: !!planRequest,
    staleTime: 60_000,
  })

  const visibleCandidates = candidates?.filter((p) => !dismissedIds.includes(p.placeId)) ?? []

  const nearbyPlaces: Place[] = useMemo(() => {
    if (!showNearby || selectedPlaces.length === 0 || !candidates) return []
    const selectedSet = new Set(selectedPlaces.map((p) => p.placeId))
    const NEARBY_RADIUS_KM = 5
    const MAX_NEARBY = 8

    const scored = candidates
      .filter((c) => !selectedSet.has(c.placeId) && c.lat && c.lng)
      .map((c) => {
        const distances = selectedPlaces
          .filter((sel) => sel.lat && sel.lng)
          .map((sel) => haversineKm(sel.lat, sel.lng, c.lat!, c.lng!))
        const minDist = distances.length ? Math.min(...distances) : Infinity
        return { place: c, minDist }
      })
      .filter(({ minDist }) => minDist <= NEARBY_RADIUS_KM)
      .sort((a, b) => a.minDist - b.minDist)
      .slice(0, MAX_NEARBY)

    return scored.map(({ place }) => place)
  }, [showNearby, selectedPlaces, candidates])

  function addNearbyPlace(place: Place) {
    addPlace(place)
    setSelectedNearby(null)
  }

  function addPlace(place: Place) {
    const newConflicts: ConflictWarning[] = []
    for (const existing of selectedPlaces) {
      const dist = haversineKm(place.lat, place.lng, existing.lat, existing.lng)
      if (dist > 50) {
        newConflicts.push({ newPlace: place.name, existingPlace: existing.name, distanceKm: Math.round(dist) })
      }
    }
    setConflicts(newConflicts)
    setSelectedPlaces((prev) => [...prev, place])
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  function removePlace(placeId: number) {
    setSelectedPlaces((prev) => prev.filter((p) => p.placeId !== placeId))
    setConflicts([])
  }

  function clearAll() {
    setSelectedPlaces([])
    setConflicts([])
  }

  function dismissSuggestion(placeId: number) {
    setDismissedIds((prev) => [...prev, placeId])
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || isParsing) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text }])
    setDismissedIds([])
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    setIsParsing(true)
    try {
      const nluResult = await nluService.parse(text)
      setMessages((prev) => [...prev, { role: 'ai-slots', nluResponse: nluResult, confirmed: false }])
    } catch {
      // Backend down → fallback local regex, vẫn hiện editor để user kiểm tra
      const parsed = parseNLP(text)
      const fallbackResponse: NluParseResponse = {
        slots: {
          destinationCity: parsed.destinationCity,
          durationDays: parsed.days,
          startDate: parsed.startDate,
          preferredTagNames: parsed.styles,
          experienceKeywords: parsed.experienceKeywords ?? [],
          budgetTotal: parsed.budget,
          groupType: null,
          mobilityRestrictions: [],
          dietaryPreferences: [],
          pace: null,
        },
        missingSlots: [],
        confidence: 0.5,
      }
      setMessages((prev) => [...prev, { role: 'ai-slots', nluResponse: fallbackResponse, confirmed: false }])
    } finally {
      setIsParsing(false)
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  function handleSlotConfirm(result: ParsedNLPResult) {
    setMessages((prev) =>
      prev.map((m) =>
        m.role === 'ai-slots' && !m.confirmed ? { ...m, confirmed: true } : m,
      ),
    )
    setMessages((prev) => [
      ...prev,
      { role: 'ai', text: `Tuyệt! Đang tìm địa điểm tại **${result.destinationCity}** phù hợp với yêu cầu của bạn...` },
    ])
    setDismissedIds([])
    setPlanRequest({
      destinationCity: result.destinationCity,
      startDate: result.startDate,
      endDate: result.endDate,
      budgetTotal: result.budget,
      preferences: result.styles,
      experienceKeywords: result.experienceKeywords,
      numPeople: result.numPeople,
    })
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const mapSlots: TripSlot[] = selectedPlaces.map((p, i) => ({
    slotId: `sel-${p.placeId}`,
    tripId: '',
    dayIndex: 0,
    slotOrder: i,
    placeId: p.placeId,
    place: p,
    status: 'planned' as const,
    plannedStart: new Date().toISOString(),
    plannedEnd: new Date().toISOString(),
    estimatedCost: p.minPrice || 0,
    activityType: 'sightseeing' as const,
  }))

  const canProceed = selectedPlaces.length >= 1 && planRequest !== null
  const destinationCity = planRequest?.destinationCity ?? ''
  const hashtags = planRequest
    ? [destinationCity, 'Bãi biển', 'Ẩm thực'].filter(Boolean)
    : DEFAULT_HASHTAGS

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Top nav */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 shrink-0 z-30">
        <span className="text-xl font-extrabold text-blue-600 tracking-tight mr-10">VOYAGER</span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
          <button onClick={() => navigate('/')} className="hover:text-slate-900 transition-colors">Khám phá</button>
          <button className="text-blue-600 border-b-2 border-blue-600 pb-0.5">Lên kế hoạch</button>
          <button onClick={() => navigate('/destinations')} className="hover:text-slate-900 transition-colors">Điểm đến</button>
          <button className="hover:text-slate-900 transition-colors">Cộng đồng</button>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <button
            onClick={() => (user ? navigate('/profile') : openLoginDrawer())}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <User className="w-5 h-5" />
          </button>
          <button
            onClick={() => canProceed && navigate('/plan/route', { state: { selectedPlaces, planRequest } })}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
          >
            Lưu chuyến đi
          </button>
        </div>
      </header>

      {/* Main content row */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden lg:flex w-52 bg-slate-900 flex-col shrink-0">
          <div className="px-4 pt-5 pb-4 border-b border-slate-700">
            <p className="text-[11px] font-bold text-slate-200 uppercase tracking-widest truncate">
              {destinationCity ? `ĐẾN ${destinationCity.toUpperCase()}` : 'CHUYẾN ĐI MỚI'}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-widest">Giai đoạn: Lên kế hoạch</p>
          </div>

          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const active = id === 'destinations'
              return (
                <button
                  key={id}
                  onClick={id !== 'destinations'
                    ? () => navigate('/plan/route', { state: { selectedPlaces, planRequest } })
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

        {/* Center panel */}
        <div className="w-full lg:w-[480px] flex flex-col bg-white border-r border-slate-200 shrink-0 overflow-hidden">
          {/* Panel header */}
          <div className="px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight">Chọn Điểm Đến</h1>
                <p className="text-xs text-slate-500 mt-0.5">Nhập địa điểm bạn muốn ghé thăm</p>
              </div>
              {selectedPlaces.length > 0 && (
                <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full shrink-0">
                  {selectedPlaces.length} Đã chọn
                </span>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Selected destinations dark card */}
              {selectedPlaces.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Danh sách đã chọn ({selectedPlaces.length})
                    </p>
                    <button
                      onClick={clearAll}
                      className="text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-widest transition-colors"
                    >
                      Xóa tất cả
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedPlaces.map((p) => (
                      <div
                        key={p.placeId}
                        className="flex items-center gap-1 bg-slate-700 text-white rounded-full px-2.5 py-1 text-xs font-medium"
                      >
                        <span>{p.name}</span>
                        <button
                          onClick={() => removePlace(p.placeId)}
                          className="text-slate-400 hover:text-white ml-0.5 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nearby suggestion toggle button */}
              {selectedPlaces.length > 0 && candidates && candidates.length > 0 && (
                <button
                  onClick={() => {
                    setShowNearby((prev) => !prev)
                    if (showNearby) setSelectedNearby(null)
                  }}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                    showNearby
                      ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
                      : 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50'
                  }`}
                >
                  <span className="text-sm">📍</span>
                  {showNearby ? 'Ẩn địa điểm lân cận' : 'Đề xuất địa điểm lân cận'}
                </button>
              )}

              {/* Nearby suggestions list in sidebar */}
              {showNearby && (
                <div>
                  {nearbyPlaces.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-3">
                      Không tìm thấy địa điểm nào trong vòng 10km.
                    </p>
                  ) : (
                    <div>
                      <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">
                        {nearbyPlaces.length} điểm lân cận (&lt;10km)
                      </p>
                      <div className="space-y-2">
                        {nearbyPlaces.map((place) => {
                          const isAdded = selectedPlaces.some((s) => s.placeId === place.placeId)
                          const nearestDist = selectedPlaces.reduce((min, sel) => {
                            if (!sel.lat || !sel.lng) return min
                            const d = haversineKm(sel.lat, sel.lng, place.lat!, place.lng!)
                            return d < min ? d : min
                          }, Infinity)
                          return (
                            <div
                              key={place.placeId}
                              className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5"
                            >
                              <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-amber-200">
                                {place.imageUrl ? (
                                  <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-sm">🏛️</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-900 truncate">{place.name}</p>
                                <p className="text-[10px] text-amber-700">
                                  ~{nearestDist === Infinity ? '?' : nearestDist.toFixed(1)}km
                                </p>
                              </div>
                              {isAdded ? (
                                <span className="text-[10px] font-bold text-slate-400 shrink-0">Đã thêm</span>
                              ) : (
                                <button
                                  onClick={() => addPlace(place)}
                                  className="shrink-0 text-[10px] font-bold bg-amber-500 text-white px-2.5 py-1 rounded-lg hover:bg-amber-600 transition-colors"
                                >
                                  Thêm
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Conflict warnings */}
              {conflicts.map((c, i) => (
                <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
                  <span className="mt-0.5">⚠️</span>
                  <span>
                    <strong>{c.newPlace}</strong> cách <strong>{c.existingPlace}</strong> ~{c.distanceKm}km — kiểm tra thời gian di chuyển trước khi lên lịch.
                  </span>
                </div>
              ))}

              {/* Chat messages */}
              {messages.map((msg, i) => {
                if (msg.role === 'ai-slots') {
                  return (
                    <div key={i} className="flex gap-2.5 items-start">
                      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        {!msg.confirmed ? (
                          <>
                            <p className="text-xs text-slate-500 mb-1.5 font-medium">Tôi hiểu bạn muốn:</p>
                            <NluSlotEditor response={msg.nluResponse} onConfirm={handleSlotConfirm} />
                          </>
                        ) : (
                          <div className="bg-green-50 border border-green-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-green-700">
                            Đã xác nhận ✓
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {msg.role === 'ai' && (
                      <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                      </div>
                    )}
                    <div
                      className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'ai'
                          ? 'bg-slate-100 text-slate-900 rounded-tl-sm'
                          : 'bg-blue-600 text-white rounded-tr-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                )
              })}

              {/* NLU parsing indicator */}
              {isParsing && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-500">
                    AI đang phân tích yêu cầu...
                  </div>
                </div>
              )}

              {/* DB search indicator */}
              {!isParsing && candidatesLoading && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  </div>
                  <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-slate-500">
                    Đang tìm địa điểm phù hợp trong cơ sở dữ liệu...
                  </div>
                </div>
              )}

              {/* Suggestion cards */}
              {visibleCandidates.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center py-3 border-y border-slate-100">
                    Đề xuất dựa trên yêu cầu của bạn
                  </p>
                  <div className="space-y-3 mt-3">
                    {visibleCandidates.slice(0, 8).map((place) => {
                      const isAdded = selectedPlaces.some((s) => s.placeId === place.placeId)
                      return (
                        <div
                          key={place.placeId}
                          className={`border rounded-xl overflow-hidden transition-colors ${
                            isAdded ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex gap-3 p-3">
                            {/* Place image */}
                            <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-gradient-to-br from-blue-400 to-indigo-600 relative">
                              {place.imageUrl ? (
                                <img src={place.imageUrl} alt={place.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-2xl">🏛️</div>
                              )}
                              {isAdded && (
                                <div className="absolute top-1 right-1 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </div>

                            {/* Place info */}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-slate-900 leading-tight">{place.name}</p>
                              {place.description && (
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
                                  {place.description}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                {isAdded ? (
                                  <>
                                    <button
                                      disabled
                                      className="flex-1 flex items-center justify-center gap-1 text-xs font-medium bg-slate-200 text-slate-400 py-1.5 rounded-lg cursor-default"
                                    >
                                      <Check className="w-3 h-3" /> Đã thêm
                                    </button>
                                    <button
                                      onClick={() => removePlace(place.placeId)}
                                      className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors shrink-0"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => addPlace(place)}
                                      className="flex-1 text-xs font-semibold bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
                                    >
                                      Chấp nhận
                                    </button>
                                    <button
                                      onClick={() => dismissSuggestion(place.placeId)}
                                      className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors shrink-0"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="px-4 pt-3 pb-2 border-t border-slate-100 bg-white shrink-0">
            <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-1.5">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                className="flex-1 bg-transparent text-sm text-slate-900 placeholder-slate-400 outline-none py-1 min-w-0 disabled:opacity-50"
                placeholder={isParsing ? 'AI đang phân tích...' : 'Nhập địa danh hoặc yêu cầu...'}
                value={input}
                disabled={isParsing}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || isParsing}
                className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
              >
                {isParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mt-2 pb-1">
              {hashtags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => { setInput(tag); setTimeout(() => handleSend(tag), 0) }}
                  className="text-xs text-slate-500 hover:text-blue-600 transition-colors"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom proceed bar */}
          {canProceed && (
            <div className="px-4 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Route className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 leading-none">Sẵn sàng để bắt đầu?</p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-tight">
                    {selectedPlaces.length} địa điểm đã được thêm vào lộ trình của bạn.
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/plan/route', { state: { selectedPlaces, planRequest } })}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0"
              >
                Tiếp theo: Tạo Lộ Trình
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Right map */}
        <div className="hidden lg:flex flex-1 relative">
          <TripMap
            slots={mapSlots}
            className="w-full h-full rounded-none"
            nearbyPlaces={nearbyPlaces}
            onNearbyClick={(place) => setSelectedNearby(place)}
          />
          {selectedPlaces.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-white/90 backdrop-blur-sm rounded-2xl px-6 py-4 shadow-lg text-center">
                <MapPin className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">Thêm địa điểm để xem trên bản đồ</p>
                <p className="text-xs text-slate-500 mt-1">Nhập yêu cầu và chọn địa điểm bên trái</p>
              </div>
            </div>
          )}
          <DestinationDetailPanel
            place={selectedNearby}
            onClose={() => setSelectedNearby(null)}
            onAdd={addNearbyPlace}
            alreadyAdded={
              selectedNearby !== null &&
              selectedPlaces.some((p) => p.placeId === selectedNearby.placeId)
            }
          />
        </div>
      </div>
    </div>
  )
}
