/**
 * replan.test.ts — Integration-style tests for the three replan endpoints.
 *
 * Strategy: build a real Fastify instance, register routes with fully-mocked
 * ReplanDeps, and drive it with `fastify.inject()`.  No real DB or BeamSearch
 * is involved — every dep field is a `vi.fn()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { ReplanDeps } from '../src/api/replan/handlers';
import { replanPlugin } from '../src/api/replan/routes';
import type { TripSlot } from '@app/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = '00000000-0000-0000-0000-000000000001';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000002';
const EVENT_ID = '00000000-0000-0000-0000-000000000003';
const USER_ID = 'user-abc';

function makeTripRow() {
  return {
    rows: [
      {
        trip_id: TRIP_ID,
        user_id: USER_ID,
        status: 'active',
        budget_total: 2000,
        title: 'Test Trip',
        destination_city: 'Hanoi',
        start_date: '2026-04-19',
        end_date: '2026-04-22',
        hotel_place_id: null,
        objective_score: null,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      },
    ],
  };
}

function makeEventRow() {
  return {
    rows: [
      {
        event_id: EVENT_ID,
        trip_id: TRIP_ID,
        status: 'open',
      },
    ],
  };
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    proposalId: PROPOSAL_ID,
    tripId: TRIP_ID,
    triggeredByEventId: null,
    createdAt: '2026-04-19T08:00:00.000Z',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min ahead
    oldPlanSnapshot: [],
    newPlanSnapshot: [],
    causalTrace: [],
    scoreBefore: 5,
    scoreAfter: 7,
    status: 'pending',
    ...overrides,
  };
}

function makeBeamNode() {
  return {
    plan: [],
    stateTrajectory: [],
    score: 7,
    mutationHistory: [],
    parent: null,
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
    weights: {
      wInterest: 1,
      wPace: 1,
      wDistance: 1,
      wBudget: 1,
      wWeather: 1,
      wRisk: 1,
    },
    candidatePool: [],
    user: {
      userId: USER_ID,
      preferenceVector: new Array(10).fill(0),
      pace: 0.5,
      budget: 2000,
    },
    initialState: makeInitialState(),
    weatherBySlotId: {},
  };
}

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(): ReplanDeps {
  const pool = {
    query: vi.fn(),
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
  } as unknown as ReplanDeps['beamSearch'];

  const traceBuilder = {
    reset: vi.fn(),
    begin: vi.fn(),
    record: vi.fn(),
    finalize: vi.fn().mockReturnValue({ steps: [] }),
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
// POST /api/trips/:tripId/replan
// ---------------------------------------------------------------------------

describe('POST /api/trips/:tripId/replan', () => {
  let deps: ReplanDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = makeDeps();
    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
  });

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

  it('returns 422 when trip status is not active/confirmed', async () => {
    const tripRow = makeTripRow();
    tripRow.rows[0]!.status = 'completed';
    (deps.pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(tripRow);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'INVALID_STATUS' });
  });

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
  });

  it('returns 404 when triggeredByEventId references a non-open event', async () => {
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeTripRow())    // trip query
      .mockResolvedValueOnce({ rows: [] });     // event query → not found

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { replanScope: 'remaining_trip', triggeredByEventId: EVENT_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'EVENT_NOT_FOUND' });
  });

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
    expect(body).toMatchObject({
      tripId: TRIP_ID,
      status: 'pending',
      isTimeout: false,
    });
    expect(typeof body.proposalId).toBe('string');
    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.proposed',
      expect.objectContaining({ tripId: TRIP_ID }),
    );
  });

  it('returns 201 with isTimeout:true when beamSearch throws', async () => {
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
    expect(res.json()).toMatchObject({ isTimeout: true });
  });

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

    // beamSearch.search should have been called with ctx where remainingSlots only has dayIndex 0
    const callCtx = (deps.beamSearch.search as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callCtx.remainingSlots).toHaveLength(1);
    expect(callCtx.remainingSlots[0].dayIndex).toBe(0);
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

  it('returns 400 when replanScope is missing from body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
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

  afterEach(async () => {
    await app.close();
  });

  function setupAcceptHappyPath() {
    // pool.connect returns a mock client
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ max_version: 1 }] }),
      release: vi.fn(),
    };
    (deps.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    // fetchUpdatedTrip needs pool.query (parallel queries)
    (deps.pool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [makeTripRow().rows[0]],
      })
      .mockResolvedValueOnce({ rows: [] }); // slots query
  }

  it('returns 200 with updated trip on success', async () => {
    setupAcceptHappyPath();

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tripId: TRIP_ID });
    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.accepted',
      expect.objectContaining({ proposalId: PROPOSAL_ID }),
    );
  });

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

  it('returns 409 when proposal has expired', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'PROPOSAL_EXPIRED' });
  });

  it('returns 404 when proposal belongs to a different trip', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeProposal({ tripId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/accept`,
      headers: { 'x-user-id': USER_ID },
    });

    expect(res.statusCode).toBe(404);
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

  afterEach(async () => {
    await app.close();
  });

  it('returns 204 on success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    expect(deps.proposalStore.updateStatus).toHaveBeenCalledWith(
      PROPOSAL_ID,
      'rejected',
      USER_ID,
    );
    expect(deps.publish).toHaveBeenCalledWith(
      'trip.replan.rejected',
      expect.objectContaining({ proposalId: PROPOSAL_ID }),
    );
  });

  it('accepts optional reason in body', async () => {
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

  it('returns 404 when proposal not found', async () => {
    (deps.proposalStore.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
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

  it('returns 409 when proposal has already decided (accepted)', async () => {
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
  });

  it('returns 400 when reason exceeds 500 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/trips/${TRIP_ID}/replan/${PROPOSAL_ID}/reject`,
      headers: { 'x-user-id': USER_ID, 'content-type': 'application/json' },
      payload: { reason: 'x'.repeat(501) },
    });

    expect(res.statusCode).toBe(400);
  });
});
