import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Brain, History, Sliders, Save, RotateCcw,
  Heart, ThumbsUp, ThumbsDown, Star, MapPin, Zap, CheckCircle2, Camera,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { preferenceService } from '@/services/preferenceService'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'

// ─── ARM display names ────────────────────────────────────────────────────────

const ARM_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  balanced:    { label: 'Cân bằng',     desc: 'Tất cả yếu tố quan trọng như nhau',   color: 'bg-blue-100 text-blue-700' },
  interest:    { label: 'Sở thích',     desc: 'Ưu tiên địa điểm phù hợp sở thích',   color: 'bg-violet-100 text-violet-700' },
  pace:        { label: 'Nhịp độ',      desc: 'Tối ưu thời gian di chuyển và nghỉ',  color: 'bg-orange-100 text-orange-700' },
  budget:      { label: 'Tiết kiệm',    desc: 'Ưu tiên chi phí thấp nhất',           color: 'bg-green-100 text-green-700' },
  exploration: { label: 'Khám phá',     desc: 'Ưu tiên địa điểm mới lạ, ít biết',   color: 'bg-pink-100 text-pink-700' },
  safe:        { label: 'An toàn',      desc: 'Ưu tiên địa điểm quen thuộc, ổn định', color: 'bg-gray-100 text-gray-700' },
}

// ─── Interaction type display ─────────────────────────────────────────────────

const INTERACTION_META: Record<string, { label: string; icon: React.ElementType; color: string; effect: 'positive' | 'negative' | 'neutral' }> = {
  poi_favorited:      { label: 'Yêu thích',        icon: Heart,         color: 'text-red-400',    effect: 'positive' },
  poi_rated:          { label: 'Đánh giá',          icon: Star,          color: 'text-yellow-400', effect: 'positive' },
  poi_accepted:       { label: 'Chấp nhận',         icon: ThumbsUp,      color: 'text-green-500',  effect: 'positive' },
  poi_rejected:       { label: 'Từ chối',           icon: ThumbsDown,    color: 'text-red-400',    effect: 'negative' },
  slot_completed:     { label: 'Hoàn thành slot',   icon: CheckCircle2,  color: 'text-emerald-500', effect: 'positive' },
  replan_accepted:    { label: 'Duyệt đổi lịch',   icon: Zap,           color: 'text-violet-500', effect: 'positive' },
  replan_rejected:    { label: 'Từ chối đổi lịch', icon: Zap,           color: 'text-gray-400',   effect: 'negative' },
  landmark_recognized:{ label: 'Nhận diện địa điểm', icon: Camera,      color: 'text-blue-400',   effect: 'neutral' },
  manual_vector_edit: { label: 'Chỉnh tay',        icon: Sliders,       color: 'text-gray-500',   effect: 'neutral' },
}

function getInteractionMeta(type: string) {
  return INTERACTION_META[type] ?? { label: type, icon: MapPin, color: 'text-gray-400', effect: 'neutral' as const }
}

// ─── Tag color by value ───────────────────────────────────────────────────────

