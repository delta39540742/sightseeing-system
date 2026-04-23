import { api } from './api'
import type { Trip, PlanRequest, ReplanScope } from '@/types'

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

  // Tạo draft trip — backend cần snake_case fields
  createDraft: (data: CreateDraftBody) => api.post<Trip>('/trips', data).then((r) => r.data),

  // Giữ lại để không break code cũ, nhưng ưu tiên dùng createDraft()
  create: (data: Partial<Trip>) => api.post<Trip>('/trips', data).then((r) => r.data),

  // Backend chưa có PATCH /trips/:id — dùng tạm, cần backend implement sau
  update: (tripId: string, data: Partial<Trip>) =>
    api.patch<Trip>(`/trips/${tripId}`, data).then((r) => r.data),

  delete: (tripId: string) => api.delete(`/trips/${tripId}`),

  addSlot: (tripId: string, placeId: number, dayIndex?: number) =>
    api.post(`/trips/${tripId}/slots`, { placeId, dayIndex }).then((r) => r.data),

  generate: (req: PlanRequest) =>
    api.post<Trip>('/plan/generate', req).then((r) => r.data),

  candidates: (req: PlanRequest) =>
    api.post<{ places: import('@/types').Place[] }>('/plan/candidates', req).then((r) => r.data.places),

  replan: (tripId: string, replanScope: ReplanScope, triggeredByEventId?: string) =>
    api.post(`/trips/${tripId}/replan`, {
      replanScope,
      ...(triggeredByEventId ? { triggeredByEventId } : {}),
    }).then((r) => r.data),

  getPendingReplan: (tripId: string) =>
    api.get(`/trips/${tripId}/replan/pending`).then((r) => r.data),

  acceptReplan: (tripId: string, pid: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/accept`).then((r) => r.data),

  rejectReplan: (tripId: string, pid: string, reason?: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/reject`, { reason }).then((r) => r.data),

  // Backend không có endpoint share — trả URL local, không gọi network
  share: (tripId: string, _ttlDays: number): Promise<{ shareUrl: string; expiresAt: string }> =>
    Promise.resolve({ shareUrl: `${window.location.origin}/trip/${tripId}`, expiresAt: '' }),
}
