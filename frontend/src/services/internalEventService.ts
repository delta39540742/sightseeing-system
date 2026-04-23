import { api } from './api'

export const internalEventService = {
  publish: (eventType: string, payload: Record<string, unknown>) =>
    api.post('/internal/events', { event_type: eventType, payload }).then((r) => r.data),
}
