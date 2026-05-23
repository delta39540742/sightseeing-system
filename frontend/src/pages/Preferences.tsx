import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionState } from '@/hooks/useSessionState'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Info, Check,
  Zap, Coffee, Mountain, Camera, ShoppingBag, BookOpen,
  Clock, Footprints, Utensils, Users, Target, Wallet, Bus,
} from 'lucide-react'
import { preferenceService } from '@/services/preferenceService'
import { toast } from '@/store/toastStore'
import { FormSectionSkeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/button'
import type {
  UserPreference,
  SurveyPayload,
  SurveyPrimaryPurpose,
  SurveyGroupType,
} from '@/types'

// ─── Config ──────────────────────────────────────────────────────────────────

const TRAVEL_STYLES = [
  { label: 'Khám phá thiên nhiên', icon: Mountain },
  { label: 'Ẩm thực đường phố',   icon: Utensils },
  { label: 'Văn hóa lịch sử',      icon: BookOpen },
  { label: 'Nghỉ dưỡng',           icon: Coffee },
  { label: 'Chụp ảnh',             icon: Camera },
  { label: 'Mua sắm',              icon: ShoppingBag },
]

const FOOD_PREFS = ['Thuần chay', 'Không hải sản', 'Halal', 'Không gluten', 'Ít cay']

const TRANSPORT_MODES = [
  { label: 'Xe máy', emoji: '🛵' },
  { label: 'Ô tô',   emoji: '🚗' },
  { label: 'Taxi/Grab', emoji: '🚖' },
  { label: 'Đi bộ', emoji: '🚶' },
  { label: 'Xe đạp', emoji: '🚲' },
]

const PACE_OPTIONS = [
  { label: 'Thư thả',   desc: '2–3 điểm/ngày', icon: Coffee },
  { label: 'Vừa phải',  desc: '4–5 điểm/ngày', icon: Footprints },
  { label: 'Năng động', desc: '6+ điểm/ngày',   icon: Zap },
]

const PRIMARY_PURPOSES = [
  { label: 'Du lịch',    emoji: '🗺️' },
  { label: 'Công tác',   emoji: '💼' },
  { label: 'Học hỏi',    emoji: '📚' },
  { label: 'Thư giãn',   emoji: '🏖️' },
  { label: 'Khám phá',   emoji: '🔭' },
]

const GROUP_TYPES = [
  { label: 'Một mình', emoji: '🧍' },
  { label: 'Cặp đôi',  emoji: '👫' },
  { label: 'Gia đình', emoji: '👨‍👩‍👧' },
  { label: 'Bạn bè',   emoji: '👯' },
  { label: 'Công việc', emoji: '💼' },
]

const WEIGHT_LABELS: Record<string, string> = {
  wInterest: 'Sở thích cá nhân',
  wPace:     'Nhịp độ',
  wDistance: 'Khoảng cách',
  wBudget:   'Ngân sách',
  wWeather:  'Thời tiết',
  wRisk:     'Rủi ro',
}

const WEIGHT_COLORS: Record<string, string> = {
  wInterest: 'bg-violet-500',
  wPace:     'bg-blue-500',
  wDistance: 'bg-emerald-500',
  wBudget:   'bg-amber-500',
  wWeather:  'bg-sky-500',
  wRisk:     'bg-red-400',
}

// ─── Chip helper ─────────────────────────────────────────────────────────────

interface ChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}

function Chip({ active, onClick, children, className = '' }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
        active
          ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
          : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600',
        className,
      ].join(' ')}
    >
      {active && <Check className="w-3 h-3" />}
      {children}
    </button>
  )
}

// ─── Mapping label (UI) → enum (backend SurveyPayload) ───────────────────────

const PRIMARY_PURPOSE_MAP: Record<string, SurveyPrimaryPurpose> = {
  'Du lịch':  'phieu_luu',
  'Công tác': 'nghi_duong',
  'Học hỏi':  'van_hoa',
  'Thư giãn': 'nghi_duong',
  'Khám phá': 'phieu_luu',
}

const PACE_MAP: Record<string, number> = {
  'Thư thả':   0.3,
  'Vừa phải':  0.5,
  'Năng động': 0.8,
}

const GROUP_MAP: Record<string, SurveyGroupType> = {
  'Một mình':  'solo',
  'Cặp đôi':   'couple',
  'Gia đình':  'family',
  'Bạn bè':    'friends',
  'Công việc': 'business',
}

