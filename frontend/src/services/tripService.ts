import { api } from './api'
import type { Trip, PlanRequest } from '@/types'

export const tripService = {
  list: () => api.get<Trip[]>('/trips').then((r) => r.data),

  get: (tripId: string) => api.get<Trip>(`/trips/${tripId}`).then((r) => r.data),

  create: (data: Partial<Trip>) => api.post<Trip>('/trips', data).then((r) => r.data),

  update: (tripId: string, data: Partial<Trip>) =>
    api.patch<Trip>(`/trips/${tripId}`, data).then((r) => r.data),

  delete: (tripId: string) => api.delete(`/trips/${tripId}`),

  generate: (req: PlanRequest) =>
    api.post<Trip>('/plan/generate', req).then((r) => r.data),

  candidates: (req: PlanRequest) =>
    api.post<{ places: import('@/types').Place[] }>('/plan/candidates', req).then((r) => r.data.places),

  replan: (tripId: string) =>
    api.post(`/trips/${tripId}/replan`).then((r) => r.data),

  getPendingReplan: (tripId: string) =>
    api.get(`/trips/${tripId}/replan/pending`).then((r) => r.data),

  acceptReplan: (tripId: string, pid: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/accept`).then((r) => r.data),

  rejectReplan: (tripId: string, pid: string) =>
    api.post(`/trips/${tripId}/replan/${pid}/reject`).then((r) => r.data),

  share: (tripId: string, ttlDays: number) =>
    api.post<{ shareUrl: string; expiresAt: string }>(`/trips/${tripId}/share`, { ttlDays }).then((r) => r.data),
}
