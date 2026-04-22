import { prefApi } from './api'
import type { UserPreference } from '@/types'

export const preferenceService = {
  getSurveyStatus: () =>
    prefApi.get<{ completed: boolean }>('/preferences/survey/status').then((r) => r.data),

  saveSurvey: (data: UserPreference) =>
    prefApi.post('/preferences/survey', data).then((r) => r.data),

  updateSurvey: (data: Partial<UserPreference>) =>
    prefApi.patch('/preferences/survey', data).then((r) => r.data),

  getWeights: () =>
    prefApi.get('/preferences/weights').then((r) => r.data),

  addFavorite: (placeId: number) =>
    prefApi.post('/preferences/favorite', { placeId }).then((r) => r.data),

  removeFavorite: (placeId: number) =>
    prefApi.delete(`/preferences/favorite/${placeId}`).then((r) => r.data),
}
