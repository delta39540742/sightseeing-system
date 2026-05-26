import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { verifyToken } from '../middlewares/authMiddleware'

function serializeNotification(n: {
  notification_id: string
  user_id: string
  trip_id: string | null
  type: string
  title: string
  message: string
  data: unknown
  read_at: Date | null
  created_at: Date
}) {
  return {
    notificationId: n.notification_id,
    tripId: n.trip_id,
    type: n.type,
    title: n.title,
    message: n.message,
    data: n.data ?? null,
    readAt: n.read_at,
    createdAt: n.created_at,
  }
}

async function resolveUser(uid: string) {
  return prisma.app_user.findUnique({ where: { firebase_uid: uid } })
}

export async function notificationsPlugin(fastify: FastifyInstance): Promise<void> {
  // GET /api/notifications?limit=50&unreadOnly=false
  fastify.get<{ Querystring: { limit?: string; unreadOnly?: string } }>(
    '/',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await resolveUser(request.user!.uid)
        if (!appUser) return reply.status(401).send({ error: 'User not found' })

        const limitRaw = parseInt(request.query.limit ?? '50', 10)
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50
        const unreadOnly = request.query.unreadOnly === 'true'

        const where = {
          user_id: appUser.user_id,
          ...(unreadOnly ? { read_at: null } : {}),
        }

        const [items, unreadCount] = await Promise.all([
          prisma.notification.findMany({
            where,
            orderBy: { created_at: 'desc' },
            take: limit,
          }),
          prisma.notification.count({
            where: { user_id: appUser.user_id, read_at: null },
          }),
        ])

        return reply.send({
          items: items.map(serializeNotification),
          unreadCount,
        })
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // PATCH /api/notifications/:id/read
  fastify.patch<{ Params: { id: string } }>(
    '/:id/read',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await resolveUser(request.user!.uid)
        if (!appUser) return reply.status(401).send({ error: 'User not found' })

        const result = await prisma.notification.updateMany({
          where: { notification_id: request.params.id, user_id: appUser.user_id, read_at: null },
          data: { read_at: new Date() },
        })

        if (result.count === 0) return reply.status(404).send({ error: 'Notification not found' })
        return reply.status(204).send()
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // PATCH /api/notifications/read-all
  fastify.patch('/read-all', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const appUser = await resolveUser(request.user!.uid)
      if (!appUser) return reply.status(401).send({ error: 'User not found' })

      const result = await prisma.notification.updateMany({
        where: { user_id: appUser.user_id, read_at: null },
        data: { read_at: new Date() },
      })

      return reply.send({ updated: result.count })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // DELETE /api/notifications/:id
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await resolveUser(request.user!.uid)
        if (!appUser) return reply.status(401).send({ error: 'User not found' })

        const result = await prisma.notification.deleteMany({
          where: { notification_id: request.params.id, user_id: appUser.user_id },
        })

        if (result.count === 0) return reply.status(404).send({ error: 'Notification not found' })
        return reply.status(204).send()
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // DELETE /api/notifications — xoá hết notifications của user
  fastify.delete('/', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const appUser = await resolveUser(request.user!.uid)
      if (!appUser) return reply.status(401).send({ error: 'User not found' })

      const result = await prisma.notification.deleteMany({
        where: { user_id: appUser.user_id },
      })

      return reply.send({ deleted: result.count })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
