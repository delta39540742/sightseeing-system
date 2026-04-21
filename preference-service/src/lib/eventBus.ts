import { EventEmitter } from 'events';
import {
  onReplan,
  onSlotDecision,
  onSlotCompleted,
  onLandmarkRecognized,
} from '../services/interaction.service';

/**
 * eventBus — singleton EventEmitter cho toàn service.
 *
 * Các event Người 4/6 emit, Người 8 lắng nghe:
 *   - trip.replan.accepted
 *   - trip.replan.rejected
 *   - trip.slot.accepted
 *   - trip.slot.rejected
 *   - trip.slot.completed
 *   - landmark.recognized
 *
 * Nếu nhóm chuyển sang Redis pub/sub sau, chỉ cần đổi file này,
 * các service bên trong không cần thay đổi.
 */
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);

// ─── Đăng ký listeners ────────────────────────────────────────────────────────

eventBus.on('trip.replan.accepted', async (payload: {
  userId: string;
  tripId: string;
  armId: number;
}) => {
  try {
    await onReplan({ ...payload, accepted: true });
  } catch (err) {
    console.error('[eventBus] trip.replan.accepted error:', err);
  }
});

eventBus.on('trip.replan.rejected', async (payload: {
  userId: string;
  tripId: string;
  armId: number;
}) => {
  try {
    await onReplan({ ...payload, accepted: false });
  } catch (err) {
    console.error('[eventBus] trip.replan.rejected error:', err);
  }
});

eventBus.on('trip.slot.accepted', async (payload: {
  userId: string;
  tripId: string;
  placeId: number;
  armId: number;
}) => {
  try {
    await onSlotDecision({ ...payload, accepted: true });
  } catch (err) {
    console.error('[eventBus] trip.slot.accepted error:', err);
  }
});

eventBus.on('trip.slot.rejected', async (payload: {
  userId: string;
  tripId: string;
  placeId: number;
  armId: number;
}) => {
  try {
    await onSlotDecision({ ...payload, accepted: false });
  } catch (err) {
    console.error('[eventBus] trip.slot.rejected error:', err);
  }
});

eventBus.on('trip.slot.completed', async (payload: {
  userId: string;
  tripId: string;
  placeId: number;
  armId: number;
}) => {
  try {
    await onSlotCompleted(payload);
  } catch (err) {
    console.error('[eventBus] trip.slot.completed error:', err);
  }
});

eventBus.on('landmark.recognized', async (payload: {
  userId: string;
  placeId: number;
  tripId?: string;
  confidence: number;
}) => {
  try {
    await onLandmarkRecognized(payload);
  } catch (err) {
    console.error('[eventBus] landmark.recognized error:', err);
  }
});

console.log('[eventBus] All listeners registered (D1–D5)');
