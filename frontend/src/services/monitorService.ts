import { api } from './api'

export interface MonitorAlert {
  type: string
  reason: string
  severity: number
  affectedSlotIds: string[]
  timestamp: string
}

export const monitorService = {
  checkIncident: () =>
    api
      .get<MonitorAlert | { status: string }>('/monitor/check-incident')
      .then((r) => r.data),

  syncTrip: (
    tripData: unknown,
    state: unknown,
    location?: { lat: number; lon: number },
  ) =>
    api.post('/monitor/sync-trip', { tripData, state, location }).then((r) => r.data),
}
