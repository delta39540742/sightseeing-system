import type { FastifyInstance } from 'fastify';
import {
  onReplan,
  onSlotDecision,
  onSlotCompleted,
} from '../services/interaction.service';

export async function internalPlugin(app: FastifyInstance): Promise<void> {
  /**
   * POST /reward
   * Called by backend after replan accept/reject or slot events.
   * No auth required — internal service call.
   *
   * Body: { userId, tripId, armId, interactionType, placeId? }
   * interactionType: 'replan_accepted' | 'replan_rejected'
   *                | 'poi_accepted' | 'poi_rejected' | 'slot_completed'
   */
  app.post('/reward', async (request, reply) => {
    const { userId, tripId, placeId, armId, interactionType } = request.body as {
      userId: string;
      tripId: string;
      placeId?: number;
      armId: number;
      interactionType: string;
    };

    if (!userId || armId == null || !interactionType) {
      return reply.status(400).send({ error: 'Missing required fields: userId, armId, interactionType' });
    }

    try {
      switch (interactionType) {
        case 'replan_accepted':
          await onReplan({ userId, tripId, armId, accepted: true });
          break;
        case 'replan_rejected':
          await onReplan({ userId, tripId, armId, accepted: false });
          break;
        case 'poi_accepted':
          await onSlotDecision({ userId, tripId, placeId: placeId!, armId, accepted: true });
          break;
        case 'poi_rejected':
          await onSlotDecision({ userId, tripId, placeId: placeId!, armId, accepted: false });
          break;
        case 'slot_completed':
          await onSlotCompleted({ userId, tripId, placeId: placeId!, armId });
          break;
        default:
          return reply.status(400).send({ error: `Unknown interactionType: ${interactionType}` });
      }
      return reply.status(204).send();
    } catch (err) {
      request.log.error(err, '[internal/reward]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
