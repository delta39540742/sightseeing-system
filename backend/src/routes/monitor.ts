import type { FastifyInstance } from 'fastify'
import cron from 'node-cron'
import { monitorService, type TripData, type TripState } from '../services/monitorService'
import { verifyToken } from '../middlewares/authMiddleware'

export async function monitorPlugin(fastify: FastifyInstance): Promise<void> {
  cron.schedule('*/30 * * * *', async () => {
    try {
      await monitorService.runMonitoring()
    } catch (err) {
      fastify.log.error({ err }, '[monitor cron] runMonitoring failed')
    }
  })

  fastify.post('/sync-trip', async (request, reply) => {
    const body = request.body as {
      tripData?: TripData
      state?: TripState
      location?: { lat: number; lon: number }
    }

    if (!body.tripData || !body.state) {
      return reply.status(400).send({ error: 'tripData và state là bắt buộc' })
    }

    monitorService.sync(body.tripData, body.state, body.location)
    return { message: 'Đồng bộ thành công', monitoring: body.tripData.tripId }
  })

  fastify.get('/check-incident', async (request) => {
    const { tripId } = request.query as { tripId?: string }
    if (tripId) {
      const event = await monitorService.getLatestOpenEvent(tripId)
      return event ?? { status: 'Ổn định' }
    }
    return monitorService.getLastAlert() ?? { status: 'Ổn định' }
  })

  fastify.post('/report-tired', { preHandler: [verifyToken] }, async (request, reply) => {
    const { tripId } = request.body as { tripId?: string }
    if (!tripId) return reply.status(400).send({ error: 'tripId là bắt buộc' })
    const result = await monitorService.reportUserTired(tripId)
    return {
      message: result.eventId
        ? 'Đã ghi nhận trạng thái mệt mỏi'
        : 'Sự kiện mệt mỏi đã được ghi nhận trước đó',
      eventId: result.eventId,
      affectedSlotIds: result.affectedSlotIds,
    }
  })

  if (process.env.NODE_ENV !== 'production') {
    fastify.post('/mock-incident', async (request) => {
      const {
        type = 'rain_heavy',
        reason = 'Mưa giả lập để test',
        severity = 0.9,
        affectedSlotIds,
        tripId,
        anchorLat,
        anchorLon,
        radiusKm,
        durationHours,
      } = request.body as any

      // Event-centric broadcast: coords provided, no specific trip → system finds all affected trips
      if (anchorLat != null && anchorLon != null && !tripId) {
        const result = await monitorService.broadcastEvent(
          type, reason, severity, anchorLat, anchorLon,
          { radiusKm, durationHours },
        )
        return {
          message: 'Broadcast sự cố thành công',
          mode: 'broadcast',
          affectedTripCount: result.affectedTripCount,
          expiresAt: result.expiresAt,
        }
      }

      // Legacy: inject into a specific trip (or currently-synced trip)
      await monitorService.injectMockAlert({
        type,
        reason,
        severity,
        tripId,
        affectedSlotIds: affectedSlotIds ?? [],
        anchorLat: anchorLat ?? null,
        anchorLon: anchorLon ?? null,
        radiusKm,
        durationHours,
      })
      const alert = monitorService.getLastAlert()
      return {
        message: 'Đã bơm sự cố giả thành công',
        mode: 'single',
        eventId: alert?.eventId,
        affectedSlotCount: alert?.affectedSlotIds?.length ?? 0,
        expiresAt: alert?.expiresAt,
      }
    })

    fastify.post('/simulate-weather', async (request) => {
      const { rainMmPerH = 10 } = (request.body ?? {}) as { rainMmPerH?: number }
      monitorService.setForcedRain(rainMmPerH)
      try {
        await monitorService.runMonitoring()
      } finally {
        monitorService.setForcedRain(null)
      }
      return { message: 'Scan hoàn tất', rainMmPerH }
    })
  }
}