const STYLE_TO_TAG: Record<string, number> = {
  'Khám phá thiên nhiên': 1,
  'Ẩm thực đường phố':    2,
  'Văn hóa lịch sử':      3,
  'Nghỉ dưỡng':           4,
  'Chụp ảnh':             5,
  'Mua sắm':              6,
}

type FormState = UserPreference & { groupType?: string }

// Reverse mappings để pre-fill wizard từ data backend đã lưu.
// Một số enum (`am_thuc`, `chup_anh`, `tam_linh`) chưa có UI tương ứng → để label rỗng.
const PURPOSE_ENUM_TO_LABEL: Record<string, string> = {
  phieu_luu:  'Du lịch',
  nghi_duong: 'Thư giãn',
  van_hoa:    'Học hỏi',
  am_thuc:    '',
  chup_anh:   '',
  tam_linh:   '',
}

const GROUP_ENUM_TO_LABEL: Record<string, string> = {
  solo:     'Một mình',
  couple:   'Cặp đôi',
  family:   'Gia đình',
  friends:  'Bạn bè',
  business: 'Công việc',
}

const TAG_TO_STYLE: Record<number, string> = Object.fromEntries(
  Object.entries(STYLE_TO_TAG).map(([label, id]) => [id, label]),
)

function paceNumToLabel(pace: number): string {
  if (pace < 0.4) return 'Thư thả'
  if (pace < 0.7) return 'Vừa phải'
  return 'Năng động'
}

function surveyPayloadToFormState(s: SurveyPayload): FormState {
  return {
    primaryPurpose:   PURPOSE_ENUM_TO_LABEL[s.primaryPurpose] ?? '',
    pace:             paceNumToLabel(s.pace),
    budgetPerDayMin:  s.budgetPerDayMin,
    budgetPerDayMax:  s.budgetPerDayMax,
    foodPreferences:  s.foodPreferences,
    travelStyles:     s.preferredTagIds.map((id) => TAG_TO_STYLE[id]).filter(Boolean),
    transportMode:    'Xe máy',
    maxWalkingKm:     s.mobilityRestrictions.includes('limited_walking') ? 1 : 3,
    groupType:        GROUP_ENUM_TO_LABEL[s.groupType] ?? undefined,
  }
}

// User có thể bỏ qua bất kỳ câu nào → fields chưa trả lời sẽ rơi về default an toàn
// để pass validation backend (primaryPurpose, groupType là required).
function buildSurveyPayload(prefs: FormState): SurveyPayload {
  const tagIds = (prefs.travelStyles ?? [])
    .map((label) => STYLE_TO_TAG[label])
    .filter((id): id is number => typeof id === 'number')
  const preferredTagIds = Array.from(new Set(tagIds)).slice(0, 3)

  return {
    primaryPurpose: PRIMARY_PURPOSE_MAP[prefs.primaryPurpose ?? ''] ?? 'phieu_luu',
    preferredTagIds,
    pace: PACE_MAP[prefs.pace ?? ''] ?? 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: prefs.foodPreferences ?? [],
    budgetPerDayMin: prefs.budgetPerDayMin ?? 200_000,
    budgetPerDayMax: prefs.budgetPerDayMax ?? 1_000_000,
    groupType: GROUP_MAP[prefs.groupType ?? ''] ?? 'solo',
    mobilityRestrictions: (prefs.maxWalkingKm ?? 3) < 1.5 ? ['limited_walking'] : [],
  }
}

// ─── Wizard step config ──────────────────────────────────────────────────────

type StepId =
  | 'primaryPurpose' | 'groupType' | 'travelStyles' | 'pace'
  | 'budget' | 'transport' | 'walking' | 'food'

interface StepConfig {
  id: StepId
  title: string
  subtitle: string
  icon: React.ComponentType<{ className?: string }>
  impact: 'high' | 'medium'
}

