import { useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Calendar, MapPin, Clock, Wallet, AlertCircle } from 'lucide-react'
import { format, parseISO, addMinutes } from 'date-fns'
import { vi } from 'date-fns/locale'
import { tripService } from '@/services/tripService'
import { TripMap } from '@/components/map/TripMap'
import { PageSpinner } from '@/components/ui/Spinner'
import type { TripSlot } from '@/types'

export default function SharedTripView() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const { data: trip, isLoading, error } = useQuery({
    queryKey: ['shared-trip', token],
    queryFn: () => tripService.getShared(token!),
    enabled: !!token,
    retry: false,
  })

  const slotsByDay = useMemo(() => {
    if (!trip?.slots) return new Map<number, TripSlot[]>()
    const m = new Map<number, TripSlot[]>()
    for (const s of trip.slots) {
      if (s.status === 'replaced') continue
      const arr = m.get(s.dayIndex) ?? []
      arr.push(s)
      m.set(s.dayIndex, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.slotOrder - b.slotOrder)
    return m
  }, [trip])

  if (isLoading) return <PageSpinner />

  if (error || !trip) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    const expired = status === 410
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {expired ? 'Link chia sẻ đã hết hạn' : 'Không tìm thấy kế hoạch'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {expired
              ? 'Người tạo có thể tạo link mới để chia sẻ tiếp.'
              : 'Link có thể đã bị thu hồi hoặc không tồn tại.'}
          </p>
          <Link to="/" className="btn-primary inline-block px-6 py-2">
            Về trang chủ
          </Link>
        </div>
      </div>
    )
  }

  const tripWithExpiry = trip as typeof trip & { shareExpiresAt?: string | null }
  const expiresAt = tripWithExpiry.shareExpiresAt
  const days = Array.from(slotsByDay.keys()).sort((a, b) => a - b)

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/')}
          aria-label="Quay lại"
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-gray-900 truncate">
              {trip.title ?? trip.destinationCity}
            </h1>
            <span className="text-[10px] font-bold tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              CHIA SẺ
            </span>
          </div>
          <p className="text-xs text-gray-400 flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(parseISO(trip.startDate), 'dd MMM', { locale: vi })}
              {' – '}
              {format(parseISO(trip.endDate), 'dd MMM yyyy', { locale: vi })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Wallet className="w-3 h-3" />
              {trip.budgetTotal.toLocaleString('vi-VN')}đ
            </span>
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {/* Timeline (read-only) */}
        <div className="w-full md:w-[400px] h-1/2 md:h-full overflow-y-auto bg-white border-r border-gray-100">
          {days.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              Kế hoạch chưa có địa điểm nào.
            </div>
          ) : (
            <div className="p-4 space-y-5">
              {days.map((dayIdx) => {
                const slots = slotsByDay.get(dayIdx)!
                const dayDate = addMinutes(parseISO(trip.startDate), dayIdx * 24 * 60)
                return (
                  <section key={dayIdx}>
                    <div className="flex items-baseline gap-2 mb-2">
                      <h2 className="font-semibold text-sm text-gray-700">
                        Ngày {dayIdx + 1}
                      </h2>
                      <span className="text-xs text-gray-400">
                        {format(dayDate, 'EEEE, dd/MM', { locale: vi })}
                      </span>
                    </div>
                    <ol className="space-y-2">
                      {slots.map((s) => (
                        <li
                          key={s.slotId}
                          className="rounded-lg border border-gray-100 bg-white p-3 flex gap-3"
                        >
                          {s.place?.imageUrl ? (
                            <img
                              src={s.place.imageUrl}
                              alt={s.place.name}
                              className="w-14 h-14 rounded-md object-cover shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                              <MapPin className="w-5 h-5 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-medium text-gray-900 truncate">
                              {s.place?.name ?? 'Địa điểm'}
                            </h3>
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3" />
                              {format(parseISO(s.plannedStart), 'HH:mm')}
                              {' – '}
                              {format(parseISO(s.plannedEnd), 'HH:mm')}
                            </p>
                            {s.estimatedCost > 0 && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                ~ {s.estimatedCost.toLocaleString('vi-VN')}đ
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )
              })}
            </div>
          )}

          {expiresAt && (
            <div className="px-4 pb-4">
              <p className="text-[11px] text-gray-400 text-center">
                Link hết hạn: {format(parseISO(expiresAt), 'dd/MM/yyyy HH:mm')}
              </p>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 h-1/2 md:h-full isolate">
          <TripMap slots={trip.slots} className="w-full h-full rounded-none" />
        </div>
      </div>
    </div>
  )
}
