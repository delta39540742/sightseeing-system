import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { preferenceService } from '@/services/preferenceService'
import { toast } from '@/store/toastStore'
import { Spinner } from '@/components/ui/Spinner'
import { Skeleton } from '@/components/ui/Skeleton'
import type { UserPreference } from '@/types'

const TRAVEL_STYLES = [
  'Khám phá thiên nhiên', 'Ẩm thực đường phố', 'Văn hóa lịch sử',
  'Nghỉ dưỡng', 'Chụp ảnh', 'Mua sắm',
]

const FOOD_PREFS = ['Thuần chay', 'Không hải sản', 'Halal', 'Không gluten']
const TRANSPORT_MODES = ['Xe máy', 'Ô tô', 'Taxi/Grab', 'Đi bộ', 'Xe đạp']
const PACE_OPTIONS = ['Thư thả', 'Vừa phải', 'Năng động']

const WEIGHT_LABELS: Record<string, string> = {
  wInterest: 'Sở thích cá nhân',
  wPace: 'Nhịp độ',
  wDistance: 'Khoảng cách',
  wBudget: 'Ngân sách',
  wWeather: 'Thời tiết',
  wRisk: 'Rủi ro',
}

interface SectionProps {
  title: string
  impact: 'high' | 'medium'
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ title, impact, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-sm flex-1">{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impact === 'high' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
          Ảnh hưởng {impact === 'high' ? 'cao' : 'trung bình'}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3 border-t border-gray-100">{children}</div>}
    </div>
  )
}

