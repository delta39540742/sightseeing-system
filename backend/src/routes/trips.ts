import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { InternalEventBus } from '../events/eventBus';
import { verifyToken } from '../middlewares/authMiddleware';
import { sendReward, getCurrentArmId } from '../lib/preferenceClient';

// ─── Serializers ────────────────────────────────────────────────────────────

function serializePlace(p: any) {
  if (!p) return undefined;
  return {
    placeId: Number(p.place_id),
    name: p.name,
    description: p.description ?? null,
    lat: p.lat,
    lng: p.lng,
    indoorOutdoor: p.indoor_outdoor,
    avgVisitDurationMin: p.avg_visit_duration_min,
    minPrice: p.min_price ?? null,
    maxPrice: p.max_price ?? null,
    priceType: p.price_type,
    isLandmark: p.is_landmark,
    imageUrl: p.place_image?.url ?? null,
    tags: (p.place_tag_map ?? []).map((m: any) => ({
      tagId: m.tag_id,
      name: m.place_tag?.name ?? null,
    })),
    openingHours: (p.place_opening_hour ?? []).map((h: any) => ({
      dayOfWeek: h.day_of_week,
      openTime: h.open_time,
      closeTime: h.close_time,
    })),
  };
}

function serializeSlot(s: any) {
  return {
    slotId: s.slot_id,
    tripId: s.trip_id,
    dayIndex: s.day_index,
    slotOrder: s.slot_order,
    placeId: Number(s.place_id),
    place: serializePlace(s.place),
    plannedStart: s.planned_start,
    plannedEnd: s.planned_end,
    estimatedCost: s.estimated_cost,
    activityType: s.activity_type,
    status: s.status,
    rationale: s.rationale ?? null,
  };
}

function serializeTrip(t: any) {
  return {
    tripId: t.trip_id,
    userId: t.user_id,
    title: t.title ?? null,
    destinationCity: t.destination_city,
    startDate: t.start_date,
    endDate: t.end_date,
    status: t.status,
    budgetTotal: t.budget_total,
    objectiveScore: t.objective_score ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at ?? null,
    slots: (t.trip_slot ?? []).map(serializeSlot),
  };
}

const slotInclude = {
  where: { status: { not: 'replaced' as const } },
  include: {
    place: {
      include: {
        place_image: true,
        place_tag_map: { include: { place_tag: true } },
        place_opening_hour: true,
      },
    },
  },
  orderBy: [{ day_index: 'asc' as const }, { slot_order: 'asc' as const }],
};

// ─── Plugin ─────────────────────────────────────────────────────────────────

