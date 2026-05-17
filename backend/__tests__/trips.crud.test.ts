/**
 * trips.crud.test.ts
 *
 * Kiểm thử các endpoint chưa được bao phủ trong tripsPlugin:
 *   - GET  /api/trips              — danh sách trips
 *   - GET  /api/trips/deleted      — thùng rác
 *   - GET  /api/trips/:tripId      — trip theo ID
 *   - POST /api/trips              — tạo trip mới
 *   - DELETE /api/trips/:tripId    — xóa mềm
 *   - PATCH  /api/trips/:tripId/restore     — khôi phục
 *   - DELETE /api/trips/:tripId/permanent   — xóa vĩnh viễn
 *   - PATCH  /api/trips/:tripId/slots/:slotId — cập nhật slot status
 */

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
import { InternalEventBus } from '../src/events/eventBus';
import { sendReward, getCurrentArmId } from '../src/lib/preferenceClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(tripsPlugin, { prefix: '/api/trips' });
  await app.ready();
  return app;
}

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const SLOT_ID = 'slot-uuid-0001';

function makeTripRow(overrides: Record<string, any> = {}) {
  return {
    trip_id: TRIP_ID,
    user_id: 'user-uuid-1',
    title: 'Đà Nẵng Trip',
    destination_city: 'Da Nang',
    start_date: new Date('2026-05-01'),
    end_date: new Date('2026-05-03'),
    status: 'draft',
    budget_total: 2_000_000,
    objective_score: null,
    created_at: new Date('2026-04-01'),
    updated_at: new Date('2026-04-01'),
    deleted_at: null,
    trip_slot: [],
    ...overrides,
  };
}

function makeSlotRow(overrides: Record<string, any> = {}) {
  return {
    slot_id: SLOT_ID,
    trip_id: TRIP_ID,
    day_index: 0,
    slot_order: 0,
    place_id: 100n,
    planned_start: new Date('2026-05-01T09:00:00Z'),
    planned_end: new Date('2026-05-01T10:00:00Z'),
    estimated_cost: 50_000,
    activity_type: 'sightseeing',
    status: 'planned',
    is_locked: false,
    rationale: null,
    place: null,
    ...overrides,
  };
}

const APP_USER = { user_id: 'user-uuid-1' };
// Sử dụng cho các request CÓ body JSON
const JSON_AUTH = { authorization: 'Bearer fake', 'content-type': 'application/json' };
// Sử dụng cho các request KHÔNG có body (GET, DELETE, PATCH không cần body)
const AUTH_ONLY = { authorization: 'Bearer fake' };

// ---------------------------------------------------------------------------
// GET /api/trips
// ---------------------------------------------------------------------------

