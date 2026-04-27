import { prisma } from '../lib/prisma';

export interface CollaborativeBoost {
  placeId: number;
  boost: number;
}

const POSITIVE_TYPES = ['poi_rated', 'poi_favorited', 'slot_completed', 'replan_accepted'] as const;

const RATING_BY_TYPE: Record<string, number> = {
  poi_favorited: 0.8,
  slot_completed: 0.5,
  replan_accepted: 0.4,
};

const MAX_SIMILAR_USERS = 10;
const MAX_RESULT = 200;

/**
 * Tính boost cho từng place dựa trên rating của top-N similar users.
 *
 * boost(place) = Σ similarity(u') × effectiveRating(u', place)
 *
 * effectiveRating ưu tiên rating thực, fallback theo loại interaction.
 */
export async function getCollaborativeBoosts(userId: string): Promise<CollaborativeBoost[]> {
  const sims = await prisma.userSimilarity.findMany({
    where: { userId },
    orderBy: { rankPosition: 'asc' },
    take: MAX_SIMILAR_USERS,
    select: { similarUserId: true, similarity: true },
  });
  if (sims.length === 0) return [];

  const simByUser = new Map(sims.map((s) => [s.similarUserId, s.similarity]));
  const similarIds = sims.map((s) => s.similarUserId);

  const interactions = await prisma.interactionLog.findMany({
    where: {
      userId: { in: similarIds },
      interactionType: { in: POSITIVE_TYPES as unknown as string[] },
      placeId: { not: null },
    },
    select: { userId: true, placeId: true, rating: true, interactionType: true },
  });

  const boosts = new Map<number, number>();
  for (const ix of interactions) {
    if (ix.placeId == null) continue;
    const sim = simByUser.get(ix.userId) ?? 0;
    if (sim <= 0) continue;

    let r: number;
    if (ix.interactionType === 'poi_rated') {
      r = ix.rating ?? 0;
      if (r < 0.6) continue; // rating thấp → bỏ qua
    } else {
      r = RATING_BY_TYPE[ix.interactionType] ?? 0.3;
    }

    const placeId = Number(ix.placeId);
    boosts.set(placeId, (boosts.get(placeId) ?? 0) + sim * r);
  }

  const result: CollaborativeBoost[] = [];
  for (const [placeId, boost] of boosts) {
    result.push({ placeId, boost });
  }
  result.sort((a, b) => b.boost - a.boost);
  return result.slice(0, MAX_RESULT);
}