export async function tripsPlugin(fastify: FastifyInstance): Promise<void> {

  // GET /api/trips — danh sách trips của user (loại trừ đã xóa mềm)
  fastify.get('/', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const appUser = await prisma.app_user.findUnique({
        where: { firebase_uid: request.user!.uid },
      });
      if (!appUser) return reply.status(401).send({ error: 'User not found' });

      const trips = await prisma.trip.findMany({
        where: { user_id: appUser.user_id, deleted_at: null },
        include: { trip_slot: slotInclude },
        orderBy: { created_at: 'desc' },
      });

      return reply.send(trips.map(serializeTrip));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/trips/deleted — danh sách trips đã xóa mềm
  fastify.get('/deleted', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const appUser = await prisma.app_user.findUnique({
        where: { firebase_uid: request.user!.uid },
      });
      if (!appUser) return reply.status(401).send({ error: 'User not found' });

      const trips = await prisma.trip.findMany({
        where: { user_id: appUser.user_id, deleted_at: { not: null } },
        include: { trip_slot: slotInclude },
        orderBy: { deleted_at: 'desc' },
      });

      return reply.send(trips.map(serializeTrip));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/trips/:tripId
  fastify.get<{ Params: { tripId: string } }>(
    '/:tripId',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const trip = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id, deleted_at: null },
          include: { trip_slot: slotInclude },
        });
        if (!trip) return reply.status(404).send({ error: 'Trip not found' });

        return reply.send(serializeTrip(trip));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // POST /api/trips
  const createTripBodySchema = {
    type: 'object',
    required: ['destination_city', 'start_date', 'end_date', 'budget_total'],
    properties: {
      destination_city: { type: 'string', minLength: 1, maxLength: 100 },
      start_date:       { type: 'string' },
      end_date:         { type: 'string' },
      budget_total:     { type: ['number', 'string'] },
      raw_prompt:       { type: 'string', maxLength: 2000 },
    },
    additionalProperties: false,
  } as const;

  fastify.post('/', { preHandler: verifyToken, schema: { body: createTripBodySchema } }, async (request, reply) => {
    try {
      const { destination_city, start_date, end_date, budget_total, raw_prompt } =
        request.body as Record<string, any>;

      if (!destination_city || !start_date || !end_date || budget_total === undefined) {
        return reply.status(400).send({ success: false, error: 'Missing required configuration fields.' });
      }

      const startD = new Date(start_date);
      const endD   = new Date(end_date);
      if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
        return reply.status(400).send({ success: false, error: 'start_date hoặc end_date không hợp lệ' });
      }
      if (endD.getTime() < startD.getTime()) {
        return reply.status(400).send({ success: false, error: 'end_date phải >= start_date' });
      }

      // user lấy từ Firebase token (đã verify), bỏ qua user_id trong body
      const appUser = await prisma.app_user.findUnique({
        where: { firebase_uid: request.user!.uid },
      });
      if (!appUser) return reply.status(401).send({ success: false, error: 'User not found' });

      const newTrip = await prisma.trip.create({
        data: {
          user_id: appUser.user_id,
          destination_city,
          start_date: startD,
          end_date:   endD,
          budget_total: parseInt(budget_total),
          raw_prompt: raw_prompt || null,
          status: 'draft',
        },
      });

      InternalEventBus.publish('trip.created', { trip_id: newTrip.trip_id, user_id: request.user!.uid });

      return reply.status(201).send({
        success: true,
        message: 'Trip initialized successfully as draft.',
        data: newTrip,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ success: false, error: 'Internal server error while creating trip' });
    }
  });

  // PATCH /api/trips/:tripId
  fastify.patch<{ Params: { tripId: string } }>(
    '/:tripId',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const existing = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id },
        });
        if (!existing) return reply.status(404).send({ error: 'Trip not found' });

        const body = request.body as Record<string, any>;
        const updated = await prisma.trip.update({
          where: { trip_id: request.params.tripId },
          data: {
            ...(body.title !== undefined && { title: body.title }),
            ...(body.status !== undefined && { status: body.status }),
            ...(body.destination_city !== undefined && { destination_city: body.destination_city }),
            ...(body.start_date !== undefined && { start_date: new Date(body.start_date) }),
            ...(body.end_date !== undefined && { end_date: new Date(body.end_date) }),
            ...(body.budget_total !== undefined && { budget_total: parseInt(body.budget_total) }),
            updated_at: new Date(),
          },
          include: { trip_slot: slotInclude },
        });

        return reply.send(serializeTrip(updated));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // DELETE /api/trips/:tripId — xóa mềm (chuyển vào thùng rác)
  fastify.delete<{ Params: { tripId: string } }>(
    '/:tripId',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const existing = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id, deleted_at: null },
        });
        if (!existing) return reply.status(404).send({ error: 'Trip not found' });

        await prisma.trip.update({
          where: { trip_id: request.params.tripId },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });

        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // PATCH /api/trips/:tripId/restore — khôi phục trip từ thùng rác
  fastify.patch<{ Params: { tripId: string } }>(
    '/:tripId/restore',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const existing = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id, deleted_at: { not: null } },
        });
        if (!existing) return reply.status(404).send({ error: 'Trip not found in trash' });

        const restored = await prisma.trip.update({
          where: { trip_id: request.params.tripId },
          data: { deleted_at: null, updated_at: new Date() },
          include: { trip_slot: slotInclude },
        });

        return reply.send(serializeTrip(restored));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // DELETE /api/trips/:tripId/permanent — xóa vĩnh viễn
  fastify.delete<{ Params: { tripId: string } }>(
    '/:tripId/permanent',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const existing = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id },
        });
        if (!existing) return reply.status(404).send({ error: 'Trip not found' });

        await prisma.trip.delete({ where: { trip_id: request.params.tripId } });

        return reply.status(204).send();
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
  // POST /api/trips/:tripId/slots — thêm một địa điểm vào trip
  fastify.post<{ Params: { tripId: string }; Body: { placeId: number; dayIndex?: number } }>(
    '/:tripId/slots',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        })
        if (!appUser) return reply.status(401).send({ error: 'User not found' })

        const trip = await prisma.trip.findFirst({
          where: { trip_id: request.params.tripId, user_id: appUser.user_id },
          include: {
            trip_slot: { orderBy: [{ day_index: 'asc' }, { slot_order: 'asc' }] },
          },
        })
        if (!trip) return reply.status(404).send({ error: 'Trip not found' })

        const place = await prisma.place.findUnique({
          where: { place_id: BigInt(request.body.placeId) },
        })
        if (!place) return reply.status(404).send({ error: 'Place not found' })

        // Xác định dayIndex và slotOrder
        const targetDay = request.body.dayIndex ?? 0
        const slotsOnDay = trip.trip_slot.filter((s) => s.day_index === targetDay)

        // Duplicate check: cùng place trong cùng ngày → 409
        const dup = slotsOnDay.find((s) => Number(s.place_id) === request.body.placeId)
        if (dup) {
          return reply.status(409).send({
            error: 'DUPLICATE_PLACE',
            message: `Place ${request.body.placeId} đã có trong ngày ${targetDay}`,
          })
        }

        const nextOrder = slotsOnDay.length > 0
          ? Math.max(...slotsOnDay.map((s) => s.slot_order)) + 1
          : 0

        // Tính thời gian: sau slot cuối cùng trong ngày + 15 phút đi lại
        const lastSlot = slotsOnDay[slotsOnDay.length - 1]
        const startBase = lastSlot
          ? new Date(lastSlot.planned_end.getTime() + 15 * 60_000)
          : new Date(trip.start_date.getTime() + targetDay * 86_400_000 + 8 * 3600_000)
        const plannedEnd = new Date(startBase.getTime() + (place.avg_visit_duration_min ?? 60) * 60_000)

        const newSlot = await prisma.trip_slot.create({
          data: {
            trip_id:        trip.trip_id,
            day_index:      targetDay,
            slot_order:     nextOrder,
            place_id:       BigInt(request.body.placeId),
            planned_start:  startBase,
            planned_end:    plannedEnd,
            estimated_cost: place.min_price ?? 0,
            activity_type:  'sightseeing',
            status:         'planned',
          },
          include: {
            place: {
              include: { place_image: true, place_tag_map: { include: { place_tag: true } }, place_opening_hour: true },
            },
          },
        })

        return reply.status(201).send(serializeSlot(newSlot))
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Internal server error' })
      }
    },
  )

  // PATCH /api/trips/:tripId/slots/:slotId — cập nhật trạng thái slot (VD: completed)
  fastify.patch<{ Params: { tripId: string; slotId: string }; Body: { status: string } }>(
    '/:tripId/slots/:slotId',
    { preHandler: verifyToken },
    async (request, reply) => {
      try {
        const appUser = await prisma.app_user.findUnique({
          where: { firebase_uid: request.user!.uid },
        });
        if (!appUser) return reply.status(401).send({ error: 'User not found' });

        const slot = await prisma.trip_slot.findFirst({
          where: {
            slot_id: request.params.slotId,
            trip: { trip_id: request.params.tripId, user_id: appUser.user_id },
          },
        });
        if (!slot) return reply.status(404).send({ error: 'Slot not found' });

        const { status } = request.body;
        const updated = await prisma.trip_slot.update({
          where: { slot_id: request.params.slotId },
          data: { status },
          include: {
            place: {
              include: {
                place_image: true,
                place_tag_map: { include: { place_tag: true } },
                place_opening_hour: true,
              },
            },
          },
        });

        if (status === 'completed' || status === 'skipped') {
          const armId = await getCurrentArmId(appUser.user_id);
          sendReward({
            userId: appUser.user_id,
            tripId: request.params.tripId,
            placeId: Number(slot.place_id),
            armId,
            interactionType: status === 'completed' ? 'slot_completed' : 'poi_rejected',
          });
        }

        return reply.send(serializeSlot(updated));
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  )
}
