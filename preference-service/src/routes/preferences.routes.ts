import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { getWeights } from '../services/weights.service';
import { getSimilarUsers } from '../services/interaction.service';
import { updatePreferenceVector } from '../services/learning.service';
import { getCollaborativeBoosts } from '../services/collaborative.service';
import { calcBaseWeights } from '../lib/preference';
import { prisma } from '../lib/prisma';

const TAG_LABELS: Record<number, string> = {
  1: 'Bãi biển',
  2: 'Núi & thiên nhiên',
  3: 'Văn hóa & lịch sử',
  4: 'Ẩm thực',
  5: 'Tâm linh',
  6: 'Mua sắm',
  7: 'Giải trí',
  8: 'Công viên',
  9: 'Nghỉ dưỡng',
  10: 'Tham quan',
};

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

  // ─── B4: GET /profile — Trang sở thích: vector + arm stats + lịch sử ────
  app.get('/profile', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const limit = Math.min(parseInt((request.query as any).limit) || 30, 100);

      const [pref, armStats, objWeights, history] = await Promise.all([
        prisma.userPreference.findUnique({ where: { userId } }),
        prisma.userArmStat.findMany({
          where: { userId },
          include: { arm: true },
          orderBy: { pulls: 'desc' },
        }),
        prisma.userObjectiveWeights.findUnique({
          where: { userId },
          include: { arm: true },
        }),
        prisma.interactionLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { place: { select: { name: true } } },
        }),
      ]);

      const preferenceVector = (pref?.preferenceVector ?? []).map((value, i) => ({
        tagId: i + 1,
        label: TAG_LABELS[i + 1] ?? `Tag ${i + 1}`,
        value: Math.round(value * 100) / 100,
      }));

      const arms = armStats.map((s) => ({
        armId:       s.armId,
        name:        s.arm.name,
        pulls:       s.pulls,
        avgReward:   s.pulls > 0 ? Math.round((s.totalReward / s.pulls) * 100) / 100 : 0,
        totalReward: Math.round(s.totalReward * 100) / 100,
        isActive:    s.armId === objWeights?.currentArmId,
      }));

      const interactions = history.map((h) => ({
        interactionId:   h.interactionId.toString(),
        interactionType: h.interactionType,
        placeId:         h.placeId ? Number(h.placeId) : null,
        placeName:       h.place?.name ?? null,
        rating:          h.rating,
        context:         h.context,
        createdAt:       h.createdAt.toISOString(),
      }));

      return reply.send({ preferenceVector, arms, interactions, currentArmId: objWeights?.currentArmId ?? null });
    } catch (err) {
      request.log.error(err, '[GET /profile]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── B5: PATCH /vector — Chỉnh thủ công preference vector ──────────────
  app.patch('/vector', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const { vector } = request.body as { vector: number[] };

      if (!Array.isArray(vector) || vector.length !== 10) {
        return reply.status(400).send({ error: 'vector phải là mảng 10 phần tử' });
      }
      if (vector.some((v) => typeof v !== 'number' || v < 0 || v > 1)) {
        return reply.status(400).send({ error: 'Mỗi phần tử phải trong [0, 1]' });
      }

      const existing = await prisma.userPreference.findUnique({ where: { userId } });
      if (!existing) {
        return reply.status(404).send({ error: 'Chưa có hồ sơ sở thích, hãy làm khảo sát trước' });
      }

      await prisma.userPreference.update({
        where: { userId },
        data: { preferenceVector: vector },
      });

      // Ghi log để có lịch sử
      await prisma.interactionLog.create({
        data: {
          userId,
          interactionType: 'manual_vector_edit',
          context: { source: 'preference_profile_page', vector },
        },
      });

      return reply.send({ message: 'Đã cập nhật sở thích', vector });
    } catch (err) {
      request.log.error(err, '[PATCH /vector]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── B6: PATCH /arm — Chọn thủ công chiến lược (bandit arm) ────────────
  app.patch('/arm', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const { armId } = request.body as { armId: number };

      if (!armId || typeof armId !== 'number' || !Number.isInteger(armId) || armId < 1 || armId > 6) {
        return reply.status(400).send({ error: 'armId phải là số nguyên từ 1 đến 6' });
      }

      const arm = await prisma.banditArm.findUnique({ where: { armId } });
      if (!arm) return reply.status(404).send({ error: 'Arm không tồn tại' });

      const preference = await prisma.userPreference.findUnique({ where: { userId } });
      if (!preference) {
        return reply.status(404).send({ error: 'Chưa có hồ sơ, hãy làm khảo sát trước' });
      }

      const objWeights = await prisma.userObjectiveWeights.findUnique({ where: { userId } });
      if (!objWeights) {
        return reply.status(404).send({ error: 'Chưa có weights, hãy làm khảo sát trước' });
      }

      const baseWeights = calcBaseWeights(preference as any);

      await prisma.userObjectiveWeights.update({
        where: { userId },
        data: {
          currentArmId: arm.armId,
          wInterest: baseWeights.wInterest * arm.wInterest,
          wPace:     baseWeights.wPace     * arm.wPace,
          wDistance: baseWeights.wDistance * arm.wDistance,
          wBudget:   baseWeights.wBudget   * arm.wBudget,
          wWeather:  baseWeights.wWeather  * arm.wWeather,
          wRisk:     baseWeights.wRisk     * arm.wRisk,
        },
      });

      return reply.send({ message: 'Đã chuyển chiến lược', armName: arm.name });
    } catch (err) {
      request.log.error(err, '[PATCH /arm]');
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
