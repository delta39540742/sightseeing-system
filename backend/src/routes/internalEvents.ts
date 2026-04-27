import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { InternalEventBus } from '../events/eventBus';

/**
 * Production-safe: nếu NODE_ENV=production và INTERNAL_EVENT_SECRET chưa set
 * → throw lúc boot, KHÔNG cho server start với endpoint mở.
 * Dev: log warning, cho qua để dev local không vỡ.
 */
async function verifyInternalSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expected = process.env.INTERNAL_EVENT_SECRET;
  if (!expected) {
    request.log.warn('[InternalEvents] INTERNAL_EVENT_SECRET chưa set — endpoint đang mở (chỉ dev).');
    return;
  }
  const received = request.headers['x-internal-secret'];
  if (received !== expected) {
    return reply.status(401).send({ success: false, error: 'Unauthorized: invalid internal secret' });
  }
}

const eventBodySchema = {
  type: 'object',
  required: ['event_type'],
  properties: {
    event_type: { type: 'string', minLength: 1, maxLength: 100 },
    payload: { type: 'object', additionalProperties: true },
  },
  additionalProperties: false,
} as const;

export async function internalEventsPlugin(fastify: FastifyInstance): Promise<void> {
  // Boot-time guard: production phải có secret
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_EVENT_SECRET) {
    throw new Error('INTERNAL_EVENT_SECRET phải được set ở production');
  }

  // POST /api/internal/events
  fastify.post(
    '/',
    { preHandler: verifyInternalSecret, schema: { body: eventBodySchema } },
    async (request, reply) => {
    try {
      const { event_type, payload } = request.body as Record<string, any>;

      request.log.info({ event_type }, '[InternalEvents] publish');
      InternalEventBus.publish(event_type, payload || {});

      return reply.status(200).send({
        success: true,
        message: `Emitted event: ${event_type}`,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Error handling internal event');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}
