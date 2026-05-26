import { prisma } from '../lib/prisma'

export type NotificationType =
  | 'replan_proposal'      // có proposal mới cần xem
  | 'replan_accepted'
  | 'replan_rejected'
  | 'incident_detected'    // weather/traffic/event
  | 'trip_starting_soon'
  | 'share_expiring_soon'
  | 'system'

export interface CreateNotificationInput {
  userId: string
  tripId?: string | null
  type: NotificationType
  title: string
  message: string
  data?: unknown
}

export const notificationService = {
  async create(input: CreateNotificationInput): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          user_id: input.userId,
          trip_id: input.tripId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          data: (input.data ?? null) as never,
        },
      })
    } catch (err) {
      // Notification là phụ — không được làm vỡ luồng chính
      console.error('[notificationService.create] failed:', err)
    }
  },

  async createForTrip(tripId: string, input: Omit<CreateNotificationInput, 'userId' | 'tripId'>): Promise<void> {
    try {
      const trip = await prisma.trip.findUnique({
        where: { trip_id: tripId },
        select: { user_id: true },
      })
      if (!trip) return
      await this.create({ ...input, userId: trip.user_id, tripId })
    } catch (err) {
      console.error('[notificationService.createForTrip] failed:', err)
    }
  },
}
