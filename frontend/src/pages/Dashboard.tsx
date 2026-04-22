import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, MapPin, Calendar, ChevronRight, User } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { TripCardSkeleton } from '@/components/ui/Skeleton'
import type { Trip } from '@/types'

const statusLabels: Record<Trip['status'], { label: string; color: string }> = {
  draft:     { label: 'Nháp',           color: 'bg-gray-100 text-gray-600' },
  active:    { label: 'Đang diễn ra',   color: 'bg-green-100 text-green-700' },
  confirmed: { label: 'Đang lên kế hoạch', color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Đã hoàn thành',  color: 'bg-purple-100 text-purple-700' },
  cancelled: { label: 'Đã hủy',         color: 'bg-red-100 text-red-600' },
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, openLoginDrawer } = useAuthStore()

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: tripService.list,
    enabled: !!user,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="font-bold text-lg text-gray-900">✈️ TravelSystem</h1>
          <button
            onClick={() => user ? navigate('/profile') : openLoginDrawer()}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label={user ? 'Trang cá nhân' : 'Đăng nhập'}
          >
            {user?.photoURL
              ? <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" />
              : <User className="w-5 h-5 text-gray-500" />
            }
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {!user && (
          <div className="card p-4 flex items-center gap-3 bg-blue-50 border-blue-200">
            <div className="flex-1 text-sm text-blue-800">
              Lưu kế hoạch vĩnh viễn — Đăng nhập chỉ mất 10 giây
            </div>
            <button onClick={openLoginDrawer} className="btn-primary text-xs py-1.5 shrink-0">
              Đăng nhập
            </button>
          </div>
        )}

        <button
          onClick={() => navigate('/plan')}
          className="card w-full p-5 flex items-center gap-4 hover:shadow-md transition-shadow border-dashed border-2 border-blue-200 bg-blue-50/50"
        >
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <Plus className="w-6 h-6 text-blue-500" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-blue-700">Lập kế hoạch mới</p>
            <p className="text-sm text-blue-500">Nhập yêu cầu bằng ngôn ngữ tự nhiên</p>
          </div>
        </button>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <TripCardSkeleton key={i} />)}
          </div>
        )}

        {trips && trips.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Chưa có chuyến đi nào</p>
            <p className="text-sm mt-1">Nhấn "+ Lập kế hoạch mới" để bắt đầu</p>
          </div>
        )}

        {trips && trips.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm">Chuyến đi của bạn</h2>
            {trips.map((trip) => {
              const status = statusLabels[trip.status]
              return (
                <button
                  key={trip.tripId}
                  onClick={() => navigate(`/trip/${trip.tripId}`)}
                  className="card w-full p-4 hover:shadow-md transition-shadow text-left flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-xl shrink-0">
                    ✈️
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {trip.title ?? trip.destinationCity}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Calendar className="w-3 h-3" />
                        {format(parseISO(trip.startDate), 'dd/MM', { locale: vi })}
                        {' – '}
                        {format(parseISO(trip.endDate), 'dd/MM/yyyy', { locale: vi })}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
