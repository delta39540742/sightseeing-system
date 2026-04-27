import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { addFavorite, removeFavorite } from '../services/interaction.service';

export async function favoritePlugin(app: FastifyInstance): Promise<void> {
  // ─── C1: POST / ───────────────────────────────────────────────────────────
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const { placeId, tripId } = request.body as any;

      if (!placeId || typeof placeId !== 'number') {
        return reply.status(400).send({ error: 'Bad Request', message: 'placeId (number) là bắt buộc' });
      }

      const result = await addFavorite(userId, placeId, tripId);
      return reply.status(201).send(result);
    } catch (err) {
      request.log.error(err, '[POST /favorite]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── C2: DELETE /:placeId ─────────────────────────────────────────────────
  app.delete('/:placeId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const placeId = parseInt((request.params as any).placeId);

      if (isNaN(placeId)) {
        return reply.status(400).send({ error: 'Bad Request', message: 'placeId không hợp lệ' });
      }

      await removeFavorite(userId, placeId);
      return reply.status(204).send();
    } catch (err) {
      request.log.error(err, '[DELETE /favorite]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
