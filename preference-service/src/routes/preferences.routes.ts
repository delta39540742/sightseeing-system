import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { getWeights } from '../services/weights.service';
import { getSimilarUsers } from '../services/interaction.service';
import { updatePreferenceVector } from '../services/learning.service';
import { getCollaborativeBoosts } from '../services/collaborative.service';
import { prisma } from '../lib/prisma';

export async function preferencesPlugin(app: FastifyInstance): Promise<void> {
  // ─── B1: GET /weights ─────────────────────────────────────────────────────
  app.get('/weights', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const context = (request.query as any).context ?? 'plan';

      const result = await getWeights(userId);
      return reply.send({ ...result, context });
    } catch (err) {
      request.log.error(err, '[GET /weights]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── B1b: GET /collaborative-boost — boost từ similar users' ratings ─────
  app.get('/collaborative-boost', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const result = await getCollaborativeBoosts(userId);
      return reply.send({ boosts: result });
    } catch (err) {
      request.log.error(err, '[GET /collaborative-boost]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── B2: GET /similar-users ───────────────────────────────────────────────
  app.get('/similar-users', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const limit = Math.min(parseInt((request.query as any).limit) || 10, 50);

      const result = await getSimilarUsers(userId, limit);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, '[GET /similar-users]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── B3: POST /rating — User đánh giá địa điểm sau khi visit ────────────
  app.post('/rating', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const { placeId, tripId, rating } = request.body as any;

      if (!placeId || typeof placeId !== 'number') {
        return reply.status(400).send({ error: 'Bad Request', message: 'placeId (number) là bắt buộc' });
      }
      if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return reply.status(400).send({ error: 'Bad Request', message: 'rating phải là số trong [1,5]' });
      }

      // Lưu interaction log
      await prisma.interactionLog.create({
        data: {
          userId,
          placeId: BigInt(placeId),
          tripId: tripId ?? null,
          interactionType: 'poi_rated',
          rating: rating / 5.0,        // normalize về [0,1]
          context: { rawRating: rating, source: 'user_rating' },
        },
      });

      // Cập nhật preference vector: rating cao → nudge mạnh về phía tags của place
      // Strength: 1.0 ở rating 5, 0.0 ở rating 3 (trung lập), -0.5 ở rating 1
      const strength = (rating - 3) / 2;   // [-1, 1] → scale về [-0.5, 1.0]
      await updatePreferenceVector(userId, placeId, strength);

      return reply.status(201).send({ message: 'Rating recorded', normalizedRating: rating / 5.0 });
    } catch (err) {
      request.log.error(err, '[POST /rating]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
