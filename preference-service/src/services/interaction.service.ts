import { prisma } from '../lib/prisma';
import { processBanditReward } from './weights.service';
import { updatePreferenceVector, autoUpdateSoftConstraints } from './learning.service';

// ─── C1: POST favorite ────────────────────────────────────────────────────────

export async function addFavorite(userId: string, placeId: number, tripId?: string) {
  // Ghi vào interaction_log
  const log = await prisma.interactionLog.create({
    data: {
      userId,
      placeId,
      tripId: tripId ?? null,
      interactionType: 'poi_favorited',
      rating: 1.0,
      context: { source: 'favorite_button' },
    },
  });

  // Tín hiệu tích cực mạnh: nudge vector về phía tags của place
  updatePreferenceVector(userId, placeId, 0.5).catch(() => {});

  return {
    favoriteId: log.interactionId.toString(),
    createdAt: log.createdAt.toISOString(),
  };
}

// ─── C2: DELETE favorite ──────────────────────────────────────────────────────

export async function removeFavorite(userId: string, placeId: number) {
  // Xóa record favorite gần nhất của user với place này
  const log = await prisma.interactionLog.findFirst({
    where: { userId, placeId, interactionType: 'poi_favorited' },
    orderBy: { createdAt: 'desc' },
  });

  if (!log) return; // Idempotent - không throw nếu chưa có

  await prisma.interactionLog.delete({ where: { interactionId: log.interactionId } });
}

// ─── B2: GET similar users ────────────────────────────────────────────────────

export async function getSimilarUsers(userId: string, limit: number = 10) {
  const rows = await prisma.userSimilarity.findMany({
    where: { userId },
    orderBy: { rankPosition: 'asc' },
    take: limit,
  });

  // Kiểm tra độ cũ của data (isStale nếu > 24h)
  const isStale =
    rows.length === 0 ||
    Date.now() - rows[0].computedAt.getTime() > 24 * 60 * 60 * 1000;

  return {
    items: rows.map((r) => ({
      userId:       r.similarUserId,
      similarity:   r.similarity,
      rankPosition: r.rankPosition,
    })),
    computedAt: rows[0]?.computedAt.toISOString() ?? null,
    isStale,
  };
}

// ─── D: Event listeners ───────────────────────────────────────────────────────
// Các hàm này được gọi bởi event bus (EventEmitter hoặc Redis sub)

/**
 * D1/D2: trip.replan.accepted / trip.replan.rejected
 */
export async function onReplan(payload: {
  userId: string;
  tripId: string;
  armId: number;
  accepted: boolean;
}) {
  const eventType = payload.accepted ? 'replan_accepted' : 'replan_rejected';

  await prisma.interactionLog.create({
    data: {
      userId:          payload.userId,
      tripId:          payload.tripId,
      interactionType: eventType,
      rating:          payload.accepted ? 1.0 : 0.0,
      context:         { armId: payload.armId },
    },
  });

  // Update bandit
  await processBanditReward(payload.userId, payload.armId, eventType);
}

/**
 * D3: trip.slot_accepted / trip.slot_rejected
 */
export async function onSlotDecision(payload: {
  userId: string;
  tripId: string;
  placeId: number;
  armId: number;
  accepted: boolean;
}) {
  const eventType = payload.accepted ? 'poi_accepted' : 'poi_rejected';

  await prisma.interactionLog.create({
    data: {
      userId:          payload.userId,
      placeId:         payload.placeId,
      tripId:          payload.tripId,
      interactionType: eventType,
      rating:          payload.accepted ? 1.0 : 0.0,
      context:         { armId: payload.armId },
    },
  });

  await processBanditReward(payload.userId, payload.armId, eventType);

  // Cập nhật preference vector từ quyết định của user
  const strength = payload.accepted ? 0.2 : -0.15;
  updatePreferenceVector(payload.userId, payload.placeId, strength).catch(() => {});

  // Nếu reject liên tục → tự học avoid_category
  if (!payload.accepted) {
    autoUpdateSoftConstraints(payload.userId).catch(() => {});
  }
}

/**
 * D4: trip.slot.completed
 */
export async function onSlotCompleted(payload: {
  userId: string;
  tripId: string;
  placeId: number;
  armId: number;
}) {
  await prisma.interactionLog.create({
    data: {
      userId:          payload.userId,
      placeId:         payload.placeId,
      tripId:          payload.tripId,
      interactionType: 'slot_completed',
      rating:          1.0,
      context:         { armId: payload.armId },
    },
  });

  // Hoàn thành slot là tín hiệu tích cực mạnh
  await processBanditReward(payload.userId, payload.armId, 'slot_completed');

  // Hoàn thành → nudge vector về phía tags của địa điểm đó
  updatePreferenceVector(payload.userId, payload.placeId, 0.3).catch(() => {});
}

/**
 * D5: landmark.recognized — tín hiệu yếu (chụp ảnh)
 * Không cập nhật bandit vì không rõ arm nào đang được dùng
 */
export async function onLandmarkRecognized(payload: {
  userId: string;
  placeId: number;
  tripId?: string;
  confidence: number;
}) {
  // Chỉ log nếu confidence đủ cao (tránh false positive)
  if (payload.confidence < 0.6) return;

  await prisma.interactionLog.create({
    data: {
      userId:          payload.userId,
      placeId:         payload.placeId,
      tripId:          payload.tripId ?? null,
      interactionType: 'poi_rated',
      rating:          0.3,
      context:         {
        source:     'landmark_recognition',
        confidence: payload.confidence,
      },
    },
  });

  // Tín hiệu yếu nhưng vẫn có giá trị: user đang ở đây và chụp ảnh
  const strengthFromConfidence = 0.1 * payload.confidence;
  updatePreferenceVector(payload.userId, payload.placeId, strengthFromConfidence).catch(() => {});
}
