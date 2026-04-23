import { api } from './api'
import type { LandmarkRecognitionResult } from '@/types'

export const landmarkService = {
  recognize: (imageFile: File) => {
    const form = new FormData()
    form.append('image', imageFile)
    return api.post<LandmarkRecognitionResult>('/landmark/recognize', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },

  getRecognition: (recognitionId: string) =>
    api.get<{ recognitionId: string; placeId: number }>(`/landmark/recognition/${recognitionId}`)
      .then((r) => r.data),

  // Backend mock nhận diện theo tên file (vd: cau.rong.jpg → Cầu Rồng)
  addToTrip: (recognitionId: string, tripId: string) =>
    api.post<{ proposalId: string; newScore: number; changes: string[] }>(
      `/landmark/${recognitionId}/add-to-trip`,
      { tripId },
    ).then((r) => r.data),
}
