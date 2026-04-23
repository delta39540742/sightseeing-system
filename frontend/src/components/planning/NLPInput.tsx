import { useState, useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { format, addDays, parseISO } from 'date-fns'
import type { ParsedNLPResult, NluParseResponse } from '@/types'
import { parseNLP } from '@/utils/nlpParser'
import { nluService } from '@/services/nluService'
import { toast } from '@/store/toastStore'

const PLACEHOLDERS = [
  '3 ngày ở Đà Lạt, thích cà phê và núi rừng, budget 3 triệu…',
  '2 ngày Hội An, ẩm thực đường phố, đi bộ nhiều…',
  'Tuần trăng mật 5 ngày Phú Quốc, nghỉ dưỡng, budget 10 triệu…',
  '4 ngày Đà Nẵng, thích chụp ảnh và biển đẹp…',
]

const SLOT_LABELS: Record<string, string> = {
  destinationCity: 'điểm đến',
  durationDays: 'số ngày',
  startDate: 'ngày đi',
  budgetTotal: 'ngân sách',
  groupType: 'loại nhóm',
}

function mapNluToParseResult(r: NluParseResponse): ParsedNLPResult {
  const today = new Date()
  const days = r.slots.durationDays ?? 3
  const startStr = r.slots.startDate ?? format(today, 'yyyy-MM-dd')
  return {
    destinationCity: r.slots.destinationCity ?? 'Đà Nẵng',
    days,
    budget: r.slots.budgetTotal ?? 3_000_000,
    styles: r.slots.preferredTagNames ?? [],
    startDate: startStr,
    endDate: format(addDays(parseISO(startStr), days - 1), 'yyyy-MM-dd'),
  }
}

interface NLPInputProps {
  onParsed: (result: ParsedNLPResult) => void
  isLoading?: boolean
}

export function NLPInput({ onParsed, isLoading: externalLoading }: NLPInputProps) {
  const [value, setValue] = useState('')
  const [phIndex, setPhIndex] = useState(0)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [missingSlots, setMissingSlots] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isLoading = externalLoading || isParsing

  useEffect(() => {
    if (hasInteracted) return () => {}
    const interval = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 3000)
    return () => clearInterval(interval)
  }, [hasInteracted])

  const handleSubmit = async () => {
    if (!value.trim()) return
    setIsParsing(true)
    setMissingSlots([])
    try {
      const nluResult = await nluService.parse(value)
      if (nluResult.missingSlots.length > 0) setMissingSlots(nluResult.missingSlots)
      onParsed(mapNluToParseResult(nluResult))
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      // 503 = Colab NLU đang down — fallback về local parser
      if (!status || status === 503) {
        onParsed(parseNLP(value))
      } else {
        toast.error('Phân tích thất bại, thử lại sau')
      }
    } finally {
      setIsParsing(false)
    }
  }

  const handleQuickFill = (ph: string) => {
    setValue(ph.replace('…', ''))
    setHasInteracted(true)
    setMissingSlots([])
    textareaRef.current?.focus()
    setTimeout(() => void handleSubmit(), 100)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setHasInteracted(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit() }
          }}
          placeholder={PLACEHOLDERS[phIndex]}
          rows={3}
          className="input resize-none pr-24 text-sm leading-relaxed"
          aria-label="Nhập yêu cầu chuyến đi"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!value.trim() || isLoading}
          className="absolute right-3 bottom-3 btn-primary px-3 py-1.5 text-xs"
          aria-label="Phân tích yêu cầu"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isParsing ? 'Đang phân tích…' : 'Phân tích'}
        </button>
      </div>

      {missingSlots.length > 0 && (
        <p className="text-xs text-amber-600">
          Chưa rõ: {missingSlots.map((s) => SLOT_LABELS[s] ?? s).join(', ')} — hãy bổ sung vào form bên dưới.
        </p>
      )}

      {!hasInteracted && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Thử ngay:</p>
          <div className="flex flex-wrap gap-2">
            {PLACEHOLDERS.slice(0, 3).map((ph) => (
              <button
                key={ph}
                onClick={() => handleQuickFill(ph)}
                className="chip chip-inactive text-xs max-w-[200px] truncate"
              >
                {ph}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
