import type { FastifyInstance } from 'fastify';
import { InternalEventBus } from '../events/eventBus';

export async function internalEventsPlugin(fastify: FastifyInstance): Promise<void> {
  // POST /api/internal/events
  fastify.post('/', async (request, reply) => {
    try {
      const { event_type, payload } = request.body as Record<string, any>;

      if (!event_type) {
        return reply.status(400).send({ success: false, error: 'Missing event_type' });
      }

      console.log(`[EventBus API] Pushing event: ${event_type}`);
      InternalEventBus.publish(event_type, payload || {});

      return reply.status(200).send({
        success: true,
        message: `Emitted event: ${event_type}`,
      });
    } catch (error) {
      console.error('Error handling internal event:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}
