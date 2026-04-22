import { useToastStore } from '@/store/toastStore'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'

const icons = {
  success: <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />,
  error:   <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />,
  info:    <Info className="w-4 h-4 text-blue-500 shrink-0" />,
}

const bg = {
  success: 'bg-green-50 border-green-200',
  error:   'bg-red-50 border-red-200',
  warning: 'bg-yellow-50 border-yellow-200',
  info:    'bg-blue-50 border-blue-200',
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore()

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg animate-fadeIn ${bg[t.type]}`}
        >
          {icons[t.type]}
          <span className="flex-1 text-sm text-gray-800">{t.message}</span>
          {t.action && (
            <button
              onClick={t.action.onClick}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 shrink-0"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Đóng thông báo"
            className="shrink-0 text-gray-400 hover:text-gray-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
