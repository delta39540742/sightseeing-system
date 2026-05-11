/**
 * replan.test.ts — Integration-style tests for the four replan endpoints.
 *
 * Strategy: build a real Fastify instance, register routes with fully-mocked
 * ReplanDeps, and drive it with `fastify.inject()`.  No real DB or BeamSearch
 * is involved — every dep field is a `vi.fn()`.
 *
 * Coverage goal: every handler branch (status codes, guard conditions, side
 * effects, fallback/timeout flags, published events) has at least one test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ReplanDeps } from '../src/api/replan/handlers';
import { replanPlugin } from '../src/api/replan/routes';
import type { TripSlot } from '@app/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID      = '00000000-0000-0000-0000-000000000001';
const PROPOSAL_ID  = '00000000-0000-0000-0000-000000000002';
const EVENT_ID     = '00000000-0000-0000-0000-000000000003';
const OTHER_TRIP   = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER_ID      = 'user-abc';

function makeTripRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{
      trip_id: TRIP_ID,
      user_id: USER_ID,
      status: 'active',
      budget_total: 2000,
      title: 'Test Trip',
      destination_city: 'Da Nang',
      start_date: '2026-04-19',
      end_date: '2026-04-22',
      hotel_place_id: null,
      objective_score: null,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
      ...overrides,
    }],
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{
      event_id: EVENT_ID,
      trip_id: TRIP_ID,
      status: 'open',
      ...overrides,
    }],
  };
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    proposalId: PROPOSAL_ID,
    tripId: TRIP_ID,
    triggeredByEventId: null,
    createdAt: '2026-04-19T08:00:00.000Z',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    oldPlanSnapshot: [],
    newPlanSnapshot: [],
    causalTrace: [],
    scoreBefore: 5,
    scoreAfter: 7,
    status: 'pending',
    ...overrides,
  };
}

function makeBeamNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    plan: [],
    stateTrajectory: [],
    score: 7,
    mutationHistory: [],
    parent: null,
    ...overrides,
  };
}

function makeInitialState() {
  return {
    tripId: TRIP_ID,
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,
    budgetRemaining: 2000,
    fatigue: 0,
    currentLat: null,
    currentLng: null,
    moodProxy: 0.7,
    capturedAt: '2026-04-19T08:00:00.000Z',
    source: 'planned' as const,
  };
}

function makeCtx() {
  return {
    remainingSlots: [] as TripSlot[],
    weights: { wInterest: 1, wPace: 1, wDistance: 1, wBudget: 1, wWeather: 1, wRisk: 1 },
    candidatePool: [],
    user: { userId: USER_ID, preferenceVector: new Array(10).fill(0), pace: 0.5, budget: 2000 },
    initialState: makeInitialState(),
    weatherForecast: [],
  };
}

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(): ReplanDeps {
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn(),
  } as unknown as ReplanDeps['pool'];

  const planLoader = {
    load: vi.fn().mockResolvedValue(makeCtx()),
  };

  const evolver = {
    computeTrajectory: vi.fn().mockReturnValue([makeInitialState()]),
    isFeasible: vi.fn().mockReturnValue(true),
    estimateTravelTime: vi.fn().mockReturnValue(0),
  } as unknown as ReplanDeps['evolver'];

  const scorer = {
    score: vi.fn().mockReturnValue(5),
  } as unknown as ReplanDeps['scorer'];

  const beamSearch = {
    search: vi.fn().mockReturnValue(makeBeamNode()),
    operators: {
      prepareContext: vi.fn((ctx: unknown) => ctx),
      tspReorder: vi.fn().mockReturnValue([]),
      rescheduleSlotTimes: vi.fn().mockReturnValue(null),
    },
    config: { latencyBudgetMs: 4500 },
  } as unknown as ReplanDeps['beamSearch'];

  const traceBuilder = {
    create: vi.fn(() => ({
      begin: vi.fn(),
      record: vi.fn(),
      finalize: vi.fn().mockReturnValue({ steps: [] }),
      reset: vi.fn(),
    })),
  } as unknown as ReplanDeps['traceBuilder'];

  const proposalStore = {
    save: vi.fn().mockResolvedValue(PROPOSAL_ID),
    findMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(makeProposal()),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    expireOld: vi.fn().mockResolvedValue(0),
  } as unknown as ReplanDeps['proposalStore'];

  const publish = vi.fn();

  return { pool, planLoader, evolver, scorer, beamSearch, traceBuilder, proposalStore, publish };
}

// ---------------------------------------------------------------------------
// Fastify builder
// ---------------------------------------------------------------------------

async function buildApp(deps: ReplanDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(replanPlugin, { prefix: '/api', deps });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/trips/:tripId/replan/pending
// ---------------------------------------------------------------------------

describe('GET /api/trips/:tripId/replan/pending', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  it('returns 200 with the pending proposal when one exists', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeProposal()]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ proposalId: PROPOSAL_ID, tripId: TRIP_ID });
  });

  it('returns 200 with null when no pending proposal exists', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('returns 500 when proposalStore.findMany throws', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    expect(res.statusCode).toBe(500);
  });

  it('passes tripId filter to proposalStore.findMany', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}/replan/pending` });

    expect(deps.proposalStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP_ID, status: 'pending' }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 400 when x-user-id header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('returns 400 when replanScope is missing from body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when replanScope has an invalid enum value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'entire_universe' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when triggeredByEventId is not a valid UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Trip validation ─────────────────────────────────────────────────────────

  it('returns 404 when trip does not exist', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 422 when trip status is completed', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow({ status: 'completed' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'INVALID_STATUS' });
  });

  it('returns 422 when trip status is draft', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow({ status: 'draft' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'INVALID_STATUS' });
  });

  it('returns 422 response includes allowed statuses list', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow({ status: 'cancelled' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().details?.allowedStatuses).toContain('active');
    expect(res.json().details?.allowedStatuses).toContain('confirmed');
  });

  it('returns 201 when trip status is confirmed (valid for replanning)', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow({ status: 'confirmed' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('returns 500 when pool.query throws while fetching trip', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection lost'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });

  // ── Pending proposal guard ──────────────────────────────────────────────────

  it('returns 409 when a pending proposal already exists', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([makeProposal()]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_PENDING' });
    expect(res.json().details?.existingProposalId).toBe(PROPOSAL_ID);
  });

  // ── Event validation ────────────────────────────────────────────────────────

  it('returns 404 when triggeredByEventId references a non-existent event', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeTripRow())
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: EVENT_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'EVENT_NOT_FOUND' });
  });

  it('returns 404 when triggeredByEventId belongs to a different trip', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeTripRow())
      .mockResolvedValueOnce(makeEventRow({ trip_id: OTHER_TRIP }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: EVENT_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'EVENT_NOT_FOUND' });
  });

  it('returns 404 when triggeredByEventId references an already-resolved event', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeTripRow())
      .mockResolvedValueOnce(makeEventRow({ status: 'resolved_by_replan' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: EVENT_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'EVENT_NOT_FOUND' });
  });

  it('includes triggeredByEventId in proposal when valid event provided', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeTripRow())
      .mockResolvedValueOnce(makeEventRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: EVENT_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().triggeredByEventId).toBe(EVENT_ID);
  });

  // ── PlanLoader ──────────────────────────────────────────────────────────────

  it('returns 500 when planLoader.load fails', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.planLoader.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'TRIP_LOAD_FAILED' });
  });

  // ── Scope behaviour ─────────────────────────────────────────────────────────

  it('filters slots to today when replanScope is remaining_day', async () => {
    const ctx = makeCtx();
    ctx.remainingSlots = [
      { slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
      { slotId: 's2', placeId: 2, dayIndex: 1, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
    ];
    (deps.planLoader.load as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_day' },
    });

    const callCtx = (deps.beamSearch.search as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callCtx.remainingSlots).toHaveLength(1);
    expect(callCtx.remainingSlots[0].dayIndex).toBe(0);
  });

  it('calls prepareContext when scope is remaining_trip', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.beamSearch.operators.prepareContext).toHaveBeenCalledOnce();
  });

  it('does not call prepareContext when scope is remaining_day', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_day' },
    });

    expect(deps.beamSearch.operators.prepareContext).not.toHaveBeenCalled();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 201 with proposal on happy path (remaining_trip)', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ tripId: TRIP_ID, status: 'pending', isTimeout: false, isFallback: false });
    expect(typeof body.proposalId).toBe('string');
  });

  it('response proposalId is a valid UUID', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(res.json().proposalId).toMatch(uuidRe);
  });

  it('response scoreBefore and scoreAfter reflect scorer and beamSearch outputs', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.scorer.score as ReturnType<typeof vi.fn>).mockReturnValue(3);
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({ score: 8 }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    const body = res.json();
    expect(body.scoreBefore).toBe(3);
    expect(body.scoreAfter).toBe(8);
  });

  it('expiresAt is approximately 30 minutes from now', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    const before = Date.now();

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    const after = Date.now();
    const expiresAt = new Date(res.json().expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 29 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after  + 31 * 60 * 1000);
  });

  // ── Timeout / Fallback flags ────────────────────────────────────────────────

  it('sets isFallback:false and isTimeout:false on successful search within budget', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.json()).toMatchObject({ isFallback: false, isTimeout: false });
  });

  it('sets isTimeout:true when search duration meets or exceeds latencyBudgetMs', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    // Set budget to 0 so any real duration (even sub-millisecond) always triggers isTimeout.
    // This avoids fragility from Date.now() spy count depending on console.log overhead.
    const originalConfig = deps.beamSearch.config;
    deps.beamSearch.config = { latencyBudgetMs: 0 };

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    deps.beamSearch.config = originalConfig;
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ isTimeout: true, isFallback: false });
  });

  it('returns 201 with isTimeout:true and isFallback:true when beamSearch throws', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Simulated crash');
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ isFallback: true, isTimeout: true });
  });

  it('fallback plan uses oldPlan as newPlan when beamSearch crashes', async () => {
    const slots: TripSlot[] = [
      { slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing', version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' },
    ];
    const ctx = makeCtx();
    ctx.remainingSlots = slots;
    (deps.planLoader.load as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('crash');
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
    // When fallback, newPlanSnapshot == oldPlanSnapshot
    const body = res.json();
    expect(body.newPlanSnapshot).toEqual(body.oldPlanSnapshot);
  });

  // ── Persistence & events ────────────────────────────────────────────────────

  it('returns 500 when proposalStore.save throws', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.proposalStore.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB write failed'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'INTERNAL_ERROR' });
  });

  it('publishes trip.replan.proposed with correct tripId and scoreDelta', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.scorer.score as ReturnType<typeof vi.fn>).mockReturnValue(4);
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({ score: 9 }));

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.proposed',
      expect.objectContaining({ tripId: TRIP_ID, scoreDelta: 5 }),
    );
  });

  it('does not publish event when publish dep is absent', async () => {
    // Build an app whose deps.publish is undefined
    const depsNoPub = makeDeps();
    (depsNoPub as any).publish = undefined;
    (depsNoPub.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    const appNoPub = await buildApp(depsNoPub);

    const res = await appNoPub.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    await appNoPub.close();
    expect(res.statusCode).toBe(201); // should not throw even without publish
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan/:proposalId/accept
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan/:proposalId/accept', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  /** Sets up pool mocks for the accept transaction + fetchUpdatedTrip path. */
  function setupAcceptHappyPath() {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    // pool.query calls after the transaction:
    //  1) fetchCurrentArmId   → SELECT current_arm_id …
    //  2) fetchUpdatedTrip[0] → SELECT * FROM trip     (Promise.all)
    //  3) fetchUpdatedTrip[1] → SELECT … FROM trip_slot (Promise.all)
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ current_arm_id: 1 }] })
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 400 when x-user-id header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  // ── Proposal validation ─────────────────────────────────────────────────────

  it('returns 404 when proposal not found', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 404 when proposal belongs to a different trip', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ tripId: OTHER_TRIP }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 409 when proposal is already accepted', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'accepted' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_NOT_PENDING' });
  });

  it('returns 409 when proposal is already rejected', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'rejected' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_NOT_PENDING' });
  });

  it('returns 409 when proposal has expired', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'pending', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_EXPIRED' });
  });

  it('409 PROPOSAL_EXPIRED details include expiresAt', async () => {
    const expiresAt = new Date(Date.now() - 5000).toISOString();
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'pending', expiresAt }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.json().details?.expiresAt).toBe(expiresAt);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 200 with updated trip on success', async () => {
    setupAcceptHappyPath();

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tripId: TRIP_ID });
  });

  it('publishes trip.replan.accepted with proposalId and scoreDelta', async () => {
    setupAcceptHappyPath();
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ scoreBefore: 2, scoreAfter: 10 }),
    );

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.accepted',
      expect.objectContaining({ proposalId: PROPOSAL_ID, scoreDelta: 8 }),
    );
  });

  it('publish includes armId from DB when available', async () => {
    setupAcceptHappyPath(); // mocks current_arm_id = 1

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.accepted',
      expect.objectContaining({ armId: 1 }),
    );
  });

  it('publish includes armId:null when user has no objective weights row', async () => {
    // Override the happy path: armId query returns empty rows
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })                          // fetchCurrentArmId → null
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.accepted',
      expect.objectContaining({ armId: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan/:proposalId/reject
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan/:proposalId/reject', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 400 when x-user-id header is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('returns 400 when reason exceeds 500 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { reason: 'x'.repeat(501) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts reason at exactly 500 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { reason: 'x'.repeat(500) },
    });

    expect(res.statusCode).toBe(204);
  });

  // ── Proposal validation ─────────────────────────────────────────────────────

  it('returns 404 when proposal not found', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 404 when proposal tripId does not match route tripId', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ tripId: OTHER_TRIP }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns 409 when proposal is already rejected', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'rejected' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_NOT_PENDING' });
  });

  it('returns 409 when proposal has already been accepted', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'accepted' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_NOT_PENDING' });
  });

  it('returns 409 when proposal has expired', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'pending', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_EXPIRED' });
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 204 and calls updateStatus with rejected on success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    expect(deps.proposalStore.updateStatus).toHaveBeenCalledWith(PROPOSAL_ID, 'rejected', USER_ID);
  });

  it('accepts optional reason in body and includes it in published event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { reason: 'Changed my mind' },
    });

    expect(res.statusCode).toBe(204);
    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ reason: 'Changed my mind' }),
    );
  });

  it('publishes reason as null when no reason provided', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ reason: null }),
    );
  });

  it('publishes trip.replan.rejected with tripId and proposalId', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ tripId: TRIP_ID, proposalId: PROPOSAL_ID }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/trips/:tripId/replan/pending — edge cases
