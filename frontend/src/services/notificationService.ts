import { api } from './api'

export type NotificationType =
  | 'replan_proposal'
  | 'replan_accepted'
  | 'replan_rejected'
  | 'incident_detected'
  | 'trip_starting_soon'
  | 'system'

export interface AppNotification {
  notificationId: string
  tripId: string | null
  type: NotificationType
  title: string
  message: string
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export interface NotificationListResponse {
  items: AppNotification[]
  unreadCount: number
}

export const notificationService = {
  list: (params?: { limit?: number; unreadOnly?: boolean }) =>
    api
      .get<NotificationListResponse>('/notifications', {
        params: {
          ...(params?.limit ? { limit: params.limit } : {}),
          ...(params?.unreadOnly ? { unreadOnly: 'true' } : {}),
        },
      })
      .then((r) => r.data),

  markRead: (notificationId: string) =>
    api.patch(`/notifications/${notificationId}/read`).then((r) => r.data),

  markAllRead: () =>
    api.patch<{ updated: number }>('/notifications/read-all').then((r) => r.data),

  delete: (notificationId: string) =>
    api.delete(`/notifications/${notificationId}`).then((r) => r.data),

  clear: () =>
    api.delete<{ deleted: number }>('/notifications').then((r) => r.data),
}