function tagBarColor(value: number) {
  if (value >= 0.7) return 'bg-violet-500'
  if (value >= 0.4) return 'bg-blue-400'
  return 'bg-gray-300'
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PreferenceProfile() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [editMode, setEditMode] = useState(false)
  const [draftVector, setDraftVector] = useState<number[]>([])
  const [showAll, setShowAll] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['preference-profile'],
    queryFn: () => preferenceService.getProfile(30),
    enabled: !!user,
  })

  const saveMutation = useMutation({
    mutationFn: () => preferenceService.updateVector(draftVector),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preference-profile'] })
      setEditMode(false)
      toast.success('Đã lưu sở thích')
    },
    onError: () => toast.error('Lưu thất bại, thử lại'),
  })

  const selectArmMutation = useMutation({
    mutationFn: (armId: number) => preferenceService.selectArm(armId),
    onSuccess: (_data, armId) => {
      queryClient.invalidateQueries({ queryKey: ['preference-profile'] })
      const name = data?.arms.find((a) => a.armId === armId)?.name ?? ''
      toast.success(`Đã chuyển sang: ${ARM_LABELS[name]?.label ?? name}`)
    },
    onError: () => toast.error('Chuyển chiến lược thất bại'),
  })

  const handleEnterEdit = () => {
    setDraftVector(data?.preferenceVector.map((t) => t.value) ?? [])
    setEditMode(true)
  }

  const handleCancelEdit = () => {
    setEditMode(false)
    setDraftVector([])
  }

  const visibleInteractions = showAll
    ? (data?.interactions ?? [])
    : (data?.interactions ?? []).slice(0, 10)

  // ─── Loading / Error ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Brain className="w-10 h-10 text-violet-400 mx-auto animate-pulse" />
          <p className="text-sm text-gray-500">Đang tải hồ sơ sở thích...</p>
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">Chưa có dữ liệu sở thích. Hãy làm khảo sát trước.</p>
          <button onClick={() => navigate('/preferences')} className="btn-primary text-sm">
            Làm khảo sát
          </button>
        </div>
      </div>
    )
  }

  const activeArm = data.arms.find((a) => a.isActive)
  const totalPulls = data.arms.reduce((s, a) => s + a.pulls, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-gray-900 text-sm">Hồ sơ sở thích</h1>
          <p className="text-xs text-gray-400">Hệ thống học từ hành vi của bạn</p>
        </div>
        <Brain className="w-5 h-5 text-violet-400" />
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-5">

        {/* ── Section 1: Preference vector ───────────────────────────────── */}
        <div className="card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center">
                <Brain className="w-4 h-4 text-violet-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">Sở thích học được</p>
                <p className="text-xs text-gray-400">Cập nhật mỗi khi bạn tương tác</p>
              </div>
            </div>
            {!editMode ? (
              <button
                onClick={handleEnterEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                Chỉnh tay
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Huỷ
                </button>
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-violet-500 hover:bg-violet-600 rounded-lg transition-colors disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {data.preferenceVector.map((tag, i) => {
              const val = editMode ? (draftVector[i] ?? tag.value) : tag.value
              const pct = Math.round(val * 100)
              return (
                <div key={tag.tagId} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">{tag.label}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{pct}%</span>
                  </div>
                  {editMode ? (
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(e) => {
                        const next = [...draftVector]
                        next[i] = parseInt(e.target.value) / 100
                        setDraftVector(next)
                      }}
                      className="w-full h-2 appearance-none rounded-full bg-gray-200 accent-violet-500 cursor-pointer"
                    />
                  ) : (
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${tagBarColor(val)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {editMode && (
            <p className="text-xs text-gray-400 text-center pt-1">
              Kéo thanh để điều chỉnh. Hệ thống sẽ dùng các giá trị này cho đề xuất tiếp theo.
            </p>
          )}
        </div>

        {/* ── Section 2: UCB1 arm selection ──────────────────────────────── */}
        <div className="card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
              <Zap className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Chiến lược lập kế hoạch</p>
              <p className="text-xs text-gray-400">Bấm để chọn · UCB1 tự điều chỉnh sau mỗi tương tác</p>
            </div>
          </div>

          {/* Arm cards — 2-col grid */}
          <div className="grid grid-cols-2 gap-2">
            {data.arms.map((arm) => {
              const meta = ARM_LABELS[arm.name]
              const isActive = arm.isActive
              const isPending = selectArmMutation.isPending
              return (
                <button
                  key={arm.armId}
                  onClick={() => !isActive && selectArmMutation.mutate(arm.armId)}
                  disabled={isPending || isActive}
                  className={[
                    'relative text-left rounded-xl p-3 border-2 transition-all duration-150',
                    isActive
                      ? 'border-violet-400 bg-violet-50'
                      : 'border-gray-200 bg-white hover:border-violet-200 hover:bg-violet-50/40 active:scale-[0.98]',
                    isPending && !isActive ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 text-[9px] font-bold bg-violet-500 text-white px-1.5 py-0.5 rounded-full">
                      Đang dùng
                    </span>
                  )}
                  <p className={`text-xs font-semibold mb-0.5 ${isActive ? 'text-violet-700' : 'text-gray-800'}`}>
                    {meta?.label ?? arm.name}
                  </p>
                  <p className="text-[10px] text-gray-500 leading-snug line-clamp-2">
                    {meta?.desc ?? ''}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-1.5 tabular-nums">
                    {arm.pulls} lần · avg {arm.avgReward}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Pull distribution bars */}
          {data.arms.length > 0 && totalPulls > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-[10px] text-gray-400 font-medium">Phân bố lượt chọn</p>
              {data.arms.map((arm) => {
                const pullPct = Math.round((arm.pulls / totalPulls) * 100)
                return (
                  <div key={arm.armId} className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 w-16 shrink-0">
                      {ARM_LABELS[arm.name]?.label ?? arm.name}
                    </span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${arm.isActive ? 'bg-violet-400' : 'bg-gray-300'}`}
                        style={{ width: `${pullPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 tabular-nums w-7 text-right">{pullPct}%</span>
                  </div>
                )
              })}
            </div>
          )}

          {data.arms.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">
              Chưa có dữ liệu chiến lược. Hãy tương tác với hệ thống nhiều hơn.
            </p>
          )}
        </div>

        {/* ── Section 3: Interaction history ─────────────────────────────── */}
        <div className="card overflow-hidden">
          <div className="p-4 flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center">
              <History className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Lịch sử tương tác</p>
              <p className="text-xs text-gray-400">
                {data.interactions.length} sự kiện gần đây
              </p>
            </div>
          </div>

          {data.interactions.length === 0 ? (
            <div className="px-4 pb-5 text-center text-gray-400 text-sm">
              Chưa có lịch sử. Hãy tương tác với địa điểm để bắt đầu học.
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {visibleInteractions.map((item) => {
                const meta = getInteractionMeta(item.interactionType)
                const Icon = meta.icon
                const effectColor =
                  meta.effect === 'positive' ? 'text-emerald-400' :
                  meta.effect === 'negative' ? 'text-red-400' :
                  'text-gray-300'
                return (
                  <div key={item.interactionId} className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center shrink-0`}>
                      <Icon className={`w-4 h-4 ${meta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-700">{meta.label}</span>
                        {meta.effect !== 'neutral' && (
                          <span className={`text-[10px] font-semibold ${effectColor}`}>
                            {meta.effect === 'positive' ? '↑ học tích cực' : '↓ học tránh'}
                          </span>
                        )}
                      </div>
                      {item.placeName && (
                        <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {item.placeName}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                      {format(parseISO(item.createdAt), 'dd/MM HH:mm', { locale: vi })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {data.interactions.length > 10 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                {showAll ? 'Thu gọn' : `Xem thêm ${data.interactions.length - 10} sự kiện`}
              </button>
            </div>
          )}
        </div>

        {/* ── Footer note ─────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-gray-400 pb-6">
          Hệ thống học liên tục từ mỗi lượt yêu thích, đánh giá và lựa chọn của bạn.
        </p>
      </div>
    </div>
  )
}
