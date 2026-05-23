import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MapPin, Calendar, ChevronRight, User, Trash2 } from 'lucide-react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { vi } from 'date-fns/locale'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { toast } from '@/store/toastStore'
import { TripCardSkeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { Trip, TripStatus } from '@/types'

const statusLabels: Record<Trip['status'], { label: string; color: string }> = {
  draft:     { label: 'Nháp',              color: 'bg-gray-100 text-gray-600' },
  active:    { label: 'Đang diễn ra',      color: 'bg-green-100 text-green-700' },
  confirmed: { label: 'Đang lên kế hoạch', color: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Đã hoàn thành',     color: 'bg-purple-100 text-purple-700' },
  cancelled: { label: 'Đã hủy',            color: 'bg-red-100 text-red-600' },
}

function getDisplayStatus(trip: Trip): { label: string; color: string } {
  if (trip.status === 'draft' && trip.slots && trip.slots.length > 0) {
    return { label: 'Đã lên kế hoạch', color: 'bg-blue-100 text-blue-700' }
  }
  return statusLabels[trip.status]
}

const TABS = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'active',    label: 'Đang diễn ra' },
  { key: 'confirmed', label: 'Đã xác nhận' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'cancelled', label: 'Đã huỷ' },
] as const

export default function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, openLoginDrawer } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = (searchParams.get('filter') ?? 'all') as TripStatus | 'all'
  const setFilter = (f: TripStatus | 'all') =>
    setSearchParams(f === 'all' ? {} : { filter: f }, { replace: true })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: tripService.list,
    enabled: !!user,
  })

  const deleteMutation = useMutation({
    mutationFn: tripService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.success('Đã xóa chuyến đi thành công')
      setDeletingId(null)
    },
    onError: () => {
      toast.error('Không thể xóa chuyến đi, vui lòng thử lại sau')
      setDeletingId(null)
    }
  })

  const filtered = filter === 'all' ? trips : trips?.filter(t => t.status === filter)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate('/')} className="font-bold text-lg text-gray-900 hover:text-blue-600 transition-colors">✈️ TravelSystem</button>
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

        {!user && !isLoading && (
          <div className="text-center py-16 text-gray-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-gray-500">Đăng nhập để xem chuyến đi của bạn</p>
            <p className="text-sm mt-1">Lưu và quản lý tất cả kế hoạch du lịch</p>
            <button
              onClick={openLoginDrawer}
              className="mt-4 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              Đăng nhập ngay
            </button>
          </div>
        )}

        {user && trips && trips.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-blue-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {user && trips && trips.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Chưa có chuyến đi nào</p>
            <p className="text-sm mt-1">Nhấn "+ Lập kế hoạch mới" để bắt đầu</p>
          </div>
        )}

        {user && filtered && filtered.length === 0 && trips && trips.length > 0 && (
          <div className="text-center py-12 text-gray-400">
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Không có chuyến đi nào phù hợp</p>
            <p className="text-sm mt-1">Thử chọn bộ lọc khác</p>
          </div>
        )}

        {filtered && filtered.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-700 text-sm">Chuyến đi của bạn</h2>
            {filtered.map((trip) => {
              const status = getDisplayStatus(trip)
              const numDays = differenceInDays(parseISO(trip.endDate), parseISO(trip.startDate)) + 1
              const numSlots = trip.slots?.length ?? 0
              const budgetDisplay = trip.budgetTotal > 0
                ? trip.budgetTotal >= 1_000_000
                  ? `${(trip.budgetTotal / 1_000_000).toFixed(1).replace('.0', '')} tr đ`
                  : `${(trip.budgetTotal / 1000).toFixed(0)}k đ`
                : null
              return (
                <div
                  key={trip.tripId}
                  onClick={() =>
                    navigate(trip.status === 'active' ? `/trip/${trip.tripId}/live` : `/trip/${trip.tripId}`)
                  }
                  className="card w-full p-4 hover:shadow-md transition-shadow text-left cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-lg shrink-0">
                      ✈️
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-900 truncate text-sm">
                          {trip.title ?? trip.destinationCity}
                        </p>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                        <Calendar className="w-3 h-3" />
                        {format(parseISO(trip.startDate), 'dd/MM', { locale: vi })}
                        {' – '}
                        {format(parseISO(trip.endDate), 'dd/MM/yyyy', { locale: vi })}
                      </span>
                    </div>
                  </div>

                  {(numDays > 0 || numSlots > 0 || budgetDisplay) && (
                    <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-gray-100">
                      {numDays > 0 && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                          🗓 {numDays} ngày
                        </span>
                      )}
                      {numSlots > 0 && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                          📍 {numSlots} địa điểm
                        </span>
                      )}
                      {budgetDisplay && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                          💰 {budgetDisplay}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingId(trip.tripId) }}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Xóa chuyến đi"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      </div>
                    </div>
                  )}

                  {numSlots === 0 && !budgetDisplay && (
                    <div className="flex items-center justify-end mt-2 gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingId(trip.tripId) }}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Xóa chuyến đi"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      <Modal
        open={!!deletingId}
        onClose={() => setDeletingId(null)}
        title="Chuyển vào thùng rác"
        description="Chuyến đi sẽ được chuyển vào thùng rác. Bạn có thể khôi phục hoặc xóa vĩnh viễn trong trang cá nhân."
        size="sm"
        footer={
          <>
            <button
              onClick={() => setDeletingId(null)}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              disabled={deleteMutation.isPending}
            >
              Hủy
            </button>
            <button
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Đang xóa...' : 'Chuyển vào thùng rác'}
            </button>
          </>
        }
      >
        <div className="text-sm text-gray-500">
          Chuyến đi sẽ bị ẩn khỏi danh sách. Vào <strong>Trang cá nhân → Thùng rác</strong> để khôi phục hoặc xóa vĩnh viễn.
        </div>
      </Modal>
    </div>
  )
}
