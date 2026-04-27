import type { FastifyInstance } from 'fastify'
import cron from 'node-cron'
import { monitorService, type TripData, type TripState } from '../services/monitorService'

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

  fastify.get('/check-incident', async () => {
    return monitorService.getLastAlert() ?? { status: 'Ổn định' }
  })

  if (process.env.NODE_ENV !== 'production') {
    fastify.post('/mock-incident', async (request, reply) => {
      const { type, reason, severity, affectedSlotIds } = request.body as any
      monitorService.injectMockAlert(
        type || 'rain_heavy',
        reason || 'Mưa giả lập để test',
        severity || 0.9,
        affectedSlotIds || []
      )
      return { message: 'Đã bơm sự cố giả thành công' }
    })
  }
}