export default function Preferences() {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<UserPreference>({
    primaryPurpose: '',
    pace: 'Vừa phải',
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 1_000_000,
    foodPreferences: [],
    travelStyles: [],
    transportMode: 'Xe máy',
    maxWalkingKm: 3,
  })
  // B.1: Track whether user already has a saved survey
  const [isExistingSurvey, setIsExistingSurvey] = useState(false)
  // B.2: Store weights returned after submit
  const [weights, setWeights] = useState<Record<string, number> | null>(null)

  // B.1: Load survey status on mount
  // NOTE: GET /preferences/survey does NOT exist in preference-service/src/routes/survey.routes.ts
  // Only GET /survey/status, POST /survey, PATCH /survey are available.
  // Therefore we only use getSurveyStatus() to determine routing (POST vs PATCH).
  // We cannot pre-populate form fields from saved data since there is no GET survey route.
  const { isLoading: isLoadingStatus } = useQuery({
    queryKey: ['pref-survey-status'],
    queryFn: async () => {
      const status = await preferenceService.getSurveyStatus()
      if (status.completed) {
        setIsExistingSurvey(true)
      }
      return status
    },
  })

  // B.2: POST vs PATCH routing
  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: UserPreference) => {
      if (isExistingSurvey) {
        return preferenceService.updateSurvey(data)
      }
      return preferenceService.saveSurvey(data)
    },
    onSuccess: async () => {
      toast.success(isExistingSurvey ? 'Đã cập nhật sở thích!' : 'Đã lưu sở thích!')
      // B.2: Fetch weights after successful submit
      try {
        const result = await preferenceService.getWeights()
        // weights may be nested under result.weights or at top level
        const w: Record<string, number> =
          result && typeof result === 'object' && 'weights' in result
            ? (result as { weights: Record<string, number> }).weights
            : (result as Record<string, number>)
        setWeights(w)
      } catch {
        // weights fetch failure is non-critical
      }
    },
    onError: () => toast.error('Lưu thất bại, thử lại sau'),
  })

  const toggle = (key: keyof UserPreference, value: string) => {
    setPrefs((p) => {
      const arr = (p[key] as string[]) ?? []
      return { ...p, [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] }
    })
  }

  // B.1: Show loading skeleton while fetching survey status
  if (isLoadingStatus) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="font-semibold text-gray-900">Sở thích của tôi</h1>
        </header>
        <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-semibold text-gray-900">Sở thích của tôi</h1>
      </header>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2.5">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          Sở thích được dùng để cá nhân hóa gợi ý địa điểm và thứ tự ưu tiên cho mỗi chuyến đi.
        </div>

        <Section title="Phong cách du lịch" impact="high">
          <div className="flex flex-wrap gap-2 pt-2">
            {TRAVEL_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => toggle('travelStyles', s)}
                className={`chip ${(prefs.travelStyles ?? []).includes(s) ? 'chip-active' : 'chip-inactive'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Tốc độ di chuyển" impact="high">
          <div className="flex gap-2 pt-2">
            {PACE_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPrefs((prev) => ({ ...prev, pace: p }))}
                className={`chip flex-1 justify-center ${prefs.pace === p ? 'chip-active' : 'chip-inactive'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Ràng buộc cá nhân" impact="high">
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-gray-600">
                Ngân sách/ngày: {(prefs.budgetPerDayMin! / 1000).toFixed(0)}k – {(prefs.budgetPerDayMax! / 1000).toFixed(0)}k
              </label>
              <div className="flex gap-3 mt-1.5">
                <input
                  type="range" min={50_000} max={2_000_000} step={50_000}
                  value={prefs.budgetPerDayMin}
                  onChange={(e) => setPrefs((p) => ({ ...p, budgetPerDayMin: +e.target.value }))}
                  className="flex-1 accent-blue-500"
                  aria-label="Ngân sách tối thiểu"
                />
                <input
                  type="range" min={50_000} max={5_000_000} step={50_000}
                  value={prefs.budgetPerDayMax}
                  onChange={(e) => setPrefs((p) => ({ ...p, budgetPerDayMax: +e.target.value }))}
                  className="flex-1 accent-blue-500"
                  aria-label="Ngân sách tối đa"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Phương tiện ưa dùng</label>
              <div className="flex flex-wrap gap-2">
                {TRANSPORT_MODES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setPrefs((p) => ({ ...p, transportMode: t }))}
                    className={`chip ${prefs.transportMode === t ? 'chip-active' : 'chip-inactive'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">
                Quãng đường đi bộ tối đa: {prefs.maxWalkingKm} km
              </label>
              <input
                type="range" min={0.5} max={15} step={0.5}
                value={prefs.maxWalkingKm}
                onChange={(e) => setPrefs((p) => ({ ...p, maxWalkingKm: +e.target.value }))}
                className="w-full accent-blue-500 mt-1"
                aria-label="Quãng đường đi bộ tối đa"
              />
            </div>
          </div>
        </Section>

        <Section title="Hạn chế ăn uống" impact="medium">
          <div className="flex flex-wrap gap-2 pt-2">
            {FOOD_PREFS.map((f) => (
              <button
                key={f}
                onClick={() => toggle('foodPreferences', f)}
                className={`chip ${(prefs.foodPreferences ?? []).includes(f) ? 'chip-active' : 'chip-inactive'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </Section>

        <div className="pt-2 pb-8">
          <button
            onClick={() => save(prefs)}
            disabled={isPending}
            className="btn-primary w-full py-3"
          >
            {isPending ? <Spinner size="sm" /> : isExistingSurvey ? 'Cập nhật sở thích' : 'Lưu sở thích'}
          </button>
        </div>

        {/* B.2: Hiện trọng số tối ưu hoá sau khi submit */}
        {weights && Object.keys(weights).length > 0 && (
          <div className="card p-4 space-y-3 pb-8">
            <h2 className="font-semibold text-sm text-gray-800">Trọng số tối ưu hoá</h2>
            <div className="space-y-2">
              {Object.entries(WEIGHT_LABELS).map(([key, label]) => {
                const value = weights[key] ?? 0
                return (
                  <div key={key}>
                    <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                      <span>{label}</span>
                      <span>{(value * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${value * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