const STEPS: StepConfig[] = [
  { id: 'primaryPurpose', title: 'Mục đích chuyến đi của bạn?',     subtitle: 'Lý do chính cho hành trình.',                  icon: Target,     impact: 'high' },
  { id: 'groupType',      title: 'Bạn đi cùng ai?',                  subtitle: 'Để gợi ý phù hợp với nhóm.',                   icon: Users,      impact: 'medium' },
  { id: 'travelStyles',   title: 'Phong cách du lịch yêu thích?',    subtitle: 'Chọn tối đa 3 hoạt động bạn quan tâm.',        icon: Camera,     impact: 'high' },
  { id: 'pace',           title: 'Nhịp độ khám phá?',                subtitle: 'Bạn muốn đi bao nhiêu điểm mỗi ngày?',         icon: Clock,      impact: 'high' },
  { id: 'budget',         title: 'Ngân sách dự kiến mỗi ngày?',      subtitle: 'Khoảng ngân sách min – max bạn sẵn sàng chi.', icon: Wallet,     impact: 'high' },
  { id: 'transport',      title: 'Phương tiện ưa dùng?',             subtitle: 'Phương tiện chính khi đi lại.',                icon: Bus,        impact: 'medium' },
  { id: 'walking',        title: 'Quãng đường đi bộ tối đa?',        subtitle: 'Khoảng cách giữa 2 điểm bạn sẵn sàng đi bộ.',  icon: Footprints, impact: 'medium' },
  { id: 'food',           title: 'Bạn có hạn chế ăn uống nào?',      subtitle: 'Bỏ trống nếu không có hạn chế.',               icon: Utensils,   impact: 'medium' },
]

