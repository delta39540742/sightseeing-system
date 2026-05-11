import { api } from './api'
import type { Place, Trip, PlanRequest, ReplanScope } from '@/types'

// Backend yêu cầu format date-time (ISO 8601). Nếu nhận YYYY-MM-DD thì append giờ.
const toIsoDateTime = (s: string | undefined | null): string | undefined => {
  if (!s) return s ?? undefined
  if (s.includes('T')) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toISOString()
}

const toIsoDateTimeRange = <T extends { startDate?: string; endDate?: string }>(req: T): T => ({
  ...req,
  startDate: toIsoDateTime(req.startDate) as T['startDate'],
  endDate: toIsoDateTime(req.endDate) as T['endDate'],
})

interface CreateDraftBody {
  user_id: string
  destination_city: string
  start_date: string
  end_date: string
  budget_total: number
  raw_prompt?: string
}

export const tripService = {
  list: () => api.get<Trip[]>('/trips').then((r) => r.data),

  get: (tripId: string) => api.get<Trip>(`/trips/${tripId}`).then((r) => r.data),

  // Tạo trip (Draft) — POST /api/trips trả { success, data: rawPrismaObject }
  create: (data: CreateDraftBody) =>
    api.post<{ success: boolean; data: Record<string, unknown> }>('/trips', data).then((r) => {
      const d = r.data.data
      return {
        tripId:          d['trip_id'],
        userId:          d['user_id'],
        title:           d['title'] ?? null,
        destinationCity: d['destination_city'],
        startDate:       d['start_date'],
        endDate:         d['end_date'],
        status:          d['status'],
        budgetTotal:     d['budget_total'],
        objectiveScore:  d['objective_score'] ?? null,
        createdAt:       d['created_at'],
        updatedAt:       d['updated_at'],
        slots:           [],
      } as Trip
    }),

  update: (tripId: string, data: Partial<Trip>) =>
    api.patch<Trip>(`/trips/${tripId}`, data).then((r) => r.data),

  delete: (tripId: string) => api.delete(`/trips/${tripId}`),

  listDeleted: () => api.get<Trip[]>('/trips/deleted').then((r) => r.data),

  restore: (tripId: string) => api.patch<Trip>(`/trips/${tripId}/restore`).then((r) => r.data),

  permanentDelete: (tripId: string) => api.delete(`/trips/${tripId}/permanent`),

  addSlot: (tripId: string, placeId: number, dayIndex?: number) =>
    api.post(`/trips/${tripId}/slots`, { placeId, dayIndex }).then((r) => r.data),

  completeSlot: (tripId: string, slotId: string) =>
    api.patch(`/trips/${tripId}/slots/${slotId}`, { status: 'completed' }).then((r) => r.data),

  generate: (req: PlanRequest) =>
    api.post<Trip>('/plan/generate', toIsoDateTimeRange(req)).then((r) => r.data),

  candidates: (req: PlanRequest) =>
    api
      .post<{ places: Place[] }>('/plan/candidates', toIsoDateTimeRange(req))
      .then((r) => r.data.places),

  listPlaces: (params?: { page?: number; limit?: number; ids?: number[] }) =>
    api.get<{ success: boolean; data: any[] }>('/places', {
      params: params?.ids ? { ...params, ids: params.ids.join(',') } : params,
    }).then((r) =>
      r.data.data.map(
        (p): Place => ({
          placeId: Number(p.place_id),
          name: p.name,
          description: p.description ?? undefined,
          lat: p.lat,
          lng: p.lng,
          indoorOutdoor: p.indoor_outdoor as 'indoor' | 'outdoor' | 'mixed',
          avgVisitDurationMin: p.avg_visit_duration_min ?? 60,
          minPrice: p.min_price ?? undefined,
          priceType: p.price_type ?? undefined,
          imageUrl: p.image_url ?? undefined,
          tags: [],
          openingHours: [],
        }),
      ),
    ),

  replan: (
    tripId: string,
    replanScope: ReplanScope,
    triggeredByEventId?: string,
    currentLocation?: { lat: number; lng: number },
  ) =>
    api.post(`/trips/${tripId}/replan`, {
      replanScope,
      ...(triggeredByEventId ? { triggeredByEventId } : {}),
      ...(currentLocation ? { currentLocation } : {}),
    }).then((r) => r.data),

  getPendingReplan: (tripId: string) =>
    api.get(`/trips/${tripId}/replan/pending`).then((r) => r.data),

  checkIncident: () =>
    api.get('/monitor/check-incident').then((r) => r.data),

  acceptReplan: (tripId: string, pid: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/accept`).then((r) => r.data),

  rejectReplan: (tripId: string, pid: string, reason?: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/reject`, { reason }).then((r) => r.data),

  // Backend không có endpoint share — trả URL local, không gọi network
  share: (tripId: string, _ttlDays: number): Promise<{ shareUrl: string; expiresAt: string }> =>
    Promise.resolve({ shareUrl: `${window.location.origin}/trip/${tripId}`, expiresAt: '' }),
}
