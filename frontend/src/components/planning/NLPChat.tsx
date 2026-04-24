import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, RotateCcw, Sparkles } from 'lucide-react'
import type { ParsedNLPResult, NluParseResponse } from '@/types'
import { parseNLP } from '@/utils/nlpParser'
import { nluService } from '@/services/nluService'
import { NluSlotEditor } from './NluSlotEditor'
import { toast } from '@/store/toastStore'

const QUICK_PROMPTS = [
  '3 ngày Đà Lạt, cà phê và núi rừng, budget 3 triệu',
  '2 ngày Hội An, ẩm thực đường phố, đi bộ',
  '5 ngày Phú Quốc, nghỉ dưỡng biển, 10 triệu',
]

type ChatMsg =
  | { kind: 'user'; text: string }
  | { kind: 'typing' }
  | { kind: 'slots'; response: NluParseResponse; confirmed: boolean }
  | { kind: 'confirmed'; city: string }

interface Props {
  onConfirmed: (result: ParsedNLPResult) => void
}

export function NLPChat({ onConfirmed }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [hasConfirmed, setHasConfirmed] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isParsing || hasConfirmed) return

    setInput('')
    setIsParsing(true)
    setMessages(prev => [
      ...prev.filter(m => m.kind !== 'typing'),
      { kind: 'user', text },
      { kind: 'typing' },
    ])

    try {
      const nluResult = await nluService.parse(text)
      setMessages(prev => [
        ...prev.filter(m => m.kind !== 'typing'),
        { kind: 'slots', response: nluResult, confirmed: false },
      ])
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setMessages(prev => prev.filter(m => m.kind !== 'typing'))
      if (!status || status === 503) {
        const result = parseNLP(text)
        setMessages(prev => [...prev, { kind: 'confirmed', city: result.destinationCity }])
        setHasConfirmed(true)
        onConfirmed(result)
      } else {
        toast.error('Phân tích thất bại, thử lại sau')
      }
    } finally {
      setIsParsing(false)
    }
  }

  const handleConfirm = (result: ParsedNLPResult) => {
    setMessages(prev =>
      prev.map(m =>
        m.kind === 'slots' && !m.confirmed ? { ...m, confirmed: true } : m,
      ),
    )
    setMessages(prev => [...prev, { kind: 'confirmed', city: result.destinationCity }])
    setHasConfirmed(true)
    onConfirmed(result)
  }

  const handleReset = () => {
    setMessages([])
    setHasConfirmed(false)
    setInput('')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Messages area */}
      <div className="overflow-y-auto scrollbar-thin space-y-3 py-3 min-h-[180px] max-h-[380px]">
        {messages.length === 0 && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-purple-100 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-purple-500" />
            </div>
            <p className="text-xs text-gray-400">Mô tả chuyến đi của bạn bên dưới</p>
            <div className="flex flex-col gap-1.5 px-2">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => { setInput(p); textareaRef.current?.focus() }}
                  className="text-left text-xs text-blue-500 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.kind === 'user') {
            return (
              <div key={i} className="flex justify-end px-1">
                <div className="flex items-end gap-2 max-w-[85%]">
                  <div className="bg-blue-500 text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm leading-relaxed shadow-sm">
                    {msg.text}
                  </div>
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mb-0.5">
                    <User className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                </div>
              </div>
            )
          }

          if (msg.kind === 'typing') {
            return (
              <div key={i} className="flex items-end gap-2 px-1">
                <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1.5">
                  <span className="inline-flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs text-gray-500">Đang phân tích</span>
                </div>
              </div>
            )
          }

          if (msg.kind === 'slots') {
            return (
              <div key={i} className="flex items-start gap-2 px-1">
                <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <div className="flex-1 min-w-0">
                  {!msg.confirmed ? (
                    <>
                      <p className="text-xs text-gray-500 mb-1.5 font-medium">Tôi hiểu bạn muốn:</p>
                      <NluSlotEditor response={msg.response} onConfirm={handleConfirm} />
                    </>
                  ) : (
                    <div className="bg-green-50 border border-green-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-xs text-green-700">
                      Đã xác nhận! Đang tải địa điểm phù hợp...
                    </div>
                  )}
                </div>
              </div>
            )
          }

          if (msg.kind === 'confirmed') {
            return (
              <div key={i} className="flex items-start gap-2 px-1">
                <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-purple-600" />
                </div>
                <div className="bg-green-50 border border-green-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-xs text-green-700">
                  Tuyệt! Đang tìm địa điểm tại <strong>{msg.city}</strong> phù hợp với yêu cầu của bạn...
                </div>
              </div>
            )
          }

          return null
        })}

        <div ref={endRef} />
      </div>

      {/* Input area */}
      {!hasConfirmed ? (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Nhập yêu cầu chuyến đi của bạn... (Enter để gửi)"
              rows={2}
              disabled={isParsing}
              className="input flex-1 resize-none text-sm"
            />
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || isParsing}
              className="btn-primary px-3 self-end"
              aria-label="Gửi"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Nhập lại yêu cầu khác
          </button>
        </div>
      )}
    </div>
  )
}
