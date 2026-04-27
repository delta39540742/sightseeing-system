import { prisma } from './prisma';

export type RewardInteractionType =
  | 'poi_accepted'
  | 'poi_rejected'
  | 'slot_completed'
  | 'replan_accepted'
  | 'replan_rejected';

export interface RewardPayload {
  userId: string;
  tripId: string;
  armId: number;
  interactionType: RewardInteractionType;
  placeId?: number;
}

const DEFAULT_ARM_ID = 1; // 'balanced' arm

function prefBaseUrl(): string {
  return process.env.PREFERENCE_SERVICE_URL ?? 'http://localhost:3001';
}

/**
 * Lấy current_arm_id của user. Trả DEFAULT_ARM_ID nếu chưa có row
 * (user chưa làm survey) hoặc query lỗi.
 */
export async function getCurrentArmId(userId: string): Promise<number> {
  try {
    const w = await prisma.user_objective_weights.findUnique({
      where: { user_id: userId },
      select: { current_arm_id: true },
    });
    return w?.current_arm_id ?? DEFAULT_ARM_ID;
  } catch {
    return DEFAULT_ARM_ID;
  }
}

/**
 * Fire-and-forget gửi reward tới preference-service.
 * Không block response — preference-service down chỉ log.
 */
export function sendReward(payload: RewardPayload): void {
  fetch(`${prefBaseUrl()}/api/preferences/internal/reward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => console.error('[preference reward]', payload.interactionType, err));
}

/**
 * Batch gửi poi_accepted cho danh sách place đã được AI gợi ý và user chấp nhận
 * (tức là đã được persist vào trip_slot). Mỗi placeId duy nhất gửi một lần để
 * tránh trùng (nếu trip nhiều ngày và có cùng địa điểm 2 lần).
 */
export function sendPoiAcceptedBatch(args: {
  userId: string;
  tripId: string;
  armId: number;
  placeIds: number[];
}): void {
  const unique = Array.from(new Set(args.placeIds));
  for (const placeId of unique) {
    sendReward({
      userId: args.userId,
      tripId: args.tripId,
      armId: args.armId,
      interactionType: 'poi_accepted',
      placeId,
    });
  }
}
