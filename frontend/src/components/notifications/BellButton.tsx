import { Bell } from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import { useNotificationDrawer } from '@/store/notificationDrawerStore'

interface Props {
  className?: string
  iconClassName?: string
}

export function BellButton({ className, iconClassName }: Props) {
  const { unreadCount } = useNotifications()
  const show = useNotificationDrawer((s) => s.show)

  return (
    <button
      onClick={show}
      aria-label={unreadCount > 0 ? `Thông báo (${unreadCount} chưa đọc)` : 'Thông báo'}
      className={`relative ${className ?? 'p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors'}`}
    >
      <Bell className={iconClassName ?? 'w-5 h-5'} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
