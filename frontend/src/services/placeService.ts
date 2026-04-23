import { api } from './api'
import type { Place } from '@/types'

export const placeService = {
  list: (params?: { city?: string; tags?: string; page?: number; limit?: number }) =>
    api.get<{ places: Place[]; total: number }>('/places', { params }).then((r) => r.data),

  get: (placeId: number) => api.get<Place>(`/places/${placeId}`).then((r) => r.data),

  search: (query: string, city?: string) =>
    api.get<Place[]>('/places/search', { params: { q: query, city } }).then((r) => r.data),
}
