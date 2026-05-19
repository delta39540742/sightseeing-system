import { api } from './api'
import type { Place } from '@/types'

export type PlaceWithDistance = Place & { distanceM?: number }

function mapPlace(p: any): PlaceWithDistance {
  return {
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
  }
}

export const placeService = {
  list: (params?: { page?: number; limit?: number; indoor_outdoor?: 'indoor' | 'outdoor' | 'mixed'; is_landmark?: boolean }) =>
    api.get<{ success: boolean; data: Place[]; meta: { total: number } }>('/places', { params })
       .then((r) => ({ places: r.data.data, total: r.data.meta.total })),

  get: (placeId: number) =>
    api.get<{ success: boolean; data: Place }>(`/places/${placeId}`)
       .then((r) => r.data.data),

  searchByName: (q: string, city?: string) =>
    api.get<{ success: boolean; data: any[] }>('/places', { params: { q, limit: 10, ...(city ? { city } : {}) } })
       .then((r) => r.data.data.map(mapPlace)),

  searchNearby: (lat: number, lng: number, radius = 500) =>
    api.get<{ success: boolean; data: any[] }>('/places/nearby', { params: { lat, lng, radius } })
       .then((r) => r.data.data.map((p): PlaceWithDistance => ({ ...mapPlace(p), distanceM: p.distanceM ?? p.distance_m }))),

  resolveShortUrl: (url: string) =>
    api.get<{ success: boolean; finalUrl: string }>('/places/resolve-url', { params: { url } })
       .then((r) => r.data.finalUrl),

  createCustom: (name: string, lat: number, lng: number, description?: string) =>
    api.post<{ success: boolean; data: any }>('/places', { name, lat, lng, description })
       .then((r) => mapPlace(r.data.data) as PlaceWithDistance),

  search: (query: string, isLandmark?: boolean) =>
    api
      .get<{ success: boolean; data: Place[]; meta: { total: number } }>('/places', {
        params: {
          ...(isLandmark !== undefined ? { is_landmark: isLandmark } : {}),
        },
      })
      .then((r) => r.data.data.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))),
}
