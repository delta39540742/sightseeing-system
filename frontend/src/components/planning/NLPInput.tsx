import { useState, useEffect, useRef } from 'react'
import { Mic, Sparkles } from 'lucide-react'
import type { ParsedNLPResult } from '@/types'
import { parseNLP } from '@/utils/nlpParser'

const PLACEHOLDERS = [
  '3 ngày ở Đà Lạt, thích cà phê và núi rừng, budget 3 triệu…',
  '2 ngày Hội An, ẩm thực đường phố, đi bộ nhiều…',
  'Tuần trăng mật 5 ngày Phú Quốc, nghỉ dưỡng, budget 10 triệu…',
  '4 ngày Đà Nẵng, thích chụp ảnh và biển đẹp…',
]

interface NLPInputProps {
  onParsed: (result: ParsedNLPResult) => void
  isLoading?: boolean
}

export function NLPInput({ onParsed, isLoading }: NLPInputProps) {
  const [value, setValue] = useState('')
  const [phIndex, setPhIndex] = useState(0)
  const [hasInteracted, setHasInteracted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (hasInteracted) return
    const interval = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 3000)
    return () => clearInterval(interval)
  }, [hasInteracted])

  const handleSubmit = () => {
    if (!value.trim()) return
    const result = parseNLP(value)
    onParsed(result)
  }

  const handleQuickFill = (ph: string) => {
    setValue(ph.replace('…', ''))
    setHasInteracted(true)
    textareaRef.current?.focus()
    setTimeout(() => onParsed(parseNLP(ph)), 100)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setHasInteracted(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
          }}
          placeholder={PLACEHOLDERS[phIndex]}
          rows={3}
          className="input resize-none pr-24 text-sm leading-relaxed"
          aria-label="Nhập yêu cầu chuyến đi"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || isLoading}
          className="absolute right-3 bottom-3 btn-primary px-3 py-1.5 text-xs"
          aria-label="Phân tích yêu cầu"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Phân tích
        </button>
      </div>

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
