import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Bell, CheckCheck, Trash2, AlertTriangle, Calendar, RefreshCw, CheckCircle2, Info } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useNotifications } from '@/hooks/useNotifications'
import type { AppNotification, NotificationType } from '@/services/notificationService'

interface Props {
  open: boolean
  onClose: () => void
}

const iconFor = (type: NotificationType) => {
  switch (type) {
    case 'incident_detected':   return <AlertTriangle className="w-5 h-5 text-orange-500" />
    case 'replan_proposal':     return <RefreshCw className="w-5 h-5 text-blue-500" />
    case 'replan_accepted':     return <CheckCircle2 className="w-5 h-5 text-green-500" />
    case 'replan_rejected':     return <X className="w-5 h-5 text-gray-400" />
    case 'trip_starting_soon':  return <Calendar className="w-5 h-5 text-blue-500" />
    default:                    return <Info className="w-5 h-5 text-gray-400" />
  }
}

export function NotificationDrawer({ open, onClose }: Props) {
  const navigate = useNavigate()
  const { items, unreadCount, isLoading, markRead, markAllRead, remove, clear } = useNotifications()
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    closeBtnRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleItemClick = (n: AppNotification) => {
    if (!n.readAt) markRead(n.notificationId)
    if (n.tripId) {
      onClose()
      navigate(`/trip/${n.tripId}`)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-50 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Lịch sử thông báo"
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Thông báo</h2>
            {unreadCount > 0 && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {unreadCount} mới
              </span>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg"
            aria-label="Đóng"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </header>

        {items.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 text-xs text-gray-500 shrink-0">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="inline-flex items-center gap-1 hover:text-blue-600"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Đánh dấu đã đọc
              </button>
            )}
            <span className="ml-auto" />
            <button
              onClick={() => { if (confirm('Xoá toàn bộ thông báo?')) clear() }}
              className="inline-flex items-center gap-1 hover:text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Xoá tất cả
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Đang tải...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Chưa có thông báo nào</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {items.map((n) => {
                const isUnread = !n.readAt
                return (
                  <li
                    key={n.notificationId}
                    className={`flex gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${isUnread ? 'bg-blue-50/40' : ''}`}
                    onClick={() => handleItemClick(n)}
                  >
                    <div className="shrink-0 mt-0.5">{iconFor(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {n.title}
                        </h3>
                        {isUnread && <span className="w-2 h-2 bg-blue-500 rounded-full shrink-0" aria-label="Chưa đọc" />}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true, locale: vi })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(n.notificationId) }}
                      className="shrink-0 p-1 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100"
                      aria-label="Xoá"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
