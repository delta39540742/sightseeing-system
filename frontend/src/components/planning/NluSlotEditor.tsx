import { useState, useRef, useEffect } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import type { NluSlots, NluParseResponse, ParsedNLPResult } from '@/types'
import {
  normaliseSlots, slotsToParsedResult,
  TAG_OPTIONS, GROUP_OPTIONS, KNOWN_CITIES,
  VIBE_OPTIONS, AMENITY_OPTIONS
} from '@/utils/normaliseNluEdit'

interface Props {
  response: NluParseResponse
  onConfirm: (result: ParsedNLPResult) => void
}

type EditKey = 'destinationCity' | 'durationDays' | 'startDate' | 'budgetTotal' | 'groupType' | 'preferredTagNames' | 'experienceKeywords' | 'vibe' | 'amenities'

const FIELD_LABEL: Record<EditKey, string> = {
  destinationCity:    'Điểm đến',
  durationDays:       'Số ngày',
  startDate:          'Ngày đi',
  budgetTotal:        'Ngân sách',
  groupType:          'Nhóm',
  preferredTagNames:  'Chủ đề',
  experienceKeywords: 'Trải nghiệm',
  vibe:               'Không khí',
  amenities:          'Tiện nghi',
}

function displayValue(key: EditKey, slots: NluSlots): string {
  switch (key) {
    case 'destinationCity':   return slots.destinationCity ?? '—'
    case 'durationDays':      return slots.durationDays != null ? `${slots.durationDays} ngày` : '—'
    case 'startDate':         return slots.startDate ?? '—'
    case 'budgetTotal':       return slots.budgetTotal != null ? `${(slots.budgetTotal / 1_000_000).toFixed(1)} triệu` : '—'
    case 'groupType':         return GROUP_OPTIONS.find((g) => g.value === slots.groupType)?.label ?? '—'
    case 'preferredTagNames': {
      const names = slots.preferredTagNames.map(
        (t) => TAG_OPTIONS.find((o) => o.value === t)?.label ?? t,
      )
      return names.length > 0 ? names.join(', ') : '—'
    }
    case 'experienceKeywords': return slots.experienceKeywords.length > 0 ? slots.experienceKeywords.join(', ') : '—'
    case 'vibe': {
      const names = slots.vibe.map(v => VIBE_OPTIONS.find(o => o.value === v)?.label ?? v)
      return names.length > 0 ? names.join(', ') : '—'
    }
    case 'amenities': {
      const names = slots.amenities.map(a => AMENITY_OPTIONS.find(o => o.value === a)?.label ?? a)
      return names.length > 0 ? names.join(', ') : '—'
    }
  }
}

function isMissing(key: EditKey, slots: NluSlots): boolean {
  switch (key) {
    case 'destinationCity':   return !slots.destinationCity
    case 'durationDays':      return slots.durationDays == null
    case 'startDate':         return !slots.startDate
    case 'budgetTotal':       return slots.budgetTotal == null
    case 'groupType':         return !slots.groupType
    case 'preferredTagNames': return slots.preferredTagNames.length === 0
    case 'experienceKeywords': return slots.experienceKeywords.length === 0
    case 'vibe':              return slots.vibe.length === 0
    case 'amenities':         return slots.amenities.length === 0
  }
}

// ─── Inline field editor ─────────────────────────────────────────────────────
// Tất cả useState phải ở top-level — không gọi trong if/switch (Rules of Hooks)

interface FieldEditorProps {
  editKey: EditKey
  slots: NluSlots
  onSave: (patch: Partial<NluSlots>) => void
  onCancel: () => void
}