// ---------------------------------------------------------------------------

describe('GET /api/trips/:tripId/replan/pending — edge cases', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: 500 response body phải có đúng cấu trúc { success: false, errorCode: 'FETCH_PENDING_PROPOSAL_ERROR' }
  // để frontend phân biệt được lỗi hệ thống với trường hợp "không có proposal nào pending".
  // Kết quả thực tế: body có success:false và errorCode đúng → PASS
  it('500 response body has success:false and FETCH_PENDING_PROPOSAL_ERROR errorCode', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB timeout'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      success: false,
      errorCode: 'FETCH_PENDING_PROPOSAL_ERROR',
    });
  });

  // Mong đợi: findMany luôn được gọi với limit:1 để tránh kéo toàn bộ proposal từ DB
  // khi chỉ cần proposal đầu tiên — tránh over-fetching.
  // Kết quả thực tế: findMany được gọi với { tripId, status, limit: 1 } → PASS
  it('calls findMany with limit:1 to avoid over-fetching', async () => {
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await app.inject({ method: 'GET', url: `/api/trips/${TRIP_ID}/replan/pending` });

    expect(deps.proposalStore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  // Mong đợi: khi findMany trả về nhiều proposal (do race condition tạo ra 2 pending),
  // endpoint chỉ trả về proposal đầu tiên — response không bao giờ là mảng.
  // Kết quả thực tế: response.proposalId là PROPOSAL_ID (phần tử đầu), không phải mảng → PASS
  it('returns only the first proposal when findMany yields multiple entries', async () => {
    const first = makeProposal({ proposalId: PROPOSAL_ID });
    const second = makeProposal({ proposalId: '00000000-0000-0000-0000-000000000099' });
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([first, second]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toBeInstanceOf(Array);
    expect(res.json().proposalId).toBe(PROPOSAL_ID);
  });

  // Mong đợi: proposal được pass-through nguyên vẹn — tất cả trường scoreBefore, scoreAfter,
  // oldPlanSnapshot, newPlanSnapshot, causalTrace phải có mặt để frontend render đầy đủ.
  // Kết quả thực tế: body chứa đủ tất cả các trường được kiểm tra → PASS
  it('passes through all proposal fields including scores, snapshots, and causalTrace', async () => {
    const proposal = makeProposal({ scoreBefore: 4, scoreAfter: 9, causalTrace: [{ stepIndex: 0 }] });
    (deps.proposalStore.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([proposal]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/trips/${TRIP_ID}/replan/pending`,
    });

    const body = res.json();
    expect(body).toMatchObject({ scoreBefore: 4, scoreAfter: 9 });
    expect(Array.isArray(body.oldPlanSnapshot)).toBe(true);
    expect(Array.isArray(body.newPlanSnapshot)).toBe(true);
    expect(Array.isArray(body.causalTrace)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan — edge cases', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: khi beamSearch trả về plan có score thấp hơn baseline (delta âm),
  // handler vẫn trả về 201 và lưu proposal — không từ chối "plan tệ hơn" vì user tự quyết.
  // Kết quả thực tế: status 201, scoreBefore:10, scoreAfter:3 → PASS
  // Hành vi mới (Gap B): khi plan không đổi cấu trúc và score không cải thiện đủ (Δ<0.5),
  // handler trả 200 no_change thay vì tạo proposal — không làm phiền user với đề xuất vô nghĩa.
  it('returns 200 no_change when BeamSearch plan is worse than baseline (plan unchanged)', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.scorer.score as ReturnType<typeof vi.fn>).mockReturnValue(10);
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({ score: 3 }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ action: 'no_change' });
  });

  // Khi no_change: proposal không được lưu và publish không được gọi.
  it('does NOT publish when no_change response is returned (score worse than baseline)', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.scorer.score as ReturnType<typeof vi.fn>).mockReturnValue(10);
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({ score: 3 }));

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.publish).not.toHaveBeenCalledWith(
      'trip.replan.proposed',
      expect.anything(),
    );
  });

  // Khi plan không đổi và score bằng nhau, cũng trả 200 no_change.
  it('returns 200 no_change when scores are equal and plan unchanged', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.scorer.score as ReturnType<typeof vi.fn>).mockReturnValue(5);
    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({ score: 5 }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ action: 'no_change', scoreBefore: 5, scoreAfter: 5 });
  });

  // Mong đợi: khi body không cung cấp triggeredByEventId, proposal.triggeredByEventId phải là null
  // (không phải undefined) — null rõ ràng giúp DB và JSON serialization không bị lỗi.
  // Kết quả thực tế: res.json().triggeredByEventId === null → PASS
  it('proposal.triggeredByEventId is null (not undefined) when omitted from request body', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().triggeredByEventId).toBeNull();
  });

  // Mong đợi: evolver.computeTrajectory phải được gọi đúng 1 lần với kế hoạch cũ
  // để tính trajectory làm input cho scorer.score baseline. Nếu không gọi → scoreBefore sai.
  // Kết quả thực tế: computeTrajectory được gọi 1 lần → PASS
  it('evolver.computeTrajectory is called exactly once to compute the baseline trajectory', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.evolver.computeTrajectory).toHaveBeenCalledOnce();
  });

  // Mong đợi: scorer.score phải được gọi đúng 1 lần để tính scoreBefore từ kế hoạch cũ.
  // Thiếu bước này sẽ khiến field scoreBefore trong proposal bị sai/undefined.
  // Kết quả thực tế: scorer.score được gọi 1 lần → PASS
  it('scorer.score is called exactly once to compute scoreBefore', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.scorer.score).toHaveBeenCalledOnce();
  });

  // Mong đợi: khi replanScope='remaining_day' nhưng tất cả slot thuộc ngày 1+ (không phải hôm nay),
  // beamSearch.search vẫn được gọi với mảng rỗng — handler không crash khi không có slot nào cần replan.
  // Kết quả thực tế: status 201, callCtx.remainingSlots rỗng → PASS
  it('remaining_day with no slots for today passes empty array to beamSearch (status 201)', async () => {
    const ctx = makeCtx();
    ctx.initialState = { ...makeInitialState(), dayIndex: 0 };
    ctx.remainingSlots = [
      { slotId: 's1', placeId: 1, dayIndex: 1, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
    ];
    (deps.planLoader.load as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_day' },
    });

    expect(res.statusCode).toBe(201);
    const callCtx = (deps.beamSearch.search as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callCtx.remainingSlots).toHaveLength(0);
  });

  // Mong đợi: publish event phải chứa userId để audit log và preference-service biết
  // chính xác ai kích hoạt replan — thiếu userId không truy vết được hành vi user.
  // Kết quả thực tế: publish được gọi với userId: USER_ID → PASS
  it('published trip.replan.proposed event includes userId from x-user-id header', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.proposed',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  // Mong đợi: proposalStore.save phải được gọi đúng 1 lần với proposal chứa tripId đúng
  // và status:'pending' — đây là side effect persistence cốt lõi của toàn bộ handler.
  // Kết quả thực tế: save được gọi 1 lần, argument đầu tiên có tripId và status đúng → PASS
  it('proposalStore.save called once with correct tripId, pending status, and a UUID proposalId', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.proposalStore.save).toHaveBeenCalledOnce();
    const [savedProposal] = (deps.proposalStore.save as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(savedProposal).toMatchObject({ tripId: TRIP_ID, status: 'pending' });
    expect(typeof savedProposal.proposalId).toBe('string');
  });

  // Mong đợi: beamSearch.search phải được gọi đúng 1 lần — không retry, không gọi thêm
  // khi đã có kết quả. Gọi nhiều lần sẽ tiêu tốn tài nguyên không cần thiết.
  // Kết quả thực tế: beamSearch.search được gọi 1 lần → PASS
  it('beamSearch.search is called exactly once during normal flow', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.beamSearch.search).toHaveBeenCalledOnce();
  });

  // Mong đợi: khi beamSearch trả về mutationHistory có 2 entries, traceBuilder.record()
  // phải được gọi đúng 2 lần, với stepIndex và reason khớp từng mutation để xây dựng
  // causal trace giải thích quyết định cho user.
  // Kết quả thực tế: record gọi 2 lần với đúng args → PASS
  it('traceBuilder.record called once per mutation entry in beamSearch mutationHistory', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const mockRecord = vi.fn();
    (deps.traceBuilder.create as ReturnType<typeof vi.fn>).mockReturnValue({
      begin: vi.fn(),
      record: mockRecord,
      finalize: vi.fn().mockReturnValue({ steps: [] }),
      reset: vi.fn(),
    });

    (deps.beamSearch.search as ReturnType<typeof vi.fn>).mockReturnValue(makeBeamNode({
      mutationHistory: [
        { description: 'Swap A→B', affectedSlotIds: ['s1'], newPlan: [] },
        { description: 'Remove C',  affectedSlotIds: ['s2'], newPlan: [] },
      ],
    }));

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0, reason: 'Swap A→B' }));
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 1, reason: 'Remove C' }));
  });

  // Mong đợi: response body phải luôn có causalTrace là mảng (kể cả khi finalize trả về entries),
  // không bao giờ là null hoặc undefined — frontend phải có thể iterate qua nó an toàn.
  // Kết quả thực tế: res.json().causalTrace là Array → PASS
  it('response causalTrace is always an array (never null or undefined)', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());
    (deps.traceBuilder.create as ReturnType<typeof vi.fn>).mockReturnValue({
      begin: vi.fn(),
      record: vi.fn(),
      finalize: vi.fn().mockReturnValue({ steps: [{ stepIndex: 0 }] }),
      reset: vi.fn(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(201);
    expect(Array.isArray(res.json().causalTrace)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan/:proposalId/accept — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan/:proposalId/accept — edge cases', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  function setupAcceptHappyPath() {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ current_arm_id: 1 }] })
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });
  }

  // Mong đợi: khi runAcceptTransaction ném lỗi (ví dụ deadlock ở DB trong khi xoá slot cũ),
  // Fastify bắt exception từ async handler và tự động trả về 500 — handler không có try-catch nội bộ.
  // Kết quả thực tế: status 500 → PASS
  it('returns 500 when the accept DB transaction throws (e.g. deadlock)', async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('deadlock detected')),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(500);
  });

  // Mong đợi: response 200 chứa đầy đủ cấu trúc Trip object với tripId, status, budgetTotal,
  // và slots là mảng — frontend cần đủ các trường này để render lịch mới ngay sau khi accept.
  // Kết quả thực tế: body có tripId, status, budgetTotal, slots là Array → PASS
  it('response body is a complete Trip object with tripId, status, slots array, and budgetTotal', async () => {
    setupAcceptHappyPath();

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('tripId', TRIP_ID);
    expect(body).toHaveProperty('status');
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body).toHaveProperty('budgetTotal');
  });

  // Mong đợi: khi proposalStore.findById ném lỗi DB (không phải "not found"),
  // response phải là 500 — không được nhầm exception với "proposal không tồn tại" → 404.
  // Kết quả thực tế: status 500 → PASS
  it('returns 500 when proposalStore.findById throws a DB error during validation', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection reset by peer'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(500);
  });

  // Mong đợi: khi armId là null (user mới chưa có objective weights row),
  // accept handler vẫn phải trả về 200 — thiếu bandit state không được làm replan thất bại.
  // Kết quả thực tế: status 200 → PASS
  it('returns 200 and completes successfully when armId is null for a new user', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })                          // fetchCurrentArmId → null
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(200);
  });

  // Mong đợi: accept không được gọi proposalStore.updateStatus — việc cập nhật status thành
  // 'accepted' nằm trong runAcceptTransaction (SQL trực tiếp) để đảm bảo atomicity.
  // Gọi thêm updateStatus sẽ gây double-write và phá vỡ tính nhất quán.
  // Kết quả thực tế: proposalStore.updateStatus không được gọi → PASS
  it('does NOT call proposalStore.updateStatus (status is updated inside SQL transaction)', async () => {
    setupAcceptHappyPath();

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(deps.proposalStore.updateStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan/:proposalId/reject — edge cases
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan/:proposalId/reject — edge cases', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: khi proposalStore.updateStatus ném lỗi (ví dụ DB write timeout),
  // Fastify bắt exception từ async handler và trả về 500 — handler không có try-catch nội bộ.
  // Kết quả thực tế: status 500 → PASS
  it('returns 500 when proposalStore.updateStatus throws a write error', async () => {
    (deps.proposalStore.updateStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('write timeout'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(500);
  });

  // Mong đợi: khi user chưa có objective weights row (user mới), publish event vẫn được gọi
  // với armId:null — không bỏ qua event chỉ vì thiếu bandit state.
  // Default pool.query mock trả về { rows: [] } khiến fetchCurrentArmId → null.
  // Kết quả thực tế: publish được gọi với armId: null → PASS
  it('publishes trip.replan.rejected with armId:null when user has no objective weights', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ armId: null }),
    );
  });

  // Mong đợi: chuỗi rỗng "" là giá trị reason hợp lệ (schema chỉ giới hạn maxLength, không minLength)
  // và phải được truyền nguyên vẹn qua toán tử ??: `"" ?? null` vẫn trả về "" (không phải null).
  // Kết quả thực tế: publish được gọi với reason: "" → PASS
  it('empty string reason is preserved in publish event (not coerced to null by ?? operator)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { reason: '' },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ reason: '' }),
    );
  });

  // Mong đợi: reject không bao giờ mở DB transaction — chỉ cần pool.query (fetchCurrentArmId),
  // không bao giờ gọi pool.connect. Mở transaction sẽ lock DB không cần thiết.
  // Kết quả thực tế: pool.connect không được gọi → PASS
  it('reject does not open a DB transaction — pool.connect is never called', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(deps.pool.connect).not.toHaveBeenCalled();
  });

  // Mong đợi: publish event phải chứa userId từ header — cần thiết để preference-service
  // cập nhật đúng bandit arm và để audit log truy vết được user đã reject proposal này.
  // Kết quả thực tế: publish được gọi với userId: USER_ID → PASS
  it('published trip.replan.rejected event includes userId from x-user-id header', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  // Mong đợi: khi proposalStore.findById ném lỗi DB trong bước validateProposal,
  // response phải là 500 — không được nhầm exception với "proposal không tồn tại" → 404.
  // Kết quả thực tế: status 500 → PASS
  it('returns 500 when proposalStore.findById throws a DB error during validation', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DB unavailable'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// validateProposal — details.currentStatus field shape
// ---------------------------------------------------------------------------

describe('validateProposal — details.currentStatus in 409 response', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: khi accept proposal đang ở status:'accepted', response 409 phải có
  // details.currentStatus = 'accepted' để frontend hiển thị thông báo chính xác
  // (không cần gọi API lần nữa để biết trạng thái hiện tại).
  // Kết quả thực tế: details.currentStatus === 'accepted' → PASS
  it('accept 409 includes details.currentStatus = accepted when proposal is already accepted', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'accepted' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().details?.currentStatus).toBe('accepted');
  });

  // Mong đợi: khi reject proposal đang ở status:'rejected', response 409 có
  // details.currentStatus = 'rejected' — không cần gọi lại DB để lấy trạng thái.
  // Kết quả thực tế: details.currentStatus === 'rejected' → PASS
  it('reject 409 includes details.currentStatus = rejected when proposal is already rejected', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'rejected' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().details?.currentStatus).toBe('rejected');
  });

  // Mong đợi: khi accept proposal đang ở status:'expired', details.currentStatus
  // cũng phải reflect trạng thái đó chứ không phải hard-code một giá trị nào.
  // Kết quả thực tế: details.currentStatus === 'expired' → PASS
  it('accept 409 includes details.currentStatus = expired when proposal has that status', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ status: 'expired' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().details?.currentStatus).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// notifyPreferenceReward — fire-and-forget behaviour (fetch spy)
// ---------------------------------------------------------------------------

describe('notifyPreferenceReward — fire-and-forget calls to preference-service', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  function setupAcceptMocks(armId: number | null) {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: armId !== null ? [{ current_arm_id: armId }] : [] })
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });
  }

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  // Mong đợi: khi accept thành công và armId = 1, fetch phải được gọi đúng 1 lần
  // đến reward URL với body có interactionType:'replan_accepted' và armId đúng.
  // Điều này đảm bảo preference-service nhận được reward signal để cập nhật UCB1.
  // Kết quả thực tế: fetch được gọi với đúng URL và body → PASS
  it('accept — calls fetch to reward URL with interactionType replan_accepted when armId is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    setupAcceptMocks(1);

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    const rewardCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      typeof url === 'string' && url.includes('/api/preferences/internal/reward'),
    );
    expect(rewardCalls).toHaveLength(1);
    const body = JSON.parse(rewardCalls[0]![1].body as string);
    expect(body).toMatchObject({ interactionType: 'replan_accepted', armId: 1, userId: USER_ID });
  });

  // Mong đợi: khi accept nhưng armId = null (user mới), fetch KHÔNG được gọi đến
  // reward URL — preference-service không có arm để cập nhật, gọi sẽ gây lỗi.
  // Kết quả thực tế: không có fetch call đến reward URL → PASS
  it('accept — does NOT call fetch reward endpoint when armId is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    setupAcceptMocks(null);

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    const rewardCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      typeof url === 'string' && url.includes('/api/preferences/internal/reward'),
    );
    expect(rewardCalls).toHaveLength(0);
  });

  // Mong đợi: khi reject và armId = 2, fetch phải được gọi với interactionType:'replan_rejected'.
  // preference-service ghi nhận "negative signal" cho arm này để điều chỉnh trọng số UCB1.
  // Kết quả thực tế: fetch được gọi với interactionType: 'replan_rejected' và armId: 2 → PASS
  it('reject — calls fetch to reward URL with interactionType replan_rejected when armId is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      { rows: [{ current_arm_id: 2 }] },
    );

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    const rewardCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      typeof url === 'string' && url.includes('/api/preferences/internal/reward'),
    );
    expect(rewardCalls).toHaveLength(1);
    const body = JSON.parse(rewardCalls[0]![1].body as string);
    expect(body).toMatchObject({ interactionType: 'replan_rejected', armId: 2 });
  });

  // Mong đợi: khi reject nhưng armId = null (default mock trả về { rows: [] }),
  // fetch KHÔNG được gọi đến reward URL.
  // Kết quả thực tế: không có fetch call đến reward URL → PASS
  it('reject — does NOT call fetch reward endpoint when armId is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    const rewardCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      typeof url === 'string' && url.includes('/api/preferences/internal/reward'),
    );
    expect(rewardCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/trips/:tripId/replan — planLoader and traceBuilder internals
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan — planLoader and traceBuilder internals', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: planLoader.load phải được gọi đúng với tripId từ route params —
  // nếu dùng sai ID, context sẽ là của trip khác, dẫn đến replan sai hoàn toàn.
  // Kết quả thực tế: planLoader.load được gọi với TRIP_ID → PASS
  it('planLoader.load is called with the tripId from route params', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.planLoader.load).toHaveBeenCalledWith(TRIP_ID);
  });

  // Mong đợi: traceBuilder.create() phải được gọi đúng 1 lần mỗi request để tạo
  // builder riêng — không dùng chung builder giữa các request đồng thời (builder
  // có mutable state: steps, tripId, startTime).
  // Kết quả thực tế: traceBuilder.create được gọi 1 lần → PASS
  it('traceBuilder.create is called exactly once per request', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(deps.traceBuilder.create).toHaveBeenCalledOnce();
  });

  // Mong đợi: traceBuilder.finalize() phải được gọi đúng 1 lần sau khi beamSearch xong
  // để đóng gói toàn bộ steps thành causalTrace — nếu không gọi, causalTrace = undefined.
  // Kết quả thực tế: finalize gọi 1 lần, trả về { steps } → PASS
  it('traceBuilder.finalize is called exactly once to seal the causal trace', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const mockFinalize = vi.fn().mockReturnValue({ steps: [] });
    (deps.traceBuilder.create as ReturnType<typeof vi.fn>).mockReturnValue({
      begin: vi.fn(),
      record: vi.fn(),
      finalize: mockFinalize,
      reset: vi.fn(),
    });

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(mockFinalize).toHaveBeenCalledOnce();
  });

  // Mong đợi: traceBuilder.begin phải được gọi với tripId đúng làm argument đầu tiên
  // để builder biết mình đang trace cho trip nào khi ghi log và finalize.
  // Kết quả thực tế: begin gọi với TRIP_ID làm arg[0] → PASS
  it('traceBuilder.begin is called with the correct tripId as first argument', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    const mockBegin = vi.fn();
    (deps.traceBuilder.create as ReturnType<typeof vi.fn>).mockReturnValue({
      begin: mockBegin,
      record: vi.fn(),
      finalize: vi.fn().mockReturnValue({ steps: [] }),
      reset: vi.fn(),
    });

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(mockBegin).toHaveBeenCalledOnce();
    expect(mockBegin.mock.calls[0]![0]).toBe(TRIP_ID);
  });

  // Mong đợi: khi remaining_trip scope, tất cả slot từ planLoader (kể cả đa ngày) phải
  // được truyền vào beamSearch.search mà không bị lọc — chỉ remaining_day mới lọc.
  // Kết quả thực tế: beamSearch nhận đủ 3 slot từ ctx.remainingSlots → PASS
  it('remaining_trip passes all slots from planLoader to beamSearch without filtering', async () => {
    const ctx = makeCtx();
    ctx.remainingSlots = [
      { slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
      { slotId: 's2', placeId: 2, dayIndex: 1, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
      { slotId: 's3', placeId: 3, dayIndex: 2, slotOrder: 0, estimatedCost: 10, activityType: 'sightseeing' as const, version: 1, plannedStart: '09:00', plannedEnd: '11:00', tripId: TRIP_ID, actualStart: null, actualEnd: null, rationale: null, status: 'planned' as const },
    ];
    (deps.planLoader.load as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(makeTripRow());

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    const callCtx = (deps.beamSearch.search as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callCtx.remainingSlots).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// POST .../accept — additional response fields and failure edge cases
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan/:proposalId/accept — additional coverage', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  function setupAcceptHappyPath() {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ current_arm_id: 1 }] })
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({ rows: [] });
  }

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => { await app.close(); });

  // Mong đợi: publish event 'trip.replan.accepted' phải chứa userId từ x-user-id header
  // để audit log và preference-service truy vết đúng user — thiếu userId không biết ai accept.
  // Kết quả thực tế: publish gọi với userId: USER_ID → PASS
  it('published trip.replan.accepted event includes userId from x-user-id header', async () => {
    setupAcceptHappyPath();

    await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.accepted',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  // Mong đợi: khi fetchUpdatedTrip không tìm thấy trip row (trip bị xóa ngay sau transaction),
  // acceptHandler không có try-catch nên exception nổi lên Fastify → trả về 500.
  // Không được trả về 200 với data null/undefined — frontend sẽ crash khi đọc slots.
  // Kết quả thực tế: status 500 → PASS
  it('returns 500 when fetchUpdatedTrip finds no trip row after successful transaction', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ current_arm_id: 1 }] })  // fetchCurrentArmId
      .mockResolvedValueOnce({ rows: [] })                         // fetchUpdatedTrip: trip not found
      .mockResolvedValueOnce({ rows: [] });                        // fetchUpdatedTrip: slots

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(500);
  });

  // Mong đợi: slot objects trong Trip trả về phải dùng camelCase field names
  // (slotId, dayIndex, slotOrder, placeId...) — không phải snake_case từ DB row.
  // Frontend TypeScript sẽ compile error nếu fields bị sai casing.
  // Kết quả thực tế: body.slots có slotId, dayIndex, slotOrder, placeId → PASS
  it('returned trip slots have camelCase field names (slotId, dayIndex, slotOrder, placeId)', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ current_arm_id: 1 }] })
      .mockResolvedValueOnce({ rows: [makeTripRow().rows[0]] })
      .mockResolvedValueOnce({
        rows: [{
          slot_id: 'slot-1',
          trip_id: TRIP_ID,
          day_index: 0,
          slot_order: 1,
          version: 2,
          place_id: 42,
          planned_start: '09:00',
          planned_end: '11:00',
          actual_start: null,
          actual_end: null,
          estimated_cost: 50000,
          activity_type: 'sightseeing',
          rationale: null,
          status: 'planned',
        }],
      });

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(200);
    const slot = res.json().slots[0];
    expect(slot).toMatchObject({
      slotId: 'slot-1',
      dayIndex: 0,
      slotOrder: 1,
      placeId: 42,
    });
    expect(slot).not.toHaveProperty('slot_id');
    expect(slot).not.toHaveProperty('day_index');
  });
});