// Reset 1 câu về trạng thái "chưa trả lời" — primaryPurpose/groupType về '',
// các slider/select về DEFAULT_PREFS, các array về [].
function clearStepValue(stepId: StepId, setPrefs: React.Dispatch<React.SetStateAction<FormState>>) {
  setPrefs((p) => {
    switch (stepId) {
      case 'primaryPurpose': return { ...p, primaryPurpose: '' }
      case 'groupType':      return { ...p, groupType: undefined }
      case 'travelStyles':   return { ...p, travelStyles: [] }
      case 'pace':           return { ...p, pace: undefined }
      case 'budget':         return { ...p, budgetPerDayMin: 200_000, budgetPerDayMax: 1_000_000 }
      case 'transport':      return { ...p, transportMode: undefined }
      case 'walking':        return { ...p, maxWalkingKm: 3 }
      case 'food':           return { ...p, foodPreferences: [] }
      default:               return p
    }
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: FormState = {
  primaryPurpose: '',
  pace: 'Vừa phải',
  budgetPerDayMin: 200_000,
  budgetPerDayMax: 1_000_000,
  foodPreferences: [],
  travelStyles: [],
  transportMode: 'Xe máy',
  maxWalkingKm: 3,
}

export default function Preferences() {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useSessionState<FormState>('pref-prefs', DEFAULT_PREFS)
  const [stepIndex, setStepIndex] = useSessionState('pref-step-index', 0)
  const [isExistingSurvey, setIsExistingSurvey] = useState(false)
  const [weights, setWeights] = useState<Record<string, number> | null>(null)
  const [completed, setCompleted] = useState(false)

  const totalSteps = STEPS.length
  const current = STEPS[stepIndex]
  const Icon = current.icon
  const isLastStep = stepIndex === totalSteps - 1

  const { isLoading: isLoadingStatus } = useQuery({
    queryKey: ['pref-survey-status'],
    queryFn: async () => {
      const status = await preferenceService.getSurveyStatus()
      if (status.hasCompleted) {
        setIsExistingSurvey(true)
        try {
          const survey = await preferenceService.getSurvey()
          if (survey) setPrefs(surveyPayloadToFormState(survey))
        } catch { /* pre-fill optional, fall back to defaults */ }
      }
      return status
    },
  })

  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: FormState) => {
      const payload = buildSurveyPayload(data)
      return isExistingSurvey
        ? preferenceService.updateSurvey(payload)
        : preferenceService.saveSurvey(payload)
    },
    onSuccess: async () => {
      toast.success(isExistingSurvey ? 'Đã cập nhật sở thích!' : 'Đã lưu sở thích!')
      setStepIndex(0)
      setIsExistingSurvey(true)
      setCompleted(true)
      try {
        const result = await preferenceService.getWeights()
        const w: Record<string, number> =
          result && typeof result === 'object' && 'weights' in result
            ? (result as { weights: Record<string, number> }).weights
            : (result as Record<string, number>)
        setWeights(w)
      } catch { /* non-critical */ }
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { data?: { message?: string; error?: string } } }
      const msg = axiosErr.response?.data?.message ?? axiosErr.response?.data?.error
      toast.error(msg ? `Lưu thất bại: ${msg}` : 'Lưu thất bại, thử lại sau')
    },
  })

  const toggle = (key: keyof UserPreference, value: string) => {
    setPrefs((p) => {
      const arr = (p[key] as string[]) ?? []
      return {
        ...p,
        [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value],
      }
    })
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }))

  const handleNext = () => {
    if (isLastStep) {
      save(prefs)
    } else {
      setStepIndex((i) => i + 1)
    }
  }

  const handlePrev = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1)
  }

  const handleSkip = () => {
    clearStepValue(current.id, setPrefs)
    if (isLastStep) {
      // Build dùng default cho field vừa skip → vẫn save được.
      save({ ...prefs })
    } else {
      setStepIndex((i) => i + 1)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
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
          {[1, 2, 3, 4].map((i) => <FormSectionSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  // ── Sau khi hoàn tất: hiển thị tóm tắt & weights ─────────────────────────
  if (completed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="font-semibold text-gray-900 flex-1">Sở thích của tôi</h1>
          <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium border border-emerald-200">
            Đã lưu
          </span>
        </header>

        <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
          <div className="card p-5 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <h2 className="font-semibold text-gray-900">Cảm ơn bạn đã chia sẻ!</h2>
            <p className="text-sm text-gray-500">AI sẽ dùng những lựa chọn này để cá nhân hoá gợi ý cho bạn.</p>
            <div className="flex gap-2 pt-3 justify-center">
              <Button variant="outline" onClick={() => { setCompleted(false); setStepIndex(0) }}>Sửa lại</Button>
              <Button onClick={() => navigate('/trips')}>Đi khám phá</Button>
            </div>
          </div>

          {weights && Object.keys(weights).length > 0 && (
            <div className="card p-4 space-y-3">
              <h2 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Trọng số tối ưu hoá của bạn
              </h2>
              <div className="space-y-2.5">
                {Object.entries(WEIGHT_LABELS).map(([key, label]) => {
                  const value = weights[key] ?? 0
                  const maxWeight = Math.max(1, ...Object.values(weights))
                  const color = WEIGHT_COLORS[key] ?? 'bg-blue-500'
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>{label}</span>
                        <span className="font-medium">{(value * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className={`${color} h-1.5 rounded-full transition-all duration-700`}
                          style={{ width: `${(value / maxWeight) * 100}%` }}
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

  // ── Wizard ────────────────────────────────────────────────────────────────
  const budgetMinK = ((prefs.budgetPerDayMin ?? 200_000) / 1000).toFixed(0)
  const budgetMaxK = ((prefs.budgetPerDayMax ?? 1_000_000) / 1000).toFixed(0)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-semibold text-gray-900 flex-1">Sở thích của tôi</h1>
        {isExistingSurvey && (
          <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium border border-emerald-200">
            Đã lưu
          </span>
        )}
      </header>

      {/* Progress */}
      <div className="max-w-xl mx-auto w-full px-4 pt-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
          <span>Câu {stepIndex + 1} / {totalSteps}</span>
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            current.impact === 'high' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {current.impact === 'high' ? '↑ Quan trọng' : '~ Tuỳ chọn'}
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Card body */}
      <div className="max-w-xl mx-auto w-full px-4 py-5 flex-1">
        <div className="card p-5 sm:p-6 space-y-5">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <Icon className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-base text-gray-900">{current.title}</h2>
              <p className="text-xs text-gray-500 mt-1">{current.subtitle}</p>
            </div>
          </div>

          <div className="pt-1">
            {current.id === 'primaryPurpose' && (
              <div className="flex flex-wrap gap-2">
                {PRIMARY_PURPOSES.map(({ label, emoji }) => (
                  <Chip
                    key={label}
                    active={prefs.primaryPurpose === label}
                    onClick={() => set('primaryPurpose', prefs.primaryPurpose === label ? '' : label)}
                  >
                    {emoji} {label}
                  </Chip>
                ))}
              </div>
            )}

            {current.id === 'groupType' && (
              <div className="flex flex-wrap gap-2">
                {GROUP_TYPES.map(({ label, emoji }) => (
                  <Chip
                    key={label}
                    active={prefs.groupType === label}
                    onClick={() => setPrefs((p) => ({
                      ...p,
                      groupType: p.groupType === label ? undefined : label,
                    }))}
                  >
                    {emoji} {label}
                  </Chip>
                ))}
              </div>
            )}

            {current.id === 'travelStyles' && (
              <>
                <div className="flex flex-wrap gap-2">
                  {TRAVEL_STYLES.map(({ label, icon: SIcon }) => (
                    <Chip
                      key={label}
                      active={(prefs.travelStyles ?? []).includes(label)}
                      onClick={() => toggle('travelStyles', label)}
                    >
                      <SIcon className="w-3 h-3" />
                      {label}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">Đã chọn {(prefs.travelStyles ?? []).length}/3 (vượt quá sẽ tự lấy 3 cái đầu).</p>
              </>
            )}

            {current.id === 'pace' && (
              <div className="grid grid-cols-3 gap-2">
                {PACE_OPTIONS.map(({ label, desc, icon: PIcon }) => {
                  const active = prefs.pace === label
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => set('pace', label)}
                      className={[
                        'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center',
                        active
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-blue-200 text-gray-600',
                      ].join(' ')}
                    >
                      <PIcon className={`w-5 h-5 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                      <span className="text-xs font-semibold">{label}</span>
                      <span className="text-[10px] text-current opacity-70">{desc}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {current.id === 'budget' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-600">Ngân sách/ngày</label>
                  <span className="text-xs font-semibold text-blue-600">{budgetMinK}k – {budgetMaxK}k VNĐ</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-8">Min</span>
                    <input
                      type="range" min={50_000} max={5_000_000} step={50_000}
                      value={prefs.budgetPerDayMin}
                      onChange={(e) => {
                        const newMin = +e.target.value
                        setPrefs((p) => ({
                          ...p,
                          budgetPerDayMin: newMin,
                          budgetPerDayMax: newMin > (p.budgetPerDayMax ?? 1_000_000) ? newMin : p.budgetPerDayMax,
                        }))
                      }}
                      className="flex-1 accent-blue-500 h-1.5"
                      aria-label="Ngân sách tối thiểu"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-8">Max</span>
                    <input
                      type="range" min={50_000} max={5_000_000} step={50_000}
                      value={prefs.budgetPerDayMax}
                      onChange={(e) => {
                        const newMax = +e.target.value
                        setPrefs((p) => ({
                          ...p,
                          budgetPerDayMax: newMax,
                          budgetPerDayMin: newMax < (p.budgetPerDayMin ?? 200_000) ? newMax : p.budgetPerDayMin,
                        }))
                      }}
                      className="flex-1 accent-blue-500 h-1.5"
                      aria-label="Ngân sách tối đa"
                    />
                  </div>
                </div>
              </div>
            )}

            {current.id === 'transport' && (
              <div className="flex flex-wrap gap-2">
                {TRANSPORT_MODES.map(({ label, emoji }) => (
                  <Chip
                    key={label}
                    active={prefs.transportMode === label}
                    onClick={() => set('transportMode', prefs.transportMode === label ? undefined : label)}
                  >
                    {emoji} {label}
                  </Chip>
                ))}
              </div>
            )}

            {current.id === 'walking' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-600">
                    <Footprints className="w-3.5 h-3.5 inline mr-1" />
                    Đi bộ tối đa
                  </label>
                  <span className="text-xs font-semibold text-blue-600">{prefs.maxWalkingKm} km</span>
                </div>
                <input
                  type="range" min={0.5} max={15} step={0.5}
                  value={prefs.maxWalkingKm}
                  onChange={(e) => set('maxWalkingKm', +e.target.value)}
                  className="w-full accent-blue-500 h-1.5"
                  aria-label="Quãng đường đi bộ tối đa"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>0.5 km</span><span>15 km</span>
                </div>
              </div>
            )}

            {current.id === 'food' && (
              <div className="flex flex-wrap gap-2">
                {FOOD_PREFS.map((f) => (
                  <Chip
                    key={f}
                    active={(prefs.foodPreferences ?? []).includes(f)}
                    onClick={() => toggle('foodPreferences', f)}
                  >
                    {f}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Banner thông tin tổng quan, chỉ ở câu đầu để khỏi rối */}
        {stepIndex === 0 && (
          <div className="mt-3 flex items-start gap-2.5 text-xs text-blue-700 bg-blue-50 rounded-xl px-3.5 py-3 border border-blue-100">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Mỗi câu có nút "Bỏ qua" — nhưng càng trả lời nhiều, AI càng gợi ý chính xác hơn.</span>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-gray-100 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrev} disabled={stepIndex === 0 || isPending}>
            Quay lại
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSkip} disabled={isPending}>
            Bỏ qua
          </Button>
          <div className="flex-1" />
          <Button onClick={handleNext} loading={isPending} id="btn-wizard-next">
            {isLastStep ? (isExistingSurvey ? 'Cập nhật' : 'Hoàn tất') : 'Tiếp'}
          </Button>
        </div>
      </div>
    </div>
  )
}
