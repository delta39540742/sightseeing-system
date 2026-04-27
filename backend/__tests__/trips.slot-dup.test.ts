import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../src/middlewares/authMiddleware', () => ({
  verifyToken: async (req: any) => {
    req.user = { uid: 'fb-uid-1' };
  },
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    app_user:    { findUnique: vi.fn() },
    trip:        { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    place:       { findUnique: vi.fn() },
    trip_slot:   { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    user_objective_weights: { findUnique: vi.fn() },
  },
}));

vi.mock('../src/events/eventBus', () => ({
  InternalEventBus: { publish: vi.fn() },
}));

vi.mock('../src/lib/preferenceClient', () => ({
  sendReward: vi.fn(),
  getCurrentArmId: vi.fn().mockResolvedValue(1),
}));

import { tripsPlugin } from '../src/routes/trips';
import { prisma } from '../src/lib/prisma';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(tripsPlugin, { prefix: '/api/trips' });
  await app.ready();
  return app;
}

const TRIP_ID = '00000000-0000-0000-0000-000000000001';

describe('POST /api/trips/:tripId/slots — duplicate place check', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue({ user_id: 'user-uuid-1' });
    (prisma.place.findUnique as any).mockResolvedValue({
      place_id: 100n,
      avg_visit_duration_min: 60,
      min_price: 0,
    });
  });
  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns 409 when place already in same day', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue({
      trip_id: TRIP_ID,
      user_id: 'user-uuid-1',
      start_date: new Date('2026-05-01'),
      trip_slot: [
        { day_index: 0, slot_order: 0, place_id: 100n, planned_end: new Date('2026-05-01T10:00:00Z') },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/slots`,
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
      payload: { placeId: 100, dayIndex: 0 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('DUPLICATE_PLACE');
  });

  it('allows same place on different day', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue({
      trip_id: TRIP_ID,
      user_id: 'user-uuid-1',
      start_date: new Date('2026-05-01'),
      trip_slot: [
        { day_index: 0, slot_order: 0, place_id: 100n, planned_end: new Date('2026-05-01T10:00:00Z') },
      ],
    });
    (prisma.trip_slot.create as any).mockResolvedValue({
      slot_id: 's-1',
      trip_id: TRIP_ID,
      day_index: 1,
      slot_order: 0,
      place_id: 100n,
      planned_start: new Date(),
      planned_end: new Date(),
      estimated_cost: 0,
      activity_type: 'sightseeing',
      status: 'planned',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/slots`,
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
      payload: { placeId: 100, dayIndex: 1 },
    });

    expect(res.statusCode).toBe(201);
  });

  it('returns 404 when trip not found', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/slots`,
      headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
      payload: { placeId: 100, dayIndex: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});
