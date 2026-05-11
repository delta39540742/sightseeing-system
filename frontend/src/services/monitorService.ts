import { api } from './api'

export interface MonitorAlert {
  eventId?: string
  type: string
  reason: string
  severity: number
  affectedSlotIds: string[]
  timestamp: string
  expiresAt?: string
}

export const monitorService = {
  checkIncident: (tripId?: string) =>
    api
      .get<MonitorAlert | { status: string }>('/monitor/check-incident', {
        params: tripId ? { tripId } : undefined,
      })
      .then((r) => r.data),

  syncTrip: (
    tripData: unknown,
    state: unknown,
    location?: { lat: number; lon: number },
  ) =>
    api.post('/monitor/sync-trip', { tripData, state, location }).then((r) => r.data),
}