describe('GET /api/trips — danh sách trips của user', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với mảng trips khi user tồn tại', async () => {
    (prisma.trip.findMany as any).mockResolvedValue([makeTripRow()]);
    const res = await app.inject({ method: 'GET', url: '/api/trips', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].tripId).toBe(TRIP_ID);
  });

  it('trả về mảng rỗng khi user không có trip nào', async () => {
    (prisma.trip.findMany as any).mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/trips', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('trả về 401 khi user không tồn tại trong DB', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/trips', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(401);
  });

  it('trả về 500 khi DB ném lỗi', async () => {
    (prisma.trip.findMany as any).mockRejectedValue(new Error('DB down'));
    const res = await app.inject({ method: 'GET', url: '/api/trips', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/trips/deleted
// ---------------------------------------------------------------------------

describe('GET /api/trips/deleted — trips trong thùng rác', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với trips đã xóa mềm', async () => {
    const deletedTrip = makeTripRow({ deleted_at: new Date('2026-04-10') });
    (prisma.trip.findMany as any).mockResolvedValue([deletedTrip]);
    const res = await app.inject({ method: 'GET', url: '/api/trips/deleted', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('trả về mảng rỗng khi không có trip nào trong thùng rác', async () => {
    (prisma.trip.findMany as any).mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/trips/deleted', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('trả về 401 khi user không tồn tại', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/trips/deleted', headers: AUTH_ONLY });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/trips/:tripId
// ---------------------------------------------------------------------------

describe('GET /api/trips/:tripId — lấy trip theo ID', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với trip object khi tìm thấy', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(makeTripRow());
    const res = await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}`, headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    expect(res.json().tripId).toBe(TRIP_ID);
  });

  it('trả về 404 khi trip không tồn tại', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}`, headers: AUTH_ONLY });
    expect(res.statusCode).toBe(404);
  });

  it('trả về 401 khi user không tồn tại trong DB', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}`, headers: AUTH_ONLY });
    expect(res.statusCode).toBe(401);
  });

  it('slots được serialize đúng khi trip có slot', async () => {
    const tripWithSlot = makeTripRow({ trip_slot: [makeSlotRow()] });
    (prisma.trip.findFirst as any).mockResolvedValue(tripWithSlot);
    const res = await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}`, headers: AUTH_ONLY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slots).toHaveLength(1);
    expect(body.slots[0].slotId).toBe(SLOT_ID);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips
// ---------------------------------------------------------------------------

describe('POST /api/trips — tạo trip mới', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
    (prisma.trip.create as any).mockResolvedValue(makeTripRow());
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 201 với trip object sau khi tạo thành công', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: '2026-05-01',
        end_date: '2026-05-03',
        budget_total: 2_000_000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it('trả về 400 khi thiếu destination_city', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: { start_date: '2026-05-01', end_date: '2026-05-03', budget_total: 1_000_000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi start_date không hợp lệ', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: 'not-a-date',
        end_date: '2026-05-03',
        budget_total: 1_000_000,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi end_date < start_date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: '2026-05-05',
        end_date: '2026-05-01',
        budget_total: 1_000_000,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 401 khi user không tồn tại trong DB', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: '2026-05-01',
        end_date: '2026-05-03',
        budget_total: 1_000_000,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('publish sự kiện trip.created sau khi tạo thành công', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: '2026-05-01',
        end_date: '2026-05-03',
        budget_total: 1_000_000,
      },
    });
    expect(InternalEventBus.publish).toHaveBeenCalledWith(
      'trip.created',
      expect.objectContaining({ trip_id: TRIP_ID }),
    );
  });

  it('trip được tạo với status = draft', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/trips',
      headers: JSON_AUTH,
      payload: {
        destination_city: 'Da Nang',
        start_date: '2026-05-01',
        end_date: '2026-05-03',
        budget_total: 1_000_000,
      },
    });
    expect(prisma.trip.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/trips/:tripId — xóa mềm
// ---------------------------------------------------------------------------

describe('DELETE /api/trips/:tripId — xóa mềm', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
    (prisma.trip.findFirst as any).mockResolvedValue(makeTripRow());
    (prisma.trip.update as any).mockResolvedValue(makeTripRow({ deleted_at: new Date() }));
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 204 khi xóa mềm thành công', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(204);
  });

  it('trả về 404 khi trip không tồn tại hoặc đã bị xóa mềm', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('trả về 401 khi user không tồn tại', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/trips/:tripId/restore
// ---------------------------------------------------------------------------

describe('PATCH /api/trips/:tripId/restore — khôi phục từ thùng rác', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với trip đã khôi phục (deleted_at = null)', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(makeTripRow({ deleted_at: new Date('2026-04-10') }));
    (prisma.trip.update as any).mockResolvedValue(makeTripRow({ deleted_at: null }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/restore`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tripId).toBe(TRIP_ID);
  });

  it('trả về 404 khi trip không có trong thùng rác', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(null); // findFirst yêu cầu deleted_at != null
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/restore`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('trả về 401 khi user không tồn tại', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/restore`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/trips/:tripId/permanent
// ---------------------------------------------------------------------------

describe('DELETE /api/trips/:tripId/permanent — xóa vĩnh viễn', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
    (prisma.trip.findFirst as any).mockResolvedValue(makeTripRow());
    (prisma.trip.delete as any).mockResolvedValue({});
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 204 và xóa hoàn toàn khỏi DB', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}/permanent`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(204);
    expect(prisma.trip.delete).toHaveBeenCalledWith({ where: { trip_id: TRIP_ID } });
  });

  it('trả về 404 khi trip không tồn tại', async () => {
    (prisma.trip.findFirst as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}/permanent`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(404);
  });

  it('trả về 401 khi user không tồn tại', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/trips/${TRIP_ID}/permanent`,
      headers: AUTH_ONLY,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/trips/:tripId/slots/:slotId — cập nhật trạng thái slot
// ---------------------------------------------------------------------------

describe('PATCH /api/trips/:tripId/slots/:slotId — cập nhật slot', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.app_user.findUnique as any).mockResolvedValue(APP_USER);
    (prisma.trip_slot.findFirst as any).mockResolvedValue(makeSlotRow());
    (prisma.trip_slot.update as any).mockResolvedValue(makeSlotRow({ status: 'planned' }));
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với slot đã cập nhật khi thay đổi status → planned', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'planned' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('status → completed: gọi getCurrentArmId và sendReward với interactionType=slot_completed', async () => {
    (prisma.trip_slot.update as any).mockResolvedValue(makeSlotRow({ status: 'completed' }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(200);
    expect(getCurrentArmId).toHaveBeenCalledWith(APP_USER.user_id);
    expect(sendReward).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'slot_completed' }),
    );
  });

  it('status → skipped: gọi sendReward với interactionType=poi_rejected', async () => {
    (prisma.trip_slot.update as any).mockResolvedValue(makeSlotRow({ status: 'skipped' }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'skipped' },
    });
    expect(res.statusCode).toBe(200);
    expect(sendReward).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: 'poi_rejected' }),
    );
  });

  it('status → planned: KHÔNG gọi sendReward', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'planned' },
    });
    expect(sendReward).not.toHaveBeenCalled();
  });

  it('isLocked = true: cập nhật is_locked', async () => {
    (prisma.trip_slot.update as any).mockResolvedValue(makeSlotRow({ is_locked: true }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { isLocked: true },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.trip_slot.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ is_locked: true }) }),
    );
  });

  it('trả về 404 khi slot không tồn tại', async () => {
    (prisma.trip_slot.findFirst as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'planned' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('trả về 401 khi user không tồn tại trong DB', async () => {
    (prisma.app_user.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'planned' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('trả về 500 khi DB ném lỗi', async () => {
    (prisma.trip_slot.update as any).mockRejectedValue(new Error('DB error'));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/trips/${TRIP_ID}/slots/${SLOT_ID}`,
      headers: JSON_AUTH,
      payload: { status: 'planned' },
    });
    expect(res.statusCode).toBe(500);
  });
});
