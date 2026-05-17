import { useEffect } from 'react'
import { useToastStore } from '@/store/toastStore'
import { X, CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react'
import type { Toast } from '@/types'

const config: Record<Toast['type'], { icon: React.ReactNode; bg: string; text: string; bar: string }> = {
  success: {
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
    bg: 'bg-white border-emerald-200',
    text: 'text-gray-800',
    bar: 'bg-emerald-400',
  },
  error: {
    icon: <XCircle className="w-4 h-4 text-red-500 shrink-0" />,
    bg: 'bg-white border-red-200',
    text: 'text-gray-800',
    bar: 'bg-red-400',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
    bg: 'bg-white border-amber-200',
    text: 'text-gray-800',
    bar: 'bg-amber-400',
  },
  info: {
    icon: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
    bg: 'bg-white border-blue-200',
    text: 'text-gray-800',
    bar: 'bg-blue-400',
  },
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  const c = config[toast.type]

  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), 4800)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])

  return (
    <div
      role="alert"
      className={`
        pointer-events-auto relative overflow-hidden
        flex items-start gap-3 px-4 py-3
        rounded-xl border shadow-lg
        ${c.bg} animate-slideUp
      `}
    >
      {/* Left colour bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${c.bar} rounded-l-xl`} />

      <span className="pl-2">{c.icon}</span>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${c.text}`}>{toast.message}</p>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 mt-1"
          >
            {toast.action.label} →
          </button>
        )}
      </div>

      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Đóng thông báo"
        className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors mt-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-24 md:bottom-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}
