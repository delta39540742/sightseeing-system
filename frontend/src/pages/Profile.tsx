import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Settings, LogOut, ChevronRight,
  Star, ThumbsUp, ThumbsDown, User, Mail,
  CheckCircle2, Clock, MapPin,
} from 'lucide-react'
import { format, parseISO, isAfter } from 'date-fns'
import { vi } from 'date-fns/locale'
import { signOut } from 'firebase/auth'
import { auth } from '@/config/firebase'
import { tripService } from '@/services/tripService'
import { useAuthStore } from '@/store/authStore'
import { useFavorites } from '@/hooks/useFavorites'
import { TripCardSkeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/store/toastStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Trip } from '@/types'

// ─── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({
  src,
  name,
  size = 'lg',
}: {
  src?: string | null
  name?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim = size === 'lg' ? 'w-18 h-18' : size === 'md' ? 'w-12 h-12' : 'w-8 h-8'
  const text = size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-sm'
  const initials = name
    ? name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'Avatar'}
        referrerPolicy="no-referrer"
        className={`${dim} rounded-full object-cover ring-2 ring-white shadow-md`}
      />
    )
  }
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center ring-2 ring-white shadow-md`}>
      <span className={`${text} font-bold text-white`}>{initials}</span>
    </div>
  )
}

// ─── Trip row ────────────────────────────────────────────────────────────────

function TripRow({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const isCompleted = trip.status === 'completed'
  return (
    <button
      onClick={onClick}
      className="card w-full p-3.5 flex items-center gap-3 hover:shadow-md transition-all text-left active:scale-[0.99]"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
        isCompleted ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'
      }`}>
        {isCompleted
          ? <CheckCircle2 className="w-5 h-5" />
          : <Clock className="w-5 h-5" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate text-gray-900">
          {trip.title ?? trip.destinationCity}
        </p>
        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
          <MapPin className="w-3 h-3" />
          {trip.destinationCity} •{' '}
          {format(parseISO(isCompleted ? trip.endDate : trip.startDate), 'dd/MM/yyyy', { locale: vi })}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
    </button>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { add: addFavorite } = useFavorites()
  const [reviewTrip, setReviewTrip] = useState<Trip | null>(null)
  const [swipeIndex, setSwipeIndex] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: tripService.list,
    enabled: !!user,
  })

  const completedTrips = trips?.filter((t) => t.status === 'completed') ?? []
  const upcomingTrips  = trips?.filter((t) => t.status !== 'completed' && t.status !== 'cancelled') ?? []

  const pendingReview = completedTrips.find((t) => isAfter(new Date(), parseISO(t.endDate)))

  // ── Logout: Firebase signOut → clear authStore → redirect /welcome ──────

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await signOut(auth)
      useAuthStore.getState().logout()
      toast.info('Đã đăng xuất')
      navigate('/welcome', { replace: true })
    } catch {
      toast.error('Đăng xuất thất bại, thử lại')
      setLoggingOut(false)
    }
  }

  // ── Post-trip review ────────────────────────────────────────────────────

  const handleSwipe = (direction: 'like' | 'dislike' | 'love') => {
    if (!reviewTrip) return
    const currentPlace = reviewTrip.slots[swipeIndex]?.place
    if (direction === 'love' && currentPlace?.placeId) {
      addFavorite(currentPlace.placeId)
      toast.success('Đã lưu địa điểm yêu thích ❤️')
    }
    const slots = reviewTrip.slots
    if (swipeIndex < slots.length - 1) {
      setSwipeIndex((i) => i + 1)
    } else {
      setReviewTrip(null)
      setSwipeIndex(0)
      toast.success('Cảm ơn bạn đã đánh giá!')
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} aria-label="Quay lại" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="font-semibold text-gray-900 flex-1">Trang cá nhân</h1>
        <button
          onClick={() => navigate('/preferences')}
          aria-label="Sở thích"
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5 text-gray-500" />
        </button>
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-5">
        {/* ── User card ─────────────────────────────────────────────────── */}
        <div className="card overflow-hidden">
          {/* Cover gradient */}
          <div className="h-20 bg-gradient-to-r from-blue-500 via-violet-500 to-indigo-500" />
          {/* Info row */}
          <div className="px-5 pb-5">
            <div className="flex items-end gap-4 -mt-9 mb-4">
              <Avatar src={user?.photoURL} name={user?.displayName} size="lg" />
              <div className="flex-1 min-w-0 pb-1">
                <p className="font-bold text-gray-900 text-lg leading-tight truncate">
                  {user?.displayName ?? 'Người dùng'}
                </p>
                {user?.email && (
                  <p className="text-sm text-gray-400 flex items-center gap-1 mt-0.5">
                    <Mail className="w-3.5 h-3.5" />
                    {user.email}
                  </p>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Chuyến đi', value: trips?.length ?? '—' },
                { label: 'Hoàn thành', value: completedTrips.length },
                { label: 'Sắp tới', value: upcomingTrips.length },
              ].map(({ label, value }) => (
                <div key={label} className="text-center py-2.5 px-2 bg-gray-50 rounded-xl">
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => navigate('/preferences')}
                className="flex-1 btn-secondary text-sm flex items-center justify-center gap-1.5"
              >
                <User className="w-4 h-4" />
                Sở thích
              </button>
              <Button
                variant="destructive"
                size="sm"
                loading={loggingOut}
                onClick={handleLogout}
                className="flex-1"
                id="btn-logout"
              >
                {!loggingOut && <LogOut className="w-4 h-4" />}
                Đăng xuất
              </Button>
            </div>
          </div>
        </div>

        {/* ── Pending review ────────────────────────────────────────────── */}
        {pendingReview && (
          <div className="card p-4 bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Star className="w-5 h-5 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-violet-800 text-sm">Chuyến đi đã kết thúc!</p>
                <p className="text-xs text-violet-600 mt-0.5">
                  {pendingReview.destinationCity} — Chia sẻ cảm nhận nhé?
                </p>
              </div>
            </div>
            <button
              onClick={() => { setReviewTrip(pendingReview); setSwipeIndex(0) }}
              className="btn mt-3 bg-violet-500 text-white text-xs hover:bg-violet-600 w-full justify-center"
            >
              Đánh giá ngay →
            </button>
          </div>
        )}

        {/* ── Upcoming trips ────────────────────────────────────────────── */}
        {upcomingTrips.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-700 text-sm">Sắp tới</h2>
              <Badge variant="default" size="sm">{upcomingTrips.length}</Badge>
            </div>
            {upcomingTrips.map((t) => (
              <TripRow key={t.tripId} trip={t} onClick={() => navigate(`/trip/${t.tripId}`)} />
            ))}
          </div>
        )}

        {/* ── Completed trips ───────────────────────────────────────────── */}
        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => <TripCardSkeleton key={i} />)}
          </div>
        )}

        {!isLoading && completedTrips.length > 0 && (
          <div className="space-y-2 pb-10">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-700 text-sm">Đã hoàn thành</h2>
              <Badge variant="success" size="sm">{completedTrips.length}</Badge>
            </div>
            {completedTrips.map((t) => (
              <TripRow key={t.tripId} trip={t} onClick={() => navigate(`/trip/${t.tripId}`)} />
            ))}
          </div>
        )}

        {!isLoading && !trips?.length && (
          <div className="text-center py-12 text-gray-400 space-y-2">
            <MapPin className="w-10 h-10 mx-auto opacity-30" />
            <p className="text-sm">Chưa có chuyến đi nào</p>
            <button
              onClick={() => navigate('/plan')}
              className="btn-primary text-sm mt-2"
            >
              Lên kế hoạch ngay
            </button>
          </div>
        )}
      </div>

      {/* ── Post-trip review modal ────────────────────────────────────────── */}
      <Modal
        open={!!reviewTrip}
        onClose={() => { setReviewTrip(null); setSwipeIndex(0) }}
        title="Đánh giá chuyến đi"
        size="sm"
      >
        {reviewTrip && reviewTrip.slots[swipeIndex] && (
          <div className="text-center space-y-4">
            <p className="text-xs text-gray-400 font-medium">
              Địa điểm {swipeIndex + 1} / {reviewTrip.slots.length}
            </p>

            <div className="h-36 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-2xl flex items-center justify-center text-5xl shadow-lg">
              📍
            </div>

            <div>
              <p className="font-semibold text-gray-900">
                {reviewTrip.slots[swipeIndex].place?.name ?? 'Địa điểm'}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">Trải nghiệm ở đây như thế nào?</p>
            </div>

            <div className="flex justify-center gap-3">
              {([
                { dir: 'dislike', icon: ThumbsDown, label: 'Không phù hợp', color: 'border-red-200 hover:border-red-400 hover:bg-red-50', iconColor: 'text-red-400', textColor: 'text-red-500' },
                { dir: 'like',    icon: ThumbsUp,   label: 'Thích',          color: 'border-green-200 hover:border-green-400 hover:bg-green-50', iconColor: 'text-green-400', textColor: 'text-green-500' },
                { dir: 'love',    icon: Star,        label: 'Xuất sắc',       color: 'border-yellow-200 hover:border-yellow-400 hover:bg-yellow-50', iconColor: 'text-yellow-400 fill-yellow-400', textColor: 'text-yellow-600' },
              ] as const).map(({ dir, icon: Icon, label, color, iconColor, textColor }) => (
                <button
                  key={dir}
                  onClick={() => handleSwipe(dir)}
                  className={`flex flex-col items-center gap-1.5 p-3.5 rounded-2xl border-2 transition-all flex-1 ${color}`}
                  aria-label={label}
                >
                  <Icon className={`w-6 h-6 ${iconColor}`} />
                  <span className={`text-xs font-medium ${textColor}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
