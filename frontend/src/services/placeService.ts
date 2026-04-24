import { api } from './api'
import type { Place } from '@/types'

export const placeService = {
  list: (params?: { page?: number; limit?: number; indoor_outdoor?: 'indoor' | 'outdoor' | 'mixed'; is_landmark?: boolean }) =>
    api.get<{ success: boolean; data: Place[]; meta: { total: number } }>('/places', { params })
       .then((r) => ({ places: r.data.data, total: r.data.meta.total })),

  get: (placeId: number) => 
    api.get<{ success: boolean; data: Place }>(`/places/${placeId}`)
       .then((r) => r.data.data),

  search: (query: string, isLandmark?: boolean) =>
    api
      .get<{ success: boolean; data: Place[]; meta: { total: number } }>('/places', {
        params: {
          ...(isLandmark !== undefined ? { is_landmark: isLandmark } : {}),
        },
      })
      .then((r) => r.data.data.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))),
}
