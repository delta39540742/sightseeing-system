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
 * (user chưa làm survey), arm_id không hợp lệ (<= 0), hoặc query lỗi.
 */
export async function getCurrentArmId(userId: string): Promise<number> {
  try {
    const w = await prisma.user_objective_weights.findUnique({
      where: { user_id: userId },
      select: { current_arm_id: true },
    });
    
    const armId = w?.current_arm_id;
    
    // Kiểm tra chặn cả null, undefined và các giá trị <= 0
    if (armId === null || armId === undefined || armId <= 0) {
      return DEFAULT_ARM_ID;
    }
    
    return armId;
  } catch (error) {
    // Log lỗi để phục vụ debug thay vì nuốt hoàn toàn
    console.error(`[getCurrentArmId] Lỗi database khi lấy armId cho user ${userId}:`, error);
    return DEFAULT_ARM_ID;
  }
}

/**
 * Gửi reward tới preference-service.
 * Trả về Promise để có thể await khi xử lý batch,
 * nhưng khi gọi lẻ tẻ bên ngoài vẫn có thể gọi theo kiểu fire-and-forget.
 */
export async function sendReward(payload: RewardPayload): Promise<void> {
  try {
    const res = await fetch(`${prefBaseUrl()}/api/preferences/internal/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Kiểm tra phản hồi HTTP từ server
    if (!res.ok) {
      console.error(`[preference reward] Lỗi HTTP ${res.status}: ${res.statusText} - Payload:`, payload);
    }
  } catch (err) {
    // Catch các lỗi mạng, kết nối
    console.error('[preference reward] Lỗi Network/Fetch:', payload.interactionType, err);
  }
}

/**
 * Batch gửi poi_accepted cho danh sách place đã được AI gợi ý và user chấp nhận.
 * Xử lý ngầm (fire-and-forget đối với caller) nhưng giới hạn số lượng request 
 * đồng thời để tránh làm quá tải hệ thống.
 */
export function sendPoiAcceptedBatch(args: {
  userId: string;
  tripId: string;
  armId: number;
  placeIds: number[];
}): void {
  const unique = Array.from(new Set(args.placeIds));

  // Chạy ngầm (IIFE) để không block response trả về cho user
  (async () => {
    const CONCURRENCY_LIMIT = 5; // Số lượng request song song tối đa
    
    for (let i = 0; i < unique.length; i += CONCURRENCY_LIMIT) {
      const chunk = unique.slice(i, i + CONCURRENCY_LIMIT);
      
      // Đợi hoàn thành batch hiện tại trước khi gửi batch tiếp theo
      await Promise.all(
        chunk.map((placeId) =>
          sendReward({
            userId: args.userId,
            tripId: args.tripId,
            armId: args.armId,
            interactionType: 'poi_accepted',
            placeId,
          })
        )
      );
    }
  })();
}