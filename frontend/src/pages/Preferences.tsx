import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, ChevronDown, ChevronUp, Info, Check,
  Zap, Coffee, Mountain, Camera, ShoppingBag, BookOpen,
  Clock, Footprints, Utensils, Users, Target,
} from 'lucide-react'
import { preferenceService } from '@/services/preferenceService'
import { toast } from '@/store/toastStore'
import { Spinner } from '@/components/ui/Spinner'
import { FormSectionSkeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/button'
import type { UserPreference } from '@/types'

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

// ─── Section wrapper ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  icon?: React.ReactNode
  impact: 'high' | 'medium'
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ title, icon, impact, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 w-full px-4 py-3.5 hover:bg-gray-50/80 text-left transition-colors"
        aria-expanded={open}
      >
        {icon && <span className="text-gray-400 shrink-0">{icon}</span>}
        <span className="font-semibold text-sm flex-1 text-gray-800">{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
          impact === 'high' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {impact === 'high' ? '↑ Cao' : '~ Vừa'}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        }
      </button>
      {open && (
        <div className="px-4 pb-5 space-y-4 border-t border-gray-100 pt-4">
          {children}
        </div>
      )}
    </div>
  )
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: UserPreference = {
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
  const [prefs, setPrefs] = useState<UserPreference & { groupType?: string }>(DEFAULT_PREFS)
  const [isExistingSurvey, setIsExistingSurvey] = useState(false)
  const [weights, setWeights] = useState<Record<string, number> | null>(null)

  // Load survey status
  const { isLoading: isLoadingStatus } = useQuery({
    queryKey: ['pref-survey-status'],
    queryFn: async () => {
      const status = await preferenceService.getSurveyStatus()
      if (status.completed) setIsExistingSurvey(true)
      return status
    },
  })

  // Save / update
  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: UserPreference) =>
      isExistingSurvey
        ? preferenceService.updateSurvey(data)
        : preferenceService.saveSurvey(data),
    onSuccess: async () => {
      toast.success(isExistingSurvey ? 'Đã cập nhật sở thích!' : 'Đã lưu sở thích!')
      try {
        const result = await preferenceService.getWeights()
        const w: Record<string, number> =
          result && typeof result === 'object' && 'weights' in result
            ? (result as { weights: Record<string, number> }).weights
            : (result as Record<string, number>)
        setWeights(w)
      } catch { /* non-critical */ }
    },
    onError: () => toast.error('Lưu thất bại, thử lại sau'),
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

  const set = <K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }))

  // ── Loading skeleton ──────────────────────────────────────────────────────

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

  // ── Rendered form ─────────────────────────────────────────────────────────

  const budgetMinK = (prefs.budgetPerDayMin! / 1000).toFixed(0)
  const budgetMaxK = (prefs.budgetPerDayMax! / 1000).toFixed(0)

  return (
    <div className="min-h-screen bg-gray-50">
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

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-2.5 text-xs text-blue-700 bg-blue-50 rounded-xl px-3.5 py-3 border border-blue-100">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Sở thích giúp AI cá nhân hóa gợi ý địa điểm và tối ưu thứ tự ưu tiên cho mỗi chuyến đi.</span>
        </div>

        {/* 1. Mục đích chuyến đi */}
        <Section title="Mục đích chuyến đi" icon={<Target className="w-4 h-4" />} impact="high">
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
        </Section>

        {/* 2. Nhóm đi */}
        <Section title="Nhóm đi" icon={<Users className="w-4 h-4" />} impact="medium">
          <div className="flex flex-wrap gap-2">
            {GROUP_TYPES.map(({ label, emoji }) => (
              <Chip
                key={label}
                active={(prefs as { groupType?: string }).groupType === label}
                onClick={() => setPrefs((p) => ({
                  ...p,
                  groupType: (p as { groupType?: string }).groupType === label ? undefined : label,
                }))}
              >
                {emoji} {label}
              </Chip>
            ))}
          </div>
        </Section>

        {/* 3. Phong cách du lịch */}
        <Section title="Phong cách du lịch" icon={<Camera className="w-4 h-4" />} impact="high">
          <div className="flex flex-wrap gap-2">
            {TRAVEL_STYLES.map(({ label, icon: Icon }) => (
              <Chip
                key={label}
                active={(prefs.travelStyles ?? []).includes(label)}
                onClick={() => toggle('travelStyles', label)}
              >
                <Icon className="w-3 h-3" />
                {label}
              </Chip>
            ))}
          </div>
        </Section>

        {/* 4. Tốc độ di chuyển */}
        <Section title="Nhịp độ khám phá" icon={<Clock className="w-4 h-4" />} impact="high">
          <div className="grid grid-cols-3 gap-2">
            {PACE_OPTIONS.map(({ label, desc, icon: Icon }) => {
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
                  <Icon className={`w-5 h-5 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                  <span className="text-xs font-semibold">{label}</span>
                  <span className="text-[10px] text-current opacity-70">{desc}</span>
                </button>
              )
            })}
          </div>
        </Section>

        {/* 5. Ngân sách & phương tiện */}
        <Section title="Ngân sách & Di chuyển" impact="high">
          {/* Budget */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Ngân sách/ngày</label>
              <span className="text-xs font-semibold text-blue-600">
                {budgetMinK}k – {budgetMaxK}k VNĐ
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-8">Min</span>
                <input
                  type="range" min={50_000} max={2_000_000} step={50_000}
                  value={prefs.budgetPerDayMin}
                  onChange={(e) => set('budgetPerDayMin', +e.target.value)}
                  className="flex-1 accent-blue-500 h-1.5"
                  aria-label="Ngân sách tối thiểu"
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-8">Max</span>
                <input
                  type="range" min={50_000} max={5_000_000} step={50_000}
                  value={prefs.budgetPerDayMax}
                  onChange={(e) => set('budgetPerDayMax', +e.target.value)}
                  className="flex-1 accent-blue-500 h-1.5"
                  aria-label="Ngân sách tối đa"
                />
              </div>
            </div>
          </div>

          {/* Transport */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">Phương tiện ưa dùng</label>
            <div className="flex flex-wrap gap-2">
              {TRANSPORT_MODES.map(({ label, emoji }) => (
                <Chip
                  key={label}
                  active={prefs.transportMode === label}
                  onClick={() => set('transportMode', label)}
                >
                  {emoji} {label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Walking */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
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
        </Section>

        {/* 6. Ẩm thực */}
        <Section title="Hạn chế ăn uống" icon={<Utensils className="w-4 h-4" />} impact="medium" defaultOpen={false}>
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
          <p className="text-xs text-gray-400">Bỏ trống nếu không có hạn chế.</p>
        </Section>

        {/* Save button */}
        <div className="pt-2 pb-10">
          <Button
            fullWidth
            size="lg"
            loading={isPending}
            onClick={() => save(prefs)}
            id="btn-save-preferences"
          >
            {isPending ? 'Đang lưu…' : isExistingSurvey ? 'Cập nhật sở thích' : 'Lưu sở thích'}
          </Button>
        </div>

        {/* Weight visualisation */}
        {weights && Object.keys(weights).length > 0 && (
          <div className="card p-4 space-y-3 mb-10">
            <h2 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Trọng số tối ưu hoá của bạn
            </h2>
            <div className="space-y-2.5">
              {Object.entries(WEIGHT_LABELS).map(([key, label]) => {
                const value = weights[key] ?? 0
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
