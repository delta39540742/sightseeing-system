import { prefApi } from './api'
import type { SurveyPayload } from '@/types'

export const preferenceService = {
  getSurveyStatus: () =>
    prefApi.get<{ hasCompleted: boolean; completedAt: string | null }>('/preferences/survey/status').then((r) => r.data),

  getSurvey: () =>
    prefApi.get<{ survey: SurveyPayload | null }>('/preferences/survey').then((r) => r.data.survey),

  saveSurvey: (data: SurveyPayload) =>
    prefApi.post('/preferences/survey', data).then((r) => r.data),

  updateSurvey: (data: Partial<SurveyPayload>) =>
    prefApi.patch('/preferences/survey', data).then((r) => r.data),

  getWeights: () =>
    prefApi.get('/preferences/weights').then((r) => r.data),

  addFavorite: (placeId: number) =>
    prefApi.post('/preferences/favorite', { placeId }).then((r) => r.data),

  removeFavorite: (placeId: number) =>
    prefApi.delete(`/preferences/favorite/${placeId}`).then((r) => r.data),

  ratePlace: (placeId: number, rating: number, tripId?: string) =>
    prefApi.post('/preferences/rating', { placeId, rating, ...(tripId ? { tripId } : {}) }).then((r) => r.data),

  getSimilarUsers: (limit = 10) =>
    prefApi.get<{ items: { userId: string; similarity: number; rankPosition: number }[]; isStale: boolean }>(
      `/preferences/similar-users?limit=${limit}`
    ).then((r) => r.data),

  getProfile: (limit = 30) =>
    prefApi.get<{
      preferenceVector: { tagId: number; label: string; value: number }[];
      arms: { armId: number; name: string; pulls: number; avgReward: number; totalReward: number; isActive: boolean }[];
      interactions: {
        interactionId: string;
        interactionType: string;
        placeId: number | null;
        placeName: string | null;
        rating: number | null;
        context: unknown;
        createdAt: string;
      }[];
      currentArmId: number | null;
    }>(`/preferences/profile?limit=${limit}`).then((r) => r.data),

  updateVector: (vector: number[]) =>
    prefApi.patch('/preferences/vector', { vector }).then((r) => r.data),

  selectArm: (armId: number) =>
    prefApi.patch('/preferences/arm', { armId }).then((r) => r.data),
}