function FieldEditor({ editKey, slots, onSave, onCancel }: FieldEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Khởi tạo tất cả state ở top-level (hook rules)
  const [textVal, setTextVal] = useState<string>(() => {
    if (editKey === 'destinationCity') return slots.destinationCity ?? ''
    if (editKey === 'durationDays')    return String(slots.durationDays ?? '')
    if (editKey === 'startDate')       return slots.startDate ?? ''
    if (editKey === 'budgetTotal')     return slots.budgetTotal != null ? String(slots.budgetTotal / 1_000_000) : ''
    if (editKey === 'groupType')       return slots.groupType ?? ''
    if (editKey === 'experienceKeywords') return slots.experienceKeywords.join(', ')
    return ''
  })
  const [tagsVal, setTagsVal] = useState<string[]>(() => {
    if (editKey === 'preferredTagNames') return [...slots.preferredTagNames]
    if (editKey === 'vibe') return [...slots.vibe]
    if (editKey === 'amenities') return [...slots.amenities]
    return []
  })

  useEffect(() => { inputRef.current?.focus() }, [])

  const toggleTag = (v: string) =>
    setTagsVal((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])

  const handleTextKey = (e: React.KeyboardEvent, patch: Partial<NluSlots>) => {
    if (e.key === 'Enter') { e.preventDefault(); onSave(patch) }
    if (e.key === 'Escape') onCancel()
  }

  const btnCheck = (patch: Partial<NluSlots>) => (
    <button type="button" onClick={() => onSave(patch)} className="p-1 text-green-600 hover:bg-green-50 rounded" aria-label="Xác nhận">
      <Check className="w-3.5 h-3.5" />
    </button>
  )
  const btnCancel = (
    <button type="button" onClick={onCancel} className="p-1 text-gray-400 hover:bg-gray-100 rounded" aria-label="Huỷ">
      <X className="w-3.5 h-3.5" />
    </button>
  )

  if (editKey === 'destinationCity') {
    return (
      <div className="flex items-center gap-1 mt-1">
        <input
          ref={inputRef}
          list="nlu-cities"
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => handleTextKey(e, { destinationCity: textVal })}
          className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
          placeholder="Đà Nẵng, Đà Lạt…"
        />
        <datalist id="nlu-cities">
          {KNOWN_CITIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        {btnCheck({ destinationCity: textVal })}
        {btnCancel}
      </div>
    )
  }

  if (editKey === 'durationDays') {
    return (
      <div className="flex items-center gap-1 mt-1">
        <input
          ref={inputRef}
          type="number" min={1} max={30}
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => handleTextKey(e, { durationDays: Number(textVal) })}
          className="w-20 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="text-xs text-gray-500">ngày</span>
        {btnCheck({ durationDays: Number(textVal) })}
        {btnCancel}
      </div>
    )
  }

  if (editKey === 'startDate') {
    return (
      <div className="flex items-center gap-1 mt-1">
        <input
          ref={inputRef}
          type="date"
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => handleTextKey(e, { startDate: textVal })}
          className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
        />
        {btnCheck({ startDate: textVal })}
        {btnCancel}
      </div>
    )
  }

  if (editKey === 'budgetTotal') {
    return (
      <div className="flex items-center gap-1 mt-1">
        <input
          ref={inputRef}
          type="number" min={0.1} step={0.5}
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          onKeyDown={(e) => handleTextKey(e, { budgetTotal: parseFloat(textVal) * 1_000_000 })}
          className="w-24 px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="text-xs text-gray-500">triệu</span>
        {btnCheck({ budgetTotal: parseFloat(textVal) * 1_000_000 })}
        {btnCancel}
      </div>
    )
  }

  if (editKey === 'groupType') {
    return (
      <div className="mt-1 space-y-1">
        <div className="flex flex-wrap gap-1">
          {GROUP_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setTextVal(g.value)}
              className={`px-2 py-0.5 rounded text-xs border transition-colors
                ${textVal === g.value
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-300 text-gray-600 hover:border-blue-300'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {btnCheck({ groupType: textVal as NluSlots['groupType'] })}
          {btnCancel}
        </div>
      </div>
    )
  }

  if (editKey === 'preferredTagNames' || editKey === 'vibe' || editKey === 'amenities') {
    const options = editKey === 'preferredTagNames' ? TAG_OPTIONS : (editKey === 'vibe' ? VIBE_OPTIONS : AMENITY_OPTIONS)
    return (
      <div className="mt-1 space-y-1">
        <div className="flex flex-wrap gap-1">
          {options.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => toggleTag(t.value)}
              className={`px-2 py-0.5 rounded text-xs border transition-colors
                ${tagsVal.includes(t.value)
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-gray-300 text-gray-600 hover:border-blue-300'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {btnCheck({ [editKey]: tagsVal })}
          {btnCancel}
        </div>
      </div>
    )
  }

  if (editKey === 'experienceKeywords') {
    return (
      <div className="flex flex-col gap-1 mt-1">
        <textarea
          autoFocus
          value={textVal}
          onChange={(e) => setTextVal(e.target.value)}
          className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 h-20"
          placeholder="Cách nhau bằng dấu phẩy..."
        />
        <div className="flex gap-1">
          {btnCheck({ experienceKeywords: textVal.split(',').map(s => s.trim()).filter(Boolean) })}
          {btnCancel}
        </div>
      </div>
    )
  }

  return null
}

// ─── Main component ──────────────────────────────────────────────────────────

const FIELDS: EditKey[] = [
  'destinationCity', 'durationDays', 'startDate',
  'budgetTotal', 'groupType', 'preferredTagNames', 
  'vibe', 'amenities', 'experienceKeywords',
]

export function NluSlotEditor({ response, onConfirm }: Props) {
  const [slots, setSlots]   = useState<NluSlots>(() => normaliseSlots(response.slots))
  const [editing, setEditing] = useState<EditKey | null>(null)

  const handleSave = (patch: Partial<NluSlots>) => {
    // Mỗi lần user sửa đều qua normaliseSlots — đảm bảo an toàn dữ liệu, không cần AI
    setSlots(normaliseSlots({ ...slots, ...patch }))
    setEditing(null)
  }

  const missing = FIELDS.filter((k) => isMissing(k, slots))

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-700">Kết quả phân tích</span>
        <span className="text-xs text-gray-400">
          độ tin cậy {Math.round(response.confidence * 100)}%
        </span>
      </div>

      <div className="divide-y divide-gray-100">
        {FIELDS.map((key) => (
          <div key={key} className="py-1.5">
            {/* Display row — pencil luôn hiển thị để user biết có thể sửa */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 shrink-0">{FIELD_LABEL[key]}</span>
              <span className={`text-xs flex-1 font-medium truncate
                ${isMissing(key, slots) ? 'text-amber-500 italic' : 'text-gray-800'}`}
              >
                {displayValue(key, slots)}
              </span>
              {editing !== key && (
                <button
                  type="button"
                  onClick={() => setEditing(key)}
                  aria-label={`Sửa ${FIELD_LABEL[key]}`}
                  className="shrink-0 p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Inline editor — hiện khi đang sửa trường này */}
            {editing === key && (
              <FieldEditor
                editKey={key}
                slots={slots}
                onSave={handleSave}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <p className="text-xs text-amber-600 pt-1 border-t border-amber-100">
          Chưa rõ: {missing.map((k) => FIELD_LABEL[k]).join(', ')} — nhấn ✏ để bổ sung.
        </p>
      )}

      <button
        type="button"
        onClick={() => onConfirm(slotsToParsedResult(slots))}
        className="btn-primary w-full py-2 text-xs"
      >
        Xác nhận
      </button>
    </div>
  )
}
