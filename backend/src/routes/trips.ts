import type { FastifyInstance } from 'fastify';
import { prisma } from '../server';
import { InternalEventBus } from '../events/eventBus';

export async function tripsPlugin(fastify: FastifyInstance): Promise<void> {
  // POST /api/trips
  fastify.post('/', async (request, reply) => {
    try {
      const { user_id, destination_city, start_date, end_date, budget_total, raw_prompt } =
        request.body as Record<string, any>;

      if (!user_id || !destination_city || !start_date || !end_date || budget_total === undefined) {
        return reply.status(400).send({ success: false, error: 'Missing required configuration fields.' });
      }

      const newTrip = await prisma.trip.create({
        data: {
          user_id,
          destination_city,
          start_date: new Date(start_date),
          end_date: new Date(end_date),
          budget_total: parseInt(budget_total),
          raw_prompt: raw_prompt || null,
          status: 'draft',
        },
      });

      InternalEventBus.publish('trip.created', { trip_id: newTrip.trip_id, user_id });

      return reply.status(201).send({
        success: true,
        message: 'Trip initialized successfully as draft.',
        data: newTrip,
      });
    } catch (error) {
      console.error('Error creating trip:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error while creating trip' });
    }
  });
}
