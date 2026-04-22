import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Settings, LogOut, ChevronRight, Star, ThumbsUp, ThumbsDown } from 'lucide-react'
import { format, parseISO, isAfter } from 'date-fns'
import { vi } from 'date-fns/locale'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { useLoginActions } from '@/hooks/useAuth'
import { TripCardSkeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { Trip } from '@/types'

export default function Profile() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { logout } = useLoginActions()
  const [reviewTrip, setReviewTrip] = useState<Trip | null>(null)
  const [swipeIndex, setSwipeIndex] = useState(0)

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: tripService.list,
    enabled: !!user,
  })

  const completedTrips = trips?.filter((t) => t.status === 'completed') ?? []
  const upcomingTrips = trips?.filter((t) => t.status !== 'completed' && t.status !== 'cancelled') ?? []

  const pendingReview = completedTrips.find((t) =>
    isAfter(new Date(), parseISO(t.endDate))
  )

  const handleSwipe = (direction: 'like' | 'dislike' | 'love') => {
    if (!reviewTrip) return
    const slots = reviewTrip.slots
    if (swipeIndex < slots.length - 1) {
      setSwipeIndex((i) => i + 1)
    } else {
      setReviewTrip(null)
      setSwipeIndex(0)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-semibold text-gray-900 flex-1">Trang cá nhân</h1>
        <button onClick={() => navigate('/preferences')} aria-label="Sở thích" className="p-2 hover:bg-gray-100 rounded-lg">
          <Settings className="w-5 h-5 text-gray-500" />
        </button>
      </header>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {/* User info */}
        <div className="card p-5 flex items-center gap-4">
          {user?.photoURL
            ? <img src={user.photoURL} alt="" className="w-16 h-16 rounded-full" />
            : <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl">👤</div>
          }
          <div className="flex-1">
            <p className="font-semibold text-gray-900">{user?.displayName ?? 'Người dùng'}</p>
            <p className="text-sm text-gray-400">{user?.email}</p>
          </div>
          <button onClick={logout} aria-label="Đăng xuất" className="p-2 rounded-lg hover:bg-red-50 text-red-400">
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {/* Pending review prompt */}
        {pendingReview && (
          <div className="card p-4 bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200">
            <p className="font-semibold text-violet-800 text-sm">Chuyến đi của bạn đã kết thúc!</p>
            <p className="text-xs text-violet-600 mt-1">{pendingReview.destinationCity} — Chia sẻ cảm nhận?</p>
            <button
              onClick={() => { setReviewTrip(pendingReview); setSwipeIndex(0) }}
              className="btn mt-3 bg-violet-500 text-white text-xs hover:bg-violet-600"
            >
              Đánh giá ngay
            </button>
          </div>
        )}

        {/* Upcoming */}
        {upcomingTrips.length > 0 && (
          <div>
            <h2 className="font-semibold text-gray-700 text-sm mb-3">Sắp tới</h2>
            <div className="space-y-2">
              {upcomingTrips.map((t) => (
                <button
                  key={t.tripId}
                  onClick={() => navigate(`/trip/${t.tripId}`)}
                  className="card w-full p-3 flex items-center gap-3 hover:shadow-md transition-shadow text-left"
                >
                  <span className="text-xl">✈️</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{t.title ?? t.destinationCity}</p>
                    <p className="text-xs text-gray-400">
                      {format(parseISO(t.startDate), 'dd/MM/yyyy', { locale: vi })}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Completed */}
        {isLoading && <div className="space-y-2">{[1,2].map(i => <TripCardSkeleton key={i} />)}</div>}
        {completedTrips.length > 0 && (
          <div>
            <h2 className="font-semibold text-gray-700 text-sm mb-3">Đã hoàn thành ({completedTrips.length})</h2>
            <div className="space-y-2">
              {completedTrips.map((t) => (
                <button
                  key={t.tripId}
                  onClick={() => navigate(`/trip/${t.tripId}`)}
                  className="card w-full p-3 flex items-center gap-3 hover:shadow-md transition-shadow text-left"
                >
                  <span className="text-xl">✅</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{t.title ?? t.destinationCity}</p>
                    <p className="text-xs text-gray-400">
                      {format(parseISO(t.endDate), 'dd/MM/yyyy', { locale: vi })}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Post-trip review modal */}
      <Modal open={!!reviewTrip} onClose={() => setReviewTrip(null)} title="Đánh giá chuyến đi" size="sm">
        {reviewTrip && reviewTrip.slots[swipeIndex] && (
          <div className="text-center space-y-4">
            <p className="text-xs text-gray-400">
              {swipeIndex + 1} / {reviewTrip.slots.length}
            </p>
            <div className="h-32 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-xl flex items-center justify-center text-white text-4xl">
              📍
            </div>
            <p className="font-semibold">
              {reviewTrip.slots[swipeIndex].place?.name ?? 'Địa điểm'}
            </p>
            <p className="text-sm text-gray-500">Trải nghiệm ở đây như thế nào?</p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => handleSwipe('dislike')}
                className="flex flex-col items-center gap-1 p-4 rounded-xl border-2 border-red-200 hover:border-red-400 hover:bg-red-50 transition-all"
                aria-label="Không phù hợp"
              >
                <ThumbsDown className="w-6 h-6 text-red-400" />
                <span className="text-xs text-red-500">Không phù hợp</span>
              </button>
              <button
                onClick={() => handleSwipe('like')}
                className="flex flex-col items-center gap-1 p-4 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all"
                aria-label="Thích"
              >
                <ThumbsUp className="w-6 h-6 text-green-400" />
                <span className="text-xs text-green-500">Thích</span>
              </button>
              <button
                onClick={() => handleSwipe('love')}
                className="flex flex-col items-center gap-1 p-4 rounded-xl border-2 border-yellow-200 hover:border-yellow-400 hover:bg-yellow-50 transition-all"
                aria-label="Xuất sắc"
              >
                <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" />
                <span className="text-xs text-yellow-600">Xuất sắc</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
