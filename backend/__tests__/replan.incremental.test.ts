/**
 * replan.incremental.test.ts
 *
 * Test tăng dần cho replanning engine — viết từng batch, chạy đến khi gặp lỗi.
 *
 * Batch 1: ObjectiveScorer — hard penalties (hành vi mới sau refactor)
 * Batch 2: StateEvolver — fatigue không bị cap tại 1.0 (new behavior)
 * Batch 3: ObjectiveScorer score() vs scoreFullAndCache() nhất quán
 * Batch 4: ProposalStore SQL construction
 * Batch 5: CausalTraceBuilder — begin/record/finalize/reset lifecycle
 * Batch 6: FeasibilityFilter — isSetFeasible LB checks & cache
 * Batch 7: MutationOperators — generateAll cap & round-robin
 * Batch 8: BeamSearch.search() — end-to-end behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectiveScorer, BeamSearch, collectFeedback, type BeamSearchContext } from '../src/replanner/BeamSearch';
import StateEvolver, { dot, tagVectorOf, type ReplanContext } from '../src/replanner/StateEvolver';
import { MutationOperators, GENERATE_ALL_CAP, type OperatorName } from '../src/replanner/MutationOperators';
import { isSetFeasible, clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import { CausalTraceBuilder } from '../src/replanner/CausalTraceBuilder';
import { computePlanHash } from '../src/replanner/TrajectoryCache';
import type { TripSlot, TripState, Place, UserPreference, ObjectiveWeights, TripEvent, CausalTraceStep } from '@app/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ZERO_WEIGHTS: ObjectiveWeights = {
  wInterest: 0, wPace: 0, wDistance: 0,
  wBudget: 0, wWeather: 0, wRisk: 0,
  wStability: 0, wPotentialBias: 0, wProximity: 0,
  wSynergy: 0,
};

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1, name: 'Test', description: null,
    lat: 16.06, lng: 108.22,
    minPrice: 0, maxPrice: null, priceType: 'free',
    avgVisitDurationMin: 60,
    parkingAvailable: false, wheelchairAccess: false, publicTransport: false,
    terrainEasiness: 0.8, roadAccessScore: null, spaciousness1km: null,
    popularityScore: null, indoorOutdoor: 'indoor',
    isLandmark: false, landmarkClassId: null, address: null,
    images: [], tags: [], openingHours: [],
    ...overrides,
  };
}

function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-001', tripId: 'trip-001',
    dayIndex: 0, slotOrder: 0, version: 1,
    placeId: 1,
    plannedStart: '2026-05-23T01:00:00.000Z',
    plannedEnd:   '2026-05-23T03:00:00.000Z',
    actualStart: null, actualEnd: null,
    estimatedCost: 0, activityType: 'sightseeing',
    rationale: null, status: 'planned',
    ...overrides,
  };
}

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001', dayIndex: 0, slotOrder: 0,
    timeRemainingMin: 600, budgetRemaining: 1_000_000,
    fatigue: 0.1, currentLat: 16.06, currentLng: 108.22,
    moodProxy: 0.7, capturedAt: '2026-05-23T01:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

const DEFAULT_USER: UserPreference = {
  preferenceVector: new Array(10).fill(0.1),
  pace: 0.5,
  mobilityRestrictions: [],
};

function makeCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  const place = makePlace();
  return {
    remainingSlots: [makeSlot()],
    initialState: makeState(),
    candidatePool: [place],
    placeMap: new Map([[place.placeId, place]]),
    user: DEFAULT_USER,
    weights: ZERO_WEIGHTS,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Batch 1 — ObjectiveScorer hard penalties (hành vi mới)
// ---------------------------------------------------------------------------

describe('Batch 1 — ObjectiveScorer: hard penalty budget & risk (new behavior)', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  it('B1.1 — Không penalty budget khi budgetRemaining = 0', () => {
    const plan = [makeSlot()];
    const states: TripState[] = [
      makeState({ budgetRemaining: 100 }),   // trước slot
      makeState({ budgetRemaining: 0 }),     // sau slot (đúng 0, không âm)
    ];
    const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
    const ctx = makeCtx({ weights });
    const score = scorer.score(plan, states, weights, ctx);
    expect(score).toBe(0);
  });

  it('B1.2 — Hard penalty -(10000 + |r|×0.1) khi budgetRemaining = -1', () => {
    const plan = [makeSlot()];
    const states: TripState[] = [
      makeState({ budgetRemaining: 1 }),
      makeState({ budgetRemaining: -1 }),
    ];
    const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
    const ctx = makeCtx({ weights });
    const score = scorer.score(plan, states, weights, ctx);
    // Công thức mới: -(10000 + 1 * 0.1) = -10000.1
    expect(score).toBeCloseTo(-10000.1, 5);
  });

  it('B1.3 — Hard penalty tăng tuyến tính theo |budgetRemaining|', () => {
    function scoreWithDeficit(deficit: number) {
      const plan = [makeSlot()];
      const states: TripState[] = [makeState(), makeState({ budgetRemaining: -deficit })];
      const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
      const ctx = makeCtx({ weights });
      return scorer.score(plan, states, weights, ctx);
    }
    const s1 = scoreWithDeficit(10);
    const s2 = scoreWithDeficit(20);
    // Deficit 20 phải tạo penalty thấp hơn (âm hơn) deficit 10
    expect(s2).toBeLessThan(s1);
    // Chênh lệch phải là (20-10)*0.1 = 1 (tuyến tính bổ sung)
    expect(s1 - s2).toBeCloseTo(1, 5);
  });

  it('B1.4 — Không có risk hard penalty khi fatigue đúng 0.95', () => {
    const plan = [makeSlot()];
    const states: TripState[] = [makeState(), makeState({ fatigue: 0.95 })];
    const weights = { ...ZERO_WEIGHTS, wRisk: 1 };
    const ctx = makeCtx({ weights });
    const score = scorer.score(plan, states, weights, ctx);
    // Chỉ risk = -0.95 (không có hard penalty)
    expect(score).toBeCloseTo(-0.95, 5);
  });

  it('B1.5 — Hard risk penalty khi fatigue vượt 0.95', () => {
    const plan = [makeSlot()];
    // fatigue = 0.96 → base risk -0.96, hard penalty -(10000 + 0.01*100000) = -11000
    const states: TripState[] = [makeState(), makeState({ fatigue: 0.96 })];
    const weights = { ...ZERO_WEIGHTS, wRisk: 1 };
    const ctx = makeCtx({ weights });
    const score = scorer.score(plan, states, weights, ctx);
    // Total risk = -0.96 + (-10000 - 0.01*100000) = -0.96 - 11000 = -11000.96
    expect(score).toBeCloseTo(-11000.96, 3);
  });

  it('B1.6 — timePenalty không nhân với bất kỳ weight nào (độc lập với weights)', () => {
    // Kịch bản: time overflow, tất cả weight = 0 nhưng timePenalty vẫn xuất hiện
    const plan = [makeSlot()];
    const states: TripState[] = [makeState(), makeState({ timeRemainingMin: -60 })];
    const weights = ZERO_WEIGHTS; // tất cả = 0
    const ctx = makeCtx({ weights });
    const score = scorer.score(plan, states, weights, ctx);
    // timePenalty = 10000 + 60 * 1000 = 70000
    // score = 0 (tất cả weights=0) - 70000 = -70000
    expect(score).toBeCloseTo(-70000, 3);
  });

  it('B1.7 — timePenalty scale theo |timeRemainingMin|', () => {
    function scoreWithOverflow(overflow: number) {
      const plan = [makeSlot()];
      const states: TripState[] = [makeState(), makeState({ timeRemainingMin: -overflow })];
      return scorer.score(plan, states, ZERO_WEIGHTS, makeCtx());
    }
    const s10 = scoreWithOverflow(10);  // penalty = 10000 + 10000 = 20000
    const s20 = scoreWithOverflow(20);  // penalty = 10000 + 20000 = 30000
    expect(s10 - s20).toBeCloseTo(10000, 3); // chênh lệch = 10 * 1000 = 10000
  });
});

// ---------------------------------------------------------------------------
// Batch 2 — StateEvolver: fatigue không bị cap tại 1.0
// ---------------------------------------------------------------------------

describe('Batch 2 — StateEvolver: fatigue behavior', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  it('B2.1 — isFeasible() trả false khi fatigue = 0.96 (> FATIGUE_CAP)', () => {
    const s = makeState({ fatigue: 0.96 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('B2.2 — isFeasible() trả true khi fatigue = 0.95 (đúng cap)', () => {
    const s = makeState({ fatigue: 0.95 });
    expect(evolver.isFeasible(s)).toBe(true);
  });

  it('B2.3 — isFeasible() trả false khi timeRemainingMin < 0', () => {
    const s = makeState({ timeRemainingMin: -1 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('B2.4 — isFeasible() trả false khi budgetRemaining < 0', () => {
    const s = makeState({ budgetRemaining: -1 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('B2.5 — evolve() fatigue bị cap tại 1.0 kể cả khi delta rất lớn', () => {
    // Kịch bản: fatigue = 0.9, travelTimeMin = 300 phút (5h), terrain cực khó, mưa outdoor
    // fatigueDelta thực = 0.875 → raw = 1.775, nhưng phải bị cap về 1.0
    const s = makeState({ fatigue: 0.9, currentLat: 16.0, currentLng: 108.0 });
    const place = makePlace({
      lat: 17.0, lng: 109.0,
      terrainEasiness: 0.0,
      indoorOutdoor: 'outdoor',
      avgVisitDurationMin: 360,
    });
    const slot = makeSlot({ placeId: place.placeId });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 300,
      place,
      weatherAtSlot: { rainMmPerH: 10 },
      user: DEFAULT_USER,
    });
    // Sau khi fix: fatigue bị cap tại 1.0
    expect(next.fatigue).toBeLessThanOrEqual(1.0);
    expect(next.fatigue).toBeGreaterThan(0.9);  // vẫn tăng so với trước
  });

  it('B2.6 — evolve() fatigue không bao giờ âm (vẫn có Math.max(0, ...))', () => {
    // Bữa ăn trừ 0.12 fatigue từ trạng thái ban đầu rất thấp
    const s = makeState({ fatigue: 0.05 });
    const place = makePlace({ avgVisitDurationMin: 30 });
    const slot = makeSlot({ activityType: 'meal', placeId: place.placeId });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: DEFAULT_USER,
    });
    expect(next.fatigue).toBeGreaterThanOrEqual(0);
  });

  it('B2.7 — [INVARIANT] evolve() fatigue nên bị cap tại 1.0 (test invariant — có thể FAIL)', () => {
    // Test này kiểm tra invariant: fatigue là [0,1] ratio
    // Nếu không cap → test FAIL, phát hiện bug
    const s = makeState({ fatigue: 0.9 });
    const place = makePlace({
      terrainEasiness: 0.0,
      indoorOutdoor: 'outdoor',
      avgVisitDurationMin: 360,
    });
    const slot = makeSlot({ placeId: place.placeId });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 300,
      place,
      weatherAtSlot: { rainMmPerH: 10 },
      user: DEFAULT_USER,
    });
    // Invariant: fatigue là [0,1] ratio, không được > 1
    expect(next.fatigue, 'fatigue phải <= 1.0 (là tỉ lệ [0,1])').toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// Batch 3 — score() vs scoreFullAndCache() nhất quán
// ---------------------------------------------------------------------------

describe('Batch 3 — ObjectiveScorer: score() vs scoreFullAndCache() nhất quán', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  it('B3.1 — score() == scoreFullAndCache().total với plan 1 slot, không weather', () => {
    const plan = [makeSlot()];
    const states: TripState[] = [makeState(), makeState({ fatigue: 0.15 })];
    const weights = { ...ZERO_WEIGHTS, wInterest: 1, wRisk: 1, wPace: 1 };
    const ctx = makeCtx({ weights });

    const direct = scorer.score(plan, states, weights, ctx);
    const { total } = scorer.scoreFullAndCache(plan, states, weights, ctx);

    expect(direct).toBeCloseTo(total, 6);
  });

  it('B3.2 — score() == scoreFullAndCache().total với plan nhiều slot, có weather', () => {
    const placeA = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, indoorOutdoor: 'outdoor', avgVisitDurationMin: 90 });
    const placeB = makePlace({ placeId: 2, lat: 16.08, lng: 108.24, indoorOutdoor: 'indoor', avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: 1, slotId: 's1', slotOrder: 0 }),
      makeSlot({ placeId: 2, slotId: 's2', slotOrder: 1 }),
    ];
    const s0 = makeState({ timeRemainingMin: 480, fatigue: 0 });
    const s1 = makeState({ timeRemainingMin: 360, fatigue: 0.2 });
    const s2 = makeState({ timeRemainingMin: 280, fatigue: 0.3 });
    const states = [s0, s1, s2];
    const weights: ObjectiveWeights = {
      wInterest: 1, wPace: 1, wDistance: 1.5,
      wBudget: 1, wWeather: 1, wRisk: 1,
      wStability: 0.5, wPotentialBias: 1, wProximity: 0,
      wSynergy: 0.3,
    };
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: s0,
      candidatePool: [placeA, placeB],
      placeMap: new Map([[1, placeA], [2, placeB]]),
      user: DEFAULT_USER,
      weights,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [{ rainMmPerH: 15 }],  // mưa ngày 0
    };

    const direct = scorer.score(plan, states, weights, ctx);
    const { total } = scorer.scoreFullAndCache(plan, states, weights, ctx);

    expect(direct).toBeCloseTo(total, 5);
  });

  it('B3.3 — score() == scoreFullAndCache().total khi budget bị vượt', () => {
    const plan = [makeSlot({ estimatedCost: 500_000 })];
    const states: TripState[] = [makeState({ budgetRemaining: 100 }), makeState({ budgetRemaining: -500 })];
    const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
    const ctx = makeCtx({ weights });

    const direct = scorer.score(plan, states, weights, ctx);
    const { total } = scorer.scoreFullAndCache(plan, states, weights, ctx);

    expect(direct).toBeCloseTo(total, 5);
  });

  it('B3.4 — score() == scoreFullAndCache().total với proximity (userIsAtVenue=true)', () => {
    const place = makePlace({ lat: 16.07, lng: 108.23 });
    const plan = [makeSlot()];
    const s0 = makeState();
    const s1 = makeState({ fatigue: 0.12 });
    const weights = { ...ZERO_WEIGHTS, wProximity: 1 };
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: s0,
      candidatePool: [place],
      placeMap: new Map([[place.placeId, place]]),
      user: DEFAULT_USER,
      weights,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      userIsAtVenue: true,
      venueLatLng: { lat: 16.06, lng: 108.22 },
    };

    const direct = scorer.score(plan, [s0, s1], weights, ctx);
    const { total } = scorer.scoreFullAndCache(plan, [s0, s1], weights, ctx);

    expect(direct).toBeCloseTo(total, 5);
  });

  it('B3.5 — scoreDelta(resumeIndex=0) == scoreFullAndCache() (fallback path)', () => {
    const place = makePlace();
    const plan = [makeSlot(), makeSlot({ slotId: 's2', slotOrder: 1, placeId: 1 })];
    const states: TripState[] = [makeState(), makeState({ fatigue: 0.2 }), makeState({ fatigue: 0.3 })];
    const weights = { ...ZERO_WEIGHTS, wInterest: 1, wRisk: 1, wPace: 0.5 };
    const ctx = makeCtx({ weights, candidatePool: [place], placeMap: new Map([[place.placeId, place]]) });

    const { total: fullTotal } = scorer.scoreFullAndCache(plan, states, weights, ctx);
    const { total: deltaTotal } = scorer.scoreDelta(plan, states, weights, ctx, [], null, 0);

    expect(deltaTotal).toBeCloseTo(fullTotal, 5);
  });
});

// ---------------------------------------------------------------------------
// Batch 4 — ProposalStore SQL construction
// ---------------------------------------------------------------------------

describe('Batch 4 — ProposalStore: SQL construction via mock pool', () => {
  it('B4.1 — findMany builds correct SQL when only tripId filter is given', async () => {
    const { ProposalStore } = await import('../src/replanner/ProposalStore');
    const queries: Array<{ text: string; params: unknown[] }> = [];
    const mockPool = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      },
    } as any;

    const store = new ProposalStore(mockPool);
    await store.findMany({ tripId: 'trip-abc', status: 'pending', limit: 1 });

    expect(queries).toHaveLength(1);
    const { text, params } = queries[0]!;
    expect(text).toContain('trip_id = $1');
    expect(text).toContain('status = $2');
    expect(text).toContain('LIMIT $3');
    expect(params).toEqual(['trip-abc', 'pending', 1]);
  });

  it('B4.2 — findMany với offset thêm đúng clause', async () => {
    const { ProposalStore } = await import('../src/replanner/ProposalStore');
    const queries: Array<{ text: string; params: unknown[] }> = [];
    const mockPool = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      },
    } as any;

    const store = new ProposalStore(mockPool);
    await store.findMany({ tripId: 'trip-xyz', limit: 5, offset: 10 });

    const { text, params } = queries[0]!;
    expect(text).toContain('LIMIT');
    expect(text).toContain('OFFSET');
    expect(params).toContain(5);
    expect(params).toContain(10);
  });

  it('B4.3 — findMany không có filter sinh WHERE rỗng', async () => {
    const { ProposalStore } = await import('../src/replanner/ProposalStore');
    const queries: Array<{ text: string; params: unknown[] }> = [];
    const mockPool = {
      query: async (text: string, params: unknown[]) => {
        queries.push({ text, params });
        return { rows: [] };
      },
    } as any;

    const store = new ProposalStore(mockPool);
    await store.findMany({});

    const { text } = queries[0]!;
    // Không được có WHERE clause khi không có filter
    expect(text).not.toContain('WHERE');
  });
});

// ---------------------------------------------------------------------------
// Batch 5 — CausalTraceBuilder: lifecycle
// ---------------------------------------------------------------------------

describe('Batch 5 — CausalTraceBuilder: begin/record/finalize/reset', () => {
  let builder: CausalTraceBuilder;

  beforeEach(() => {
    builder = new CausalTraceBuilder();
  });

  it('B5.1 — finalize() ném lỗi nếu chưa gọi begin()', () => {
    expect(() => builder.finalize()).toThrow('phải gọi begin()');
  });

  it('B5.2 — begin/finalize trả về CausalTrace đúng cấu trúc', () => {
    const event: TripEvent = { eventId: 'ev-001' } as TripEvent;
    builder.begin('trip-abc', event);
    const trace = builder.finalize();

    expect(trace.tripId).toBe('trip-abc');
    expect(trace.triggeredByEventId).toBe('ev-001');
    expect(trace.steps).toEqual([]);
    expect(trace.computationMs).toBeGreaterThanOrEqual(0);
    expect(trace.createdAt).toBeInstanceOf(Date);
  });

  it('B5.3 — record() steps được giữ đúng thứ tự', () => {
    const event: TripEvent = { eventId: 'ev-002' } as TripEvent;
    builder.begin('trip-xyz', event);

    const step1: CausalTraceStep = {
      stepIndex: 0, reason: 'drop slot A',
      affectedSlotId: 'slot-A', alternativeChosen: null, downstreamImpact: null,
    };
    const step2: CausalTraceStep = {
      stepIndex: 1, reason: 'insert slot B',
      affectedSlotId: 'slot-B', alternativeChosen: { placeId: 2, reason: 'nearby' }, downstreamImpact: null,
    };
    builder.record(step1);
    builder.record(step2);

    const trace = builder.finalize();
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]!.reason).toBe('drop slot A');
    expect(trace.steps[1]!.reason).toBe('insert slot B');
    expect(trace.steps[1]!.alternativeChosen?.placeId).toBe(2);
  });

  it('B5.4 — reset() sau finalize() làm finalize() ném lỗi trở lại', () => {
    const event: TripEvent = { eventId: 'ev-003' } as TripEvent;
    builder.begin('trip-r', event);
    builder.finalize();  // OK
    builder.reset();
    expect(() => builder.finalize()).toThrow('phải gọi begin()');
  });
});

// ---------------------------------------------------------------------------
// Batch 6 — FeasibilityFilter: isSetFeasible lower-bound checks
// ---------------------------------------------------------------------------

describe('Batch 6 — FeasibilityFilter: isSetFeasible LB checks & cache', () => {
  function makeCtxWithConstraints(timeRemainingMin: number, budgetRemaining: number): Parameters<typeof isSetFeasible>[1] {
    return {
      initialState: makeState({ timeRemainingMin, budgetRemaining }),
    } as any;
  }

  beforeEach(() => clearSetFeasibilityCache());

  it('B6.1 — isSetFeasible([]) → true (empty plan luôn feasible)', () => {
    const ctx = makeCtxWithConstraints(0, 0);
    expect(isSetFeasible([], ctx)).toBe(true);
  });

  it('B6.2 — infeasible khi LB visit time > timeRemainingMin', () => {
    // place cần 120 phút thăm, chỉ còn 60 phút
    const place = makePlace({ avgVisitDurationMin: 120, minPrice: 0 });
    const ctx = makeCtxWithConstraints(60, 1_000_000);
    expect(isSetFeasible([place], ctx)).toBe(false);
  });

  it('B6.3 — feasible khi LB visit time <= timeRemainingMin (không kể travel)', () => {
    // place cần 60 phút thăm, còn 120 phút (travel Haversine ≈ 0 vì cùng tọa độ)
    const place = makePlace({ avgVisitDurationMin: 60, minPrice: 0, lat: 16.06, lng: 108.22 });
    const ctx = {
      initialState: makeState({
        timeRemainingMin: 120,
        budgetRemaining: 1_000_000,
        currentLat: 16.06, currentLng: 108.22,
      }),
    } as any;
    expect(isSetFeasible([place], ctx)).toBe(true);
  });

  it('B6.4 — infeasible khi LB cost > budgetRemaining', () => {
    // place có minPrice = 100_000, budget chỉ còn 50_000
    const place = makePlace({ avgVisitDurationMin: 10, minPrice: 100_000 });
    const ctx = makeCtxWithConstraints(600, 50_000);
    expect(isSetFeasible([place], ctx)).toBe(false);
  });

  it('B6.5 — 2 places xa nhau tăng LB time thông qua MST Haversine', () => {
    // 2 places ≈ 111 km từ nhau (1 độ lat ≈ 111 km)
    // MST = Haversine(p1,p2) ≈ 111 km
    // LB travel time = 111 / 60 * 60 ≈ 111 min
    // LB visit = 30 + 30 = 60 min
    // LB total ≈ 171 min
    const p1 = makePlace({ placeId: 1, lat: 16.0, lng: 108.0, avgVisitDurationMin: 30, minPrice: 0 });
    const p2 = makePlace({ placeId: 2, lat: 17.0, lng: 108.0, avgVisitDurationMin: 30, minPrice: 0 });

    // 170 phút: đủ nếu LB < 170 nhưng thực ra LB ≈ 171 → infeasible
    const ctxTight = makeCtxWithConstraints(170, 1_000_000);
    expect(isSetFeasible([p1, p2], ctxTight)).toBe(false);

    // Cache chỉ valid trong 1 lần search() call (context cố định).
    // Clear trước khi test với context khác.
    clearSetFeasibilityCache();

    // 200 phút: vượt LB → feasible theo filter
    const ctxGenerous = makeCtxWithConstraints(200, 1_000_000);
    expect(isSetFeasible([p1, p2], ctxGenerous)).toBe(true);
  });

  it('B6.6 — cache cleared: thay đổi budget vẫn tính lại đúng', () => {
    const place = makePlace({ avgVisitDurationMin: 10, minPrice: 100_000 });

    // Lần 1: budget 50_000 → infeasible
    const ctx1 = makeCtxWithConstraints(600, 50_000);
    expect(isSetFeasible([place], ctx1)).toBe(false);

    // Clear cache và thử với ctx2 có budget khác — cache entry mới dùng key khác (placeId)
    // nhưng LB là bất biến với set places → kết quả đúng nếu cache key không mang budget
    clearSetFeasibilityCache();

    // Lần 2: budget 200_000 → feasible
    const ctx2 = makeCtxWithConstraints(600, 200_000);
    expect(isSetFeasible([place], ctx2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch 7 — MutationOperators: generateAll cap & round-robin
// ---------------------------------------------------------------------------

describe('Batch 7 — MutationOperators: generateAll cap & round-robin', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  function makePlan(n: number): { plan: TripSlot[]; places: Place[] } {
    const places: Place[] = [];
    const plan: TripSlot[] = [];
    const now = new Date('2026-05-23T08:00:00Z');
    for (let i = 0; i < n; i++) {
      places.push(makePlace({
        placeId: i + 1,
        lat: 16.06 + i * 0.01,
        lng: 108.22 + i * 0.01,
        avgVisitDurationMin: 60,
        minPrice: 0,
      }));
      const start = new Date(now.getTime() + i * 90 * 60_000);
      const end   = new Date(start.getTime() + 60 * 60_000);
      plan.push(makeSlot({
        slotId: `s${i}`, placeId: i + 1, slotOrder: i,
        plannedStart: start.toISOString(),
        plannedEnd:   end.toISOString(),
      }));
    }
    return { plan, places };
  }

  it('B7.1 — generateAll() luôn trả về <= GENERATE_ALL_CAP kết quả', () => {
    const { plan, places } = makePlan(8);
    const pool = [...places, ...Array.from({ length: 5 }, (_, i) =>
      makePlace({ placeId: 100 + i, lat: 16.0 + i * 0.02, lng: 108.0 + i * 0.02 })
    )];
    const ctx: any = {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 1200, budgetRemaining: 5_000_000 }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    const results = operators.generateAll(plan, ctx);
    expect(results.length).toBeLessThanOrEqual(GENERATE_ALL_CAP);
  });

  it('B7.2 — generateAll() trả về kết quả với plan trống là []', () => {
    const ctx: any = {
      remainingSlots: [],
      initialState: makeState(),
      candidatePool: [],
      placeMap: new Map(),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
    const results = operators.generateAll([], ctx);
    expect(results).toHaveLength(0);
  });

  it('B7.3 — generateAllAdaptive() với all-zero budget → rỗng', () => {
    const { plan, places } = makePlan(3);
    const allZero = new Map<OperatorName, number>([
      ['TIME_SHIFT', 0], ['SWAP_ORDER', 0], ['REPLACE_PLACE', 0],
      ['DROP_SLOT', 0], ['INSERT_ALT', 0], ['TSP_REORDER', 0],
    ]);
    const ctx: any = {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 600, budgetRemaining: 1_000_000 }),
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
    const { candidates } = operators.generateAllAdaptive(plan, ctx, allZero);
    expect(candidates).toHaveLength(0);
  });

  it('B7.4 — generateAll() mỗi kết quả có operator name hợp lệ', () => {
    const { plan, places } = makePlan(3);
    const ctx: any = {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 600, budgetRemaining: 1_000_000 }),
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
    const validOps: OperatorName[] = ['TIME_SHIFT', 'SWAP_ORDER', 'REPLACE_PLACE', 'DROP_SLOT', 'INSERT_ALT', 'TSP_REORDER'];
    const results = operators.generateAll(plan, ctx);
    for (const r of results) {
      expect(validOps).toContain(r.operator);
      expect(r.newPlan).toBeDefined();
      expect(r.affectedSlotIds).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 8 — BeamSearch.search(): end-to-end behavior
// ---------------------------------------------------------------------------

describe('Batch 8 — BeamSearch.search(): end-to-end', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
    scorer = new ObjectiveScorer(evolver);
  });

  function makeMinimalCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
    const placeA = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60, minPrice: 0 });
    const placeB = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60, minPrice: 0 });
    const plan = [
      makeSlot({
        slotId: 's1', placeId: 1, slotOrder: 0,
        plannedStart: '2026-05-23T08:00:00.000Z',
        plannedEnd:   '2026-05-23T09:00:00.000Z',
      }),
    ];
    return {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 600, budgetRemaining: 1_000_000 }),
      candidatePool: [placeA, placeB],
      placeMap: new Map([[1, placeA], [2, placeB]]),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      ...overrides,
    };
  }

  it('B8.1 — search() luôn trả về BeamNode có plan là mảng và score là số hữu hạn', () => {
    const bs = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 3, maxIterations: 3, latencyBudgetMs: 5000, improvementThreshold: -Infinity,
    });
    const ctx = makeMinimalCtx();
    const best = bs.search(ctx);

    expect(Array.isArray(best.plan)).toBe(true);
    expect(Number.isFinite(best.score)).toBe(true);
    expect(best.mutationHistory).toBeDefined();
  });

  it('B8.2 — plan trả về bởi search() là feasible theo evolver.isPlanFeasible()', () => {
    const bs = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 3, maxIterations: 5, latencyBudgetMs: 5000, improvementThreshold: -Infinity,
    });
    const ctx = makeMinimalCtx();
    const best = bs.search(ctx);

    const ctxForCheck: any = { ...ctx, placeMap: ctx.placeMap };
    expect(evolver.isPlanFeasible(best.plan, ctx.initialState, ctxForCheck)).toBe(true);
  });

  it('B8.3 — search() với latencyBudgetMs = -1 không chạy iteration, trả về root', () => {
    const bs = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 3, maxIterations: 100, latencyBudgetMs: -1, improvementThreshold: -Infinity,
    });
    const ctx = makeMinimalCtx();
    const best = bs.search(ctx);

    // Không có iteration nào → không có mutation history
    expect(best.mutationHistory).toHaveLength(0);
  });

  it('B8.4 — search() ưu tiên DROP_SLOT khi plan có time overflow', () => {
    // Tạo plan có thời gian vượt quá budget: slot 300 phút nhưng chỉ còn 100 phút
    const heavyPlace = makePlace({
      placeId: 1, avgVisitDurationMin: 300, minPrice: 0,
      lat: 16.06, lng: 108.22,
    });
    const lightPlace = makePlace({
      placeId: 2, avgVisitDurationMin: 30, minPrice: 0,
      lat: 16.06, lng: 108.22,
    });
    const plan = [
      makeSlot({
        slotId: 's1', placeId: 1, slotOrder: 0,
        plannedStart: '2026-05-23T08:00:00.000Z',
        plannedEnd:   '2026-05-23T13:00:00.000Z',
      }),
    ];
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 100, budgetRemaining: 1_000_000 }),
      candidatePool: [heavyPlace, lightPlace],
      placeMap: new Map([[1, heavyPlace], [2, lightPlace]]),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    const bs = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 5, maxIterations: 10, latencyBudgetMs: 5000, improvementThreshold: -Infinity,
    });
    const best = bs.search(ctx);

    // Score của plan rỗng (drop slot) = 0, score root = -timePenalty (rất âm)
    // BeamSearch phải tìm ra plan tốt hơn root
    expect(best.score).toBeGreaterThan(-1000);
  });

  it('B8.5 — collectFeedback() returns correct survival counts for surviving operator', () => {
    const newBeam = [
      { plan: [makeSlot({ slotId: 's1' })], score: 10, mutationHistory: [{ operator: 'DROP_SLOT', newPlan: [], affectedSlotIds: ['s1'], description: '' }] },
    ] as any[];

    const allCandidates = [
      { plan: [makeSlot({ slotId: 's1' })], score: 10, mutationHistory: [{ operator: 'DROP_SLOT', newPlan: [], affectedSlotIds: ['s1'], description: '' }] },
      { plan: [makeSlot({ slotId: 's2', placeId: 2 })], score: 5, mutationHistory: [{ operator: 'TIME_SHIFT', newPlan: [], affectedSlotIds: ['s2'], description: '' }] },
    ] as any[];

    const generatedCounts = new Map<OperatorName, number>([
      ['DROP_SLOT', 1], ['TIME_SHIFT', 1], ['SWAP_ORDER', 0],
      ['REPLACE_PLACE', 0], ['INSERT_ALT', 0], ['TSP_REORDER', 0],
    ]);

    const feedbacks = collectFeedback(newBeam, allCandidates, generatedCounts);
    const dropFb = feedbacks.find(f => f.operator === 'DROP_SLOT');
    const shiftFb = feedbacks.find(f => f.operator === 'TIME_SHIFT');

    // DROP_SLOT survived (là beam member), TIME_SHIFT không survived
    expect(dropFb?.candidatesSurvived).toBe(1);
    expect(shiftFb?.candidatesSurvived).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 9 — scoreDelta incremental path (resumeIndex > 0)
// ---------------------------------------------------------------------------

describe('Batch 9 — ObjectiveScorer: scoreDelta incremental path', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  it('B9.1 — scoreDelta(resumeIndex=1) == scoreFullAndCache cho plan 2-slot (prefix reuse)', () => {
    const placeA = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const placeB = makePlace({ placeId: 2, lat: 16.08, lng: 108.24, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: 1, slotId: 's1', slotOrder: 0 }),
      makeSlot({ placeId: 2, slotId: 's2', slotOrder: 1 }),
    ];
    const s0 = makeState({ timeRemainingMin: 480, budgetRemaining: 500_000, fatigue: 0 });
    const s1 = makeState({ timeRemainingMin: 420, budgetRemaining: 490_000, fatigue: 0.1 });
    const s2 = makeState({ timeRemainingMin: 360, budgetRemaining: 480_000, fatigue: 0.2 });
    const states = [s0, s1, s2];
    const weights: ObjectiveWeights = {
      wInterest: 1, wPace: 0.5, wDistance: 1,
      wBudget: 1, wWeather: 0.5, wRisk: 1,
      wStability: 0.3, wPotentialBias: 0.5, wProximity: 0,
      wSynergy: 0.2,
    };
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: s0,
      candidatePool: [placeA, placeB],
      placeMap: new Map([[1, placeA], [2, placeB]]),
      user: DEFAULT_USER,
      weights,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    const { total: fullTotal, cache: parentCache } = scorer.scoreFullAndCache(plan, states, weights, ctx, []);
    const { total: deltaTotal } = scorer.scoreDelta(plan, states, weights, ctx, [], parentCache, 1);

    expect(deltaTotal).toBeCloseTo(fullTotal, 5);
  });

  it('B9.2 — scoreDelta(resumeIndex=2) == scoreFullAndCache cho plan 3-slot (prefix 2 slots)', () => {
    const places = [1, 2, 3].map(i => makePlace({ placeId: i, lat: 16.06 + i * 0.01, lng: 108.22, avgVisitDurationMin: 60 }));
    const plan = [0, 1, 2].map(i => makeSlot({ placeId: i + 1, slotId: `s${i}`, slotOrder: i }));
    const states = [0, 1, 2, 3].map(i => makeState({
      timeRemainingMin: 480 - i * 60,
      budgetRemaining: 500_000 - i * 10_000,
      fatigue: i * 0.1,
    }));
    const weights: ObjectiveWeights = {
      wInterest: 1, wPace: 1, wDistance: 1,
      wBudget: 1, wWeather: 0, wRisk: 1,
      wStability: 1, wPotentialBias: 0, wProximity: 0, wSynergy: 0.5,
    };
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: states[0]!,
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    const { total: fullTotal, cache: parentCache } = scorer.scoreFullAndCache(plan, states, weights, ctx, []);
    const { total: deltaTotal } = scorer.scoreDelta(plan, states, weights, ctx, [], parentCache, 2);

    expect(deltaTotal).toBeCloseTo(fullTotal, 5);
  });

  it('B9.3 — [INVARIANT] scoreDelta(resumeIndex=N) == scoreFullAndCache cho bất kỳ N', () => {
    const places = [1, 2, 3, 4].map(i => makePlace({ placeId: i, lat: 16.0 + i * 0.01, lng: 108.0, avgVisitDurationMin: 45 }));
    const plan = places.map((p, i) => makeSlot({ placeId: p.placeId, slotId: `s${i}`, slotOrder: i }));
    const states = [0, 1, 2, 3, 4].map(i => makeState({
      timeRemainingMin: 600 - i * 50,
      budgetRemaining: 1_000_000 - i * 5_000,
      fatigue: Math.min(0.9, i * 0.15),
    }));
    const weights: ObjectiveWeights = {
      wInterest: 0.5, wPace: 0.5, wDistance: 0.5,
      wBudget: 0.5, wWeather: 0, wRisk: 0.5,
      wStability: 0.3, wPotentialBias: 0, wProximity: 0, wSynergy: 0.2,
    };
    const ctx: BeamSearchContext = {
      remainingSlots: plan,
      initialState: states[0]!,
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    const { total: fullTotal, cache: parentCache } = scorer.scoreFullAndCache(plan, states, weights, ctx, []);

    for (let resumeIndex = 1; resumeIndex <= plan.length; resumeIndex++) {
      const { total: deltaTotal } = scorer.scoreDelta(plan, states, weights, ctx, [], parentCache, resumeIndex);
      expect(deltaTotal, `resumeIndex=${resumeIndex} phải bằng full score`).toBeCloseTo(fullTotal, 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 10 — repairSuffix edge cases
// ---------------------------------------------------------------------------

describe('Batch 10 — MutationOperators: repairSuffix edge cases', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  function makeCtxForRepair(overrides: Partial<any> = {}): any {
    const place1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const place2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    return {
      initialState: makeState({ capturedAt: '2026-05-23T01:00:00.000Z', currentLat: 16.06, currentLng: 108.22 }),
      candidatePool: [place1, place2],
      placeMap: new Map([[1, place1], [2, place2]]),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      maxOverflowMinutes: 30,
      ...overrides,
    };
  }

  it('B10.1 — repairSuffix([]) → []', () => {
    const ctx = makeCtxForRepair();
    const result = operators.repairSuffix([], 0, ctx);
    expect(result).toEqual([]);
  });

  it('B10.2 — repairSuffix(plan, fromIndex >= plan.length) → deep copy của plan', () => {
    const plan = [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })];
    const ctx = makeCtxForRepair();
    const result = operators.repairSuffix(plan, plan.length, ctx);
    expect(result).not.toBeNull();
    expect(result).not.toBe(plan);               // bản sao mới
    expect(result!.length).toBe(plan.length);
    expect(result![0]).not.toBe(plan[0]);         // deep-clone (không phải reference gốc)
    expect(result![0]!.slotId).toBe('s1');
  });

  it('B10.3 — repairSuffix trả về null khi preceding slot overflow vào locked slot', () => {
    // Slot 0 kết thúc sau khi locked slot 1 bắt đầu → overflow → return null
    const plan: TripSlot[] = [
      makeSlot({
        slotId: 's1', placeId: 1, slotOrder: 0, dayIndex: 0,
        plannedStart: '2026-05-23T08:00:00.000Z',
        plannedEnd:   '2026-05-23T09:00:00.000Z',
      }),
      {
        ...makeSlot({
          slotId: 's2-locked', placeId: 2, slotOrder: 1, dayIndex: 0,
          plannedStart: '2026-05-23T08:30:00.000Z',  // overlap với slot 0
          plannedEnd:   '2026-05-23T09:30:00.000Z',
        }),
        isLocked: true,
      } as any,
    ];

    const ctx = makeCtxForRepair({
      initialState: makeState({ capturedAt: '2026-05-23T07:00:00.000Z' }),
    });

    // repairSuffix bắt đầu từ index 1 (sau khi slot 0 đã xử lý)
    // cursor sau slot 0 = 09:00, locked slot bắt đầu lúc 08:30 → cursor > lockedStart → null
    const result = operators.repairSuffix(plan, 1, ctx);
    expect(result).toBeNull();
  });

  it('B10.4 — repairSuffix trả về plan với estimatedCost từ place.minPrice khi slot.estimatedCost = 0', () => {
    const placeWithPrice = makePlace({ placeId: 1, minPrice: 50_000, avgVisitDurationMin: 60 });
    const ctx: any = {
      initialState: makeState({ capturedAt: '2026-05-23T01:00:00.000Z' }),
      candidatePool: [placeWithPrice],
      placeMap: new Map([[1, placeWithPrice]]),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      maxOverflowMinutes: 30,
    };
    const plan = [makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 0 })];
    const result = operators.repairSuffix(plan, 0, ctx);

    expect(result).not.toBeNull();
    // estimatedCost = 0 → dùng place.minPrice
    expect(result![0]!.estimatedCost).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// Batch 11 — StateEvolver.computeTrajectory & computeTrajectoryIncremental
// ---------------------------------------------------------------------------

describe('Batch 11 — StateEvolver: computeTrajectory & incremental', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
  });

  function makeMinimalCtxForTrajectory(places: Place[]): any {
    return {
      initialState: makeState({ timeRemainingMin: 600, budgetRemaining: 1_000_000 }),
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
  }

  it('B11.1 — computeTrajectory trả về n+1 states cho n-slot plan', () => {
    const places = [1, 2, 3].map(i => makePlace({ placeId: i, avgVisitDurationMin: 60, lat: 16.06, lng: 108.22 }));
    const plan = places.map((p, i) => makeSlot({ placeId: p.placeId, slotId: `s${i}`, estimatedCost: 0 }));
    const ctx = makeMinimalCtxForTrajectory(places);
    const states = evolver.computeTrajectory(plan, ctx.initialState, ctx);
    expect(states).toHaveLength(plan.length + 1);
  });

  it('B11.2 — computeTrajectory([]) trả về [initialState] (chỉ 1 phần tử)', () => {
    const ctx = makeMinimalCtxForTrajectory([]);
    const states = evolver.computeTrajectory([], ctx.initialState, ctx);
    expect(states).toHaveLength(1);
    expect(states[0]).toBe(ctx.initialState);
  });

  it('B11.3 — computeTrajectory ném lỗi khi placeId không có trong pool', () => {
    const ctx = makeMinimalCtxForTrajectory([]);
    const plan = [makeSlot({ placeId: 999, slotId: 's1' })];
    expect(() => evolver.computeTrajectory(plan, ctx.initialState, ctx)).toThrow('placeId 999');
  });

  it('B11.4 — time & budget accounting: 1 slot, travelTimeMin=30, visitDuration=60, cost=50_000', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, lat: 16.06, lng: 108.22, minPrice: 0 });
    const ctx = makeMinimalCtxForTrajectory([place]);
    const initialState = makeState({ timeRemainingMin: 300, budgetRemaining: 200_000 });

    // Override buildEvolveContext travel time by using same lat/lng (travel ≈ 0)
    // then test directly with evolve()
    const evolveCtx = {
      travelTimeMin: 30,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: DEFAULT_USER,
    };
    const slot = makeSlot({ placeId: 1, estimatedCost: 50_000 });
    const nextState = evolver.evolve(initialState, slot, evolveCtx);

    expect(nextState.timeRemainingMin).toBe(300 - 30 - 60);     // 210
    expect(nextState.budgetRemaining).toBe(200_000 - 50_000);   // 150_000
    expect(nextState.currentLat).toBe(place.lat);
    expect(nextState.currentLng).toBe(place.lng);
  });

  it('B11.5 — currentLat/currentLng sau visit là lat/lng của place (không phải state cũ)', () => {
    const place = makePlace({ placeId: 1, lat: 17.5, lng: 109.5, avgVisitDurationMin: 60 });
    const initial = makeState({ currentLat: 16.0, currentLng: 108.0 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 0 });
    const nextState = evolver.evolve(initial, slot, {
      travelTimeMin: 0, place, weatherAtSlot: { rainMmPerH: 0 }, user: DEFAULT_USER,
    });
    expect(nextState.currentLat).toBe(17.5);
    expect(nextState.currentLng).toBe(109.5);
  });

  it('B11.6 — [INVARIANT] computeTrajectoryIncremental(resumeIndex=1) == computeTrajectory', () => {
    const places = [1, 2, 3].map(i => makePlace({ placeId: i, avgVisitDurationMin: 45, lat: 16.06 + i * 0.01, lng: 108.22 }));
    const plan = places.map((p, i) => makeSlot({ placeId: p.placeId, slotId: `s${i}`, estimatedCost: 10_000 * i }));
    const initialState = makeState({ timeRemainingMin: 600, budgetRemaining: 500_000 });
    const ctx = makeMinimalCtxForTrajectory(places);

    const fullStates = evolver.computeTrajectory(plan, initialState, ctx);

    const parentCache: any = {
      states: fullStates,
      slotScores: [],
      planScores: { pace: 0, synergy: 0, synergyPairs: [] },
      planHash: computePlanHash(plan),
    };

    const { states: incStates } = evolver.computeTrajectoryIncremental(plan, initialState, ctx, parentCache, 1);

    expect(incStates).toHaveLength(fullStates.length);
    for (let i = 0; i < fullStates.length; i++) {
      expect(incStates[i]!.timeRemainingMin, `states[${i}].timeRemainingMin`).toBeCloseTo(fullStates[i]!.timeRemainingMin, 5);
      expect(incStates[i]!.budgetRemaining, `states[${i}].budgetRemaining`).toBeCloseTo(fullStates[i]!.budgetRemaining, 5);
      expect(incStates[i]!.fatigue, `states[${i}].fatigue`).toBeCloseTo(fullStates[i]!.fatigue, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 12 — StateEvolver.isPlanFeasible: completed/skipped slot handling
// ---------------------------------------------------------------------------

describe('Batch 12 — StateEvolver: isPlanFeasible edge cases', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
  });

  function makeCtxForFeasibility(places: Place[]): any {
    return {
      initialState: makeState(),
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
  }

  it('B12.1 — isPlanFeasible returns true cho plan hoàn toàn feasible', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const ctx = makeCtxForFeasibility([place]);
    const plan = [makeSlot({ placeId: 1, estimatedCost: 0 })];
    expect(evolver.isPlanFeasible(plan, makeState({ timeRemainingMin: 600, budgetRemaining: 500_000 }), ctx)).toBe(true);
  });

  it('B12.2 — isPlanFeasible returns false khi initialState infeasible (fatigue > 0.95)', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const ctx = makeCtxForFeasibility([place]);
    const infeasibleState = makeState({ fatigue: 0.96 });
    expect(evolver.isPlanFeasible([], infeasibleState, ctx)).toBe(false);
  });

  it('B12.3 — isPlanFeasible bỏ qua completed slot (không trừ time/budget)', () => {
    // Nếu slot 0 không bị skip: budgetRemaining = 200_000 - 150_000 = 50_000 sau slot 0
    // Sau slot 1: 50_000 - 150_000 = -100_000 → infeasible
    // Nếu slot 0 là completed: bỏ qua → budget 200_000 cho slot 1 → 200_000 - 150_000 = 50_000 → feasible
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const ctx = makeCtxForFeasibility([place]);
    const plan: TripSlot[] = [
      { ...makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 150_000 }), status: 'completed' as const },
      makeSlot({ slotId: 's2', placeId: 1, estimatedCost: 150_000 }),
    ];
    const initial = makeState({ timeRemainingMin: 600, budgetRemaining: 200_000 });
    // completed slot bị skip → chỉ slot 1 consume budget: 200_000 - 150_000 = 50_000 → feasible
    expect(evolver.isPlanFeasible(plan, initial, ctx)).toBe(true);
  });

  it('B12.4 — isPlanFeasible bỏ qua skipped slot tương tự completed', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const ctx = makeCtxForFeasibility([place]);
    const plan: TripSlot[] = [
      { ...makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 150_000 }), status: 'skipped' as const },
      makeSlot({ slotId: 's2', placeId: 1, estimatedCost: 150_000 }),
    ];
    const initial = makeState({ timeRemainingMin: 600, budgetRemaining: 200_000 });
    expect(evolver.isPlanFeasible(plan, initial, ctx)).toBe(true);
  });

  it('B12.5 — isPlanFeasible không ném lỗi với completed slot có placeId không trong pool', () => {
    const ctx = makeCtxForFeasibility([]);  // pool rỗng
    const plan: TripSlot[] = [
      { ...makeSlot({ slotId: 's1', placeId: 999 }), status: 'completed' as const },
    ];
    // slot completed → bỏ qua trước khi placeMap.get → không ném lỗi
    expect(() => evolver.isPlanFeasible(plan, makeState(), ctx)).not.toThrow();
    expect(evolver.isPlanFeasible(plan, makeState(), ctx)).toBe(true);
  });

  it('B12.6 — [INVARIANT] planned slot có placeId không trong pool ném lỗi rõ ràng', () => {
    const ctx = makeCtxForFeasibility([]);  // pool rỗng, không có placeId 999
    const plan = [makeSlot({ placeId: 999 })];
    expect(() => evolver.isPlanFeasible(plan, makeState(), ctx))
      .toThrow('placeId 999 not found in candidatePool');
  });
});

// ---------------------------------------------------------------------------
// Batch 13 — MutationOperators: operator safety invariants
// ---------------------------------------------------------------------------

describe('Batch 13 — MutationOperators: operator safety invariants', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  function makeOperatorCtx(plan: TripSlot[], places: Place[]): any {
    return {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 600, budgetRemaining: 1_000_000 }),
      candidatePool: places,
      placeMap: new Map(places.map(p => [p.placeId, p])),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
  }

  it('B13.1 — [INVARIANT] DROP_SLOT không bao giờ xóa slot có activityType = meal', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0, lat: 16.06, lng: 108.22 });
    const plan: TripSlot[] = [
      makeSlot({ slotId: 's1', placeId: 1, slotOrder: 0, activityType: 'sightseeing',
        plannedStart: '2026-05-23T08:00:00.000Z', plannedEnd: '2026-05-23T09:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 1, slotOrder: 1, activityType: 'meal',
        plannedStart: '2026-05-23T12:00:00.000Z', plannedEnd: '2026-05-23T13:00:00.000Z' }),
    ];
    const ctx = makeOperatorCtx(plan, [place]);
    const drops = operators.dropSlot(plan, ctx);

    // Không có kết quả nào chứa slotId của meal slot
    for (const d of drops) {
      expect(d.affectedSlotIds).not.toContain('s2');
      for (const slot of d.newPlan) {
        if (slot.slotId === 's2') {
          // Nếu meal slot còn trong plan mới — đây là expected (không bị drop)
        }
      }
      // newPlan sau drop không được là plan không có s2 (meal slot vẫn phải còn)
      const hasMeal = d.newPlan.some(s => s.slotId === 's2');
      expect(hasMeal, 'meal slot phải còn trong newPlan sau DROP_SLOT').toBe(true);
    }
  });

  it('B13.2 — [INVARIANT] DROP_SLOT không xóa locked slot', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const plan: TripSlot[] = [
      makeSlot({ slotId: 's1', placeId: 1, slotOrder: 0,
        plannedStart: '2026-05-23T08:00:00.000Z', plannedEnd: '2026-05-23T09:00:00.000Z' }),
      { ...makeSlot({ slotId: 's2', placeId: 1, slotOrder: 1,
        plannedStart: '2026-05-23T10:00:00.000Z', plannedEnd: '2026-05-23T11:00:00.000Z' }),
        isLocked: true } as any,
    ];
    const ctx = makeOperatorCtx(plan, [place]);
    const drops = operators.dropSlot(plan, ctx);

    for (const d of drops) {
      expect(d.affectedSlotIds).not.toContain('s2');
    }
  });

  it('B13.3 — [INVARIANT] SWAP_ORDER không hoán đổi slots từ 2 ngày khác nhau', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const plan: TripSlot[] = [
      makeSlot({ slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-05-23T08:00:00.000Z', plannedEnd: '2026-05-23T09:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 1, dayIndex: 1, slotOrder: 0,
        plannedStart: '2026-05-24T08:00:00.000Z', plannedEnd: '2026-05-24T09:00:00.000Z' }),
    ];
    const ctx = makeOperatorCtx(plan, [place]);
    const swaps = operators.swapOrder(plan, ctx);

    // Nếu có kết quả swap nào, newPlan không được là đảo ngược thứ tự s1 <-> s2
    // (vì chúng ở 2 ngày khác nhau)
    for (const swap of swaps) {
      const newS1 = swap.newPlan.find(s => s.slotId === 's1');
      const newS2 = swap.newPlan.find(s => s.slotId === 's2');
      // Nếu s1 và s2 đều còn trong newPlan: dayIndex của chúng phải giữ nguyên
      if (newS1 && newS2) {
        expect(newS1.dayIndex).toBe(0);
        expect(newS2.dayIndex).toBe(1);
      }
    }
  });

  it('B13.4 — [INVARIANT] DROP_SLOT không xóa completed/skipped slot', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    const plan: TripSlot[] = [
      { ...makeSlot({ slotId: 's-completed', placeId: 1, slotOrder: 0 }), status: 'completed' as const },
      makeSlot({ slotId: 's-planned', placeId: 1, slotOrder: 1,
        plannedStart: '2026-05-23T10:00:00.000Z', plannedEnd: '2026-05-23T11:00:00.000Z' }),
    ];
    const ctx = makeOperatorCtx(plan, [place]);
    const drops = operators.dropSlot(plan, ctx);

    for (const d of drops) {
      expect(d.affectedSlotIds).not.toContain('s-completed');
    }
  });

  it('B13.5 — generateAll() chứa ít nhất 1 DROP_SLOT nếu plan có sightseeing slot', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0, lat: 16.06, lng: 108.22 });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T08:00:00.000Z', plannedEnd: '2026-05-23T09:00:00.000Z' }),
    ];
    const ctx = makeOperatorCtx(plan, [place]);
    const results = operators.generateAll(plan, ctx);

    const hasDrop = results.some(r => r.operator === 'DROP_SLOT');
    expect(hasDrop).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch 14 — StateEvolver: travel time, fatigue model, rain outdoor
// ---------------------------------------------------------------------------

describe('Batch 14 — StateEvolver: travel time & fatigue model', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
  });

  it('B14.1 — estimateTravelTime cùng điểm → 0', () => {
    expect(evolver.estimateTravelTime(16.0, 108.0, 16.0, 108.0)).toBe(0);
  });

  it('B14.2 — estimateTravelTime (16,108) → (16.1,108) ≈ 37.3 phút (Haversine * 1.4 / 25km/h)', () => {
    const t = evolver.estimateTravelTime(16, 108, 16.1, 108);
    // 0.1 độ lat ≈ 11.1 km, road factor 1.4, speed 25 km/h → 11.1 * 1.4 * 60 / 25 ≈ 37.3
    expect(t).toBeGreaterThan(35);
    expect(t).toBeLessThan(40);
  });

  it('B14.3 — evolve() meal slot: fatigueDelta = terrainLoad - 0.12 (travel=0, no rain)', () => {
    const place = makePlace({ terrainEasiness: 0.8, indoorOutdoor: 'indoor', avgVisitDurationMin: 60 });
    const s = makeState({ fatigue: 0.5 });
    const slot = makeSlot({ activityType: 'meal', placeId: place.placeId, estimatedCost: 0 });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 0, place,
      weatherAtSlot: { rainMmPerH: 0 }, user: DEFAULT_USER,
    });
    // terrainLoad = (1 - 0.8) * (60/60) = 0.2
    // fatigueDelta = 0.10 * 0.2 - 0.12 = 0.02 - 0.12 = -0.10
    // next.fatigue = max(0, min(1, 0.5 - 0.10)) = 0.40
    expect(next.fatigue).toBeCloseTo(0.40, 5);
  });

  it('B14.4 — evolve() rest slot: fatigueDelta = terrainLoad - 0.20', () => {
    const place = makePlace({ terrainEasiness: 1.0, indoorOutdoor: 'indoor', avgVisitDurationMin: 60 });
    const s = makeState({ fatigue: 0.5 });
    const slot = makeSlot({ activityType: 'rest', placeId: place.placeId, estimatedCost: 0 });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 0, place,
      weatherAtSlot: { rainMmPerH: 0 }, user: DEFAULT_USER,
    });
    // terrainLoad = (1 - 1.0) * 1 = 0
    // fatigueDelta = -0.20
    // next.fatigue = max(0, min(1, 0.5 - 0.20)) = 0.30
    expect(next.fatigue).toBeCloseTo(0.30, 5);
  });

  it('B14.5 — evolve() outdoor trong mưa (rain >= 5): weatherLoad = 0.15', () => {
    const place = makePlace({ terrainEasiness: 1.0, indoorOutdoor: 'outdoor', avgVisitDurationMin: 60 });
    const s = makeState({ fatigue: 0.3 });
    const slot = makeSlot({ activityType: 'sightseeing', placeId: place.placeId, estimatedCost: 0 });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 0, place,
      weatherAtSlot: { rainMmPerH: 10 },   // mưa
      user: DEFAULT_USER,
    });
    // terrainLoad = 0 (terrainEasiness=1.0)
    // weatherLoad = 0.15 (isRainyOutdoor=true)
    // rainTransitLoad = 0 (travelTimeMin=0)
    // fatigueDelta = 0 + 0 + 0.15 = 0.15
    // next.fatigue = min(1, max(0, 0.3 + 0.15)) = 0.45
    expect(next.fatigue).toBeCloseTo(0.45, 5);
  });

  it('B14.6 — evolve() indoor trong mưa: không có weatherLoad (chỉ rainTransitLoad)', () => {
    const place = makePlace({ terrainEasiness: 1.0, indoorOutdoor: 'indoor', avgVisitDurationMin: 60 });
    const s = makeState({ fatigue: 0.3 });
    const slot = makeSlot({ activityType: 'sightseeing', placeId: place.placeId, estimatedCost: 0 });
    const next = evolver.evolve(s, slot, {
      travelTimeMin: 60,  // travel 60 phút trong mưa
      place,
      weatherAtSlot: { rainMmPerH: 10 },
      user: DEFAULT_USER,
    });
    // travelLoad = 60/120 = 0.5 → 0.05 * 0.5 = 0.025
    // terrainLoad = 0
    // weatherLoad = 0 (indoor → isRainyOutdoor = false)
    // rainTransitLoad = 0.04 * (60/60) = 0.04 (rain transit even for indoor destination)
    // fatigueDelta = 0.025 + 0 + 0 + 0.04 = 0.065
    // next.fatigue = 0.3 + 0.065 = 0.365
    expect(next.fatigue).toBeCloseTo(0.365, 5);
  });

  it('B14.7 — [INVARIANT] TSP_REORDER đặt slot gần start trước slot xa', () => {
    // Start ở (16, 108). Slot A ở (16.5, 108) = ~55 km xa, Slot B ở (16.01, 108) = 1.11 km gần.
    // Thứ tự ban đầu [A, B] — không tối ưu. TSP_REORDER phải đề xuất [B, A].
    // NOTE: A phải đủ gần để sau khi reorder [B,A] + travel ~183 min từ B→A,
    // slot A vẫn kết thúc trước 22:30 VN (trip chỉ có day 0).
    const evolver2 = new StateEvolver();
    const ops = new MutationOperators(evolver2);
    const placeA = makePlace({ placeId: 1, lat: 16.5, lng: 108.0, avgVisitDurationMin: 60, minPrice: 0 });
    const placeB = makePlace({ placeId: 2, lat: 16.01, lng: 108.0, avgVisitDurationMin: 60, minPrice: 0 });
    const plan: TripSlot[] = [
      makeSlot({ slotId: 'sA', placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-05-23T08:00:00.000Z', plannedEnd: '2026-05-23T09:00:00.000Z' }),
      makeSlot({ slotId: 'sB', placeId: 2, dayIndex: 0, slotOrder: 1,
        plannedStart: '2026-05-23T10:00:00.000Z', plannedEnd: '2026-05-23T11:00:00.000Z' }),
    ];
    const ctx: any = {
      remainingSlots: plan,
      initialState: makeState({ timeRemainingMin: 1200, budgetRemaining: 5_000_000, currentLat: 16.0, currentLng: 108.0 }),
      candidatePool: [placeA, placeB],
      placeMap: new Map([[1, placeA], [2, placeB]]),
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };

    clearSetFeasibilityCache();
    const results = ops.tspReorder(plan, ctx);

    // TSP_REORDER phải có ít nhất 1 kết quả
    expect(results.length).toBeGreaterThan(0);

    // Kết quả đầu tiên phải đặt placeB (gần) trước placeA (xa)
    const first = results[0]!;
    expect(first.newPlan[0]!.placeId).toBe(2);  // B trước
    expect(first.newPlan[1]!.placeId).toBe(1);  // A sau
  });
});

// ---------------------------------------------------------------------------
// Batch 15 — CandidatePruner.canPrune: deterministic prune decisions
// ---------------------------------------------------------------------------

describe('Batch 15 — CandidatePruner: canPrune logic', () => {
  it('B15.1 — canPrune(DROP_SLOT) → false (drop always relaxes constraints)', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = { operator: 'DROP_SLOT' as const, slotIndex: 0 };
    expect(canPrune(mutation as any, [], [])).toBe(false);
  });

  it('B15.2 — canPrune(TSP_REORDER) → false (reorder không thay đổi tổng duration)', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = { operator: 'TSP_REORDER' as const };
    expect(canPrune(mutation as any, [], [])).toBe(false);
  });

  it('B15.3 — canPrune(TIME_SHIFT +delta) → true khi efs+delta > lfs (overflow guaranteed)', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = { operator: 'TIME_SHIFT' as const, slotIndex: 0, deltaMin: 100 };
    // efs=500, lfs=550 → efs+100=600 > 550 → must prune
    const windows: any[] = [{ efs: 500, lfs: 550, slack: 50, budgetFloor: 100_000, fatigueCeiling: 0.5 }];
    expect(canPrune(mutation as any, [], windows)).toBe(true);
  });

  it('B15.4 — canPrune(TIME_SHIFT +delta) → false khi còn đủ slack', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = { operator: 'TIME_SHIFT' as const, slotIndex: 0, deltaMin: 30 };
    // efs=500, lfs=600 → efs+30=530 <= 600 → do not prune
    const windows: any[] = [{ efs: 500, lfs: 600, slack: 100, budgetFloor: 100_000, fatigueCeiling: 0.5 }];
    expect(canPrune(mutation as any, [], windows)).toBe(false);
  });

  it('B15.5 — canPrune(INSERT_ALT) → true khi slack < newSlotDuration', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = {
      operator: 'INSERT_ALT' as const,
      insertIndex: 0,
      newSlotDuration: 90,  // cần 90 phút
      newSlotCost: 0,
    };
    const windows: any[] = [{ efs: 500, lfs: 560, slack: 60, budgetFloor: 500_000, fatigueCeiling: 0.3 }];
    // slack = 60 < 90 → prune
    expect(canPrune(mutation as any, [], windows)).toBe(true);
  });

  it('B15.6 — canPrune(INSERT_ALT) → true khi budget không đủ (budgetFloor - cost < 0)', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = {
      operator: 'INSERT_ALT' as const,
      insertIndex: 0,
      newSlotDuration: 60,
      newSlotCost: 200_000,
    };
    // budgetFloor = 100_000, cost = 200_000 → 100_000 - 200_000 = -100_000 < 0 → prune
    const windows: any[] = [{ efs: 0, lfs: 1000, slack: 1000, budgetFloor: 100_000, fatigueCeiling: 0.3 }];
    expect(canPrune(mutation as any, [], windows)).toBe(true);
  });

  it('B15.7 — canPrune(INSERT_ALT) → false khi đủ slack và budget', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = {
      operator: 'INSERT_ALT' as const,
      insertIndex: 0,
      newSlotDuration: 60,
      newSlotCost: 50_000,
    };
    const windows: any[] = [{ efs: 0, lfs: 1000, slack: 500, budgetFloor: 500_000, fatigueCeiling: 0.3 }];
    expect(canPrune(mutation as any, [], windows)).toBe(false);
  });

  it('B15.8 — canPrune với window null/undefined → false (conservative)', async () => {
    const { canPrune } = await import('../src/replanner/CandidatePruner');
    const mutation = { operator: 'TIME_SHIFT' as const, slotIndex: 5, deltaMin: 999 };
    // window index 5 không tồn tại (mảng rỗng)
    expect(canPrune(mutation as any, [], [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batch 16 — ConstraintPropagation.propagateConstraints
// ---------------------------------------------------------------------------

describe('Batch 16 — ConstraintPropagation: propagateConstraints', () => {
  it('B16.1 — propagateConstraints([]) → []', async () => {
    const { propagateConstraints } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const result = propagateConstraints([], makeState(), evolver, new Map());
    expect(result).toEqual([]);
  });

  it('B16.2 — 1 slot: efs[0] = morningStartOf(0) = 480 khi capturedAt = 08:00 VN', async () => {
    const { propagateConstraints, morningStartOf } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, lat: 16.06, lng: 108.22 });
    const plan = [makeSlot({ placeId: 1, dayIndex: 0 })];
    const initial = makeState({
      dayIndex: 0,
      capturedAt: '2026-05-23T01:00:00.000Z',  // UTC 01:00 = VN 08:00
    });
    const result = propagateConstraints(plan, initial, evolver, new Map([[1, place]]));

    expect(result).toHaveLength(1);
    expect(result[0]!.efs).toBe(morningStartOf(0));  // 480
  });

  it('B16.3 — 1 slot, avgVisit=60: lfs = nightLimit(0) - 60 = 1290', async () => {
    const { propagateConstraints, nightLimitOf } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const plan = [makeSlot({ placeId: 1, dayIndex: 0 })];
    const initial = makeState({ dayIndex: 0, capturedAt: '2026-05-23T01:00:00.000Z' });
    const result = propagateConstraints(plan, initial, evolver, new Map([[1, place]]));

    expect(result[0]!.lfs).toBe(nightLimitOf(0) - 60);  // 1350 - 60 = 1290
  });

  it('B16.4 — slack = lfs - efs cho mỗi window', async () => {
    const { propagateConstraints } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const places = [1, 2].map(i => makePlace({ placeId: i, avgVisitDurationMin: 60, lat: 16.06, lng: 108.22 }));
    const plan = [0, 1].map(i => makeSlot({ placeId: i + 1, dayIndex: 0, slotOrder: i }));
    const initial = makeState({ dayIndex: 0, capturedAt: '2026-05-23T01:00:00.000Z' });
    const placeMap = new Map(places.map(p => [p.placeId, p]));
    const result = propagateConstraints(plan, initial, evolver, placeMap);

    for (const w of result) {
      expect(w.slack).toBeCloseTo(w.lfs - w.efs, 5);
    }
  });

  it('B16.5 — budgetFloor giảm dần theo estimatedCost của từng slot', async () => {
    const { propagateConstraints } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 0, estimatedCost: 50_000 }),
      makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 1, estimatedCost: 30_000 }),
    ];
    const initial = makeState({ budgetRemaining: 500_000, capturedAt: '2026-05-23T01:00:00.000Z' });
    const result = propagateConstraints(plan, initial, evolver, new Map([[1, place]]));

    expect(result[0]!.budgetFloor).toBe(500_000 - 50_000);          // 450_000
    expect(result[1]!.budgetFloor).toBe(500_000 - 50_000 - 30_000); // 420_000
  });

  it('B16.6 — [INVARIANT] efs[i] <= lfs[i] (window không âm) cho plan khả thi', async () => {
    const { propagateConstraints } = await import('../src/replanner/ConstraintPropagation');
    const evolver = new StateEvolver();
    const places = [1, 2, 3].map(i => makePlace({ placeId: i, avgVisitDurationMin: 60, lat: 16.06 + i * 0.01, lng: 108.22 }));
    const plan = [0, 1, 2].map(i => makeSlot({ placeId: i + 1, dayIndex: 0, slotOrder: i }));
    const initial = makeState({ dayIndex: 0, capturedAt: '2026-05-23T01:00:00.000Z' });
    const placeMap = new Map(places.map(p => [p.placeId, p]));
    const result = propagateConstraints(plan, initial, evolver, placeMap);

    for (let i = 0; i < result.length; i++) {
      expect(result[i]!.efs, `window[${i}].efs <= lfs`).toBeLessThanOrEqual(result[i]!.lfs);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 17 — repairSuffix: trường estimatedCost
// ---------------------------------------------------------------------------

describe('Batch 17 — repairSuffix: trường estimatedCost', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeRepairCtx(pool: ReturnType<typeof makePlace>[]): ReplanContext {
    return makeCtx({
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
      initialState: makeState({ capturedAt: '2026-05-23T01:00:00.000Z' }),
    });
  }

  it('B17.1 — slot.estimatedCost=0: repairSuffix thay bằng place.minPrice (hành vi thiết kế)', () => {
    // estimatedCost=0 được coi là "chưa định giá" → repairSuffix cập nhật bằng place.minPrice.
    // Đây là hành vi có chủ ý, đã được tài liệu hoá ở B10.4.
    const place = makePlace({ placeId: 1, minPrice: 100_000, avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: 1,
      estimatedCost: 0,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeRepairCtx([place]);
    const repaired = ops.repairSuffix([slot], 0, ctx);
    expect(repaired).not.toBeNull();
    // estimatedCost=0 → dùng place.minPrice=100_000 (thiết kế: 0 nghĩa là "chưa có giá")
    expect(repaired![0]!.estimatedCost).toBe(100_000);
  });

  it('B17.2 — slot.estimatedCost=50000 > 0: repairSuffix giữ nguyên giá trị gốc', () => {
    const place = makePlace({ placeId: 1, minPrice: 100_000, avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: 1,
      estimatedCost: 50_000,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeRepairCtx([place]);
    const repaired = ops.repairSuffix([slot], 0, ctx);
    expect(repaired).not.toBeNull();
    expect(repaired![0]!.estimatedCost).toBe(50_000);
  });

  it('B17.3 — slot.estimatedCost=0 và place.minPrice=0: kết quả đúng ngẫu nhiên', () => {
    const freePlace = makePlace({ placeId: 1, minPrice: 0, avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: 1,
      estimatedCost: 0,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeRepairCtx([freePlace]);
    const repaired = ops.repairSuffix([slot], 0, ctx);
    expect(repaired).not.toBeNull();
    expect(repaired![0]!.estimatedCost).toBe(0);
  });

  it('B17.4 — slot.estimatedCost=0 và place.minPrice=undefined: kết quả 0', () => {
    const freePlace = makePlace({ placeId: 1, minPrice: undefined, avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: 1,
      estimatedCost: 0,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeRepairCtx([freePlace]);
    const repaired = ops.repairSuffix([slot], 0, ctx);
    expect(repaired).not.toBeNull();
    expect(repaired![0]!.estimatedCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 18 — computeTrajectory vs isPlanFeasible: xử lý slot completed/skipped
// ---------------------------------------------------------------------------

describe('Batch 18 — computeTrajectory vs isPlanFeasible: xử lý slot completed/skipped', () => {
  const evolver = new StateEvolver();

  it('B18.1 — isPlanFeasible bỏ qua slot completed, không trừ budget/time của nó', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    // Slot đã hoàn thành với chi phí lớn hơn budget còn lại
    const completedSlot = makeSlot({
      placeId: 1, status: 'completed', estimatedCost: 999_000,
      plannedStart: '2026-05-23T01:00:00.000Z',
      plannedEnd:   '2026-05-23T02:00:00.000Z',
    });
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      // Budget chỉ còn 500_000 — nhỏ hơn estimatedCost nếu bị tính lại
      initialState: makeState({ budgetRemaining: 500_000 }),
    });
    // isPlanFeasible phải bỏ qua slot completed → không trừ 999_000 → vẫn feasible
    const feasible = evolver.isPlanFeasible([completedSlot], ctx.initialState, ctx);
    expect(feasible).toBe(true);
  });

  it('B18.2 — computeTrajectory KHÔNG bỏ qua slot completed, dẫn tới budgetRemaining khác', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const completedSlot = makeSlot({
      placeId: 1, status: 'completed', estimatedCost: 200_000,
      plannedStart: '2026-05-23T01:00:00.000Z',
      plannedEnd:   '2026-05-23T02:00:00.000Z',
    });
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      initialState: makeState({ budgetRemaining: 1_000_000 }),
    });
    const states = evolver.computeTrajectory([completedSlot], ctx.initialState, ctx);
    // computeTrajectory tính slot completed → trừ 200_000 khỏi budget
    // (khác với isPlanFeasible bỏ qua slot đó)
    const finalState = states[states.length - 1]!;
    expect(finalState.budgetRemaining).toBe(800_000);  // 1_000_000 - 200_000
  });

  it('B18.3 — bất nhất quán: isPlanFeasible=true nhưng computeTrajectory cho thấy plan không feasible', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    // Slot completed tốn 800_000 — nếu bị tính lại thì budget âm
    const completedSlot = makeSlot({
      placeId: 1, status: 'completed', estimatedCost: 800_000,
      plannedStart: '2026-05-23T01:00:00.000Z',
      plannedEnd:   '2026-05-23T02:00:00.000Z',
    });
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      initialState: makeState({ budgetRemaining: 500_000 }),
    });

    // isPlanFeasible bỏ qua → feasible
    const isPF = evolver.isPlanFeasible([completedSlot], ctx.initialState, ctx);
    expect(isPF).toBe(true);

    // computeTrajectory tính lại → budget = 500_000 - 800_000 = -300_000
    const states = evolver.computeTrajectory([completedSlot], ctx.initialState, ctx);
    const finalBudget = states[states.length - 1]!.budgetRemaining;
    expect(finalBudget).toBe(-300_000);

    // Bất nhất quán: isPlanFeasible trả về true nhưng trajectory cuối có budget âm
    const trajectoryFeasible = evolver.isFeasible(states[states.length - 1]!);
    expect(trajectoryFeasible).toBe(false);
    // isPF=true vs trajectoryFeasible=false → đây là bất nhất quán giữa hai hàm
    expect(isPF).not.toBe(trajectoryFeasible);
  });
});

// ---------------------------------------------------------------------------
// Batch 19 — evolve(): kiểm tra từng trường output
// ---------------------------------------------------------------------------

describe('Batch 19 — evolve(): kiểm tra từng trường output', () => {
  const evolver = new StateEvolver();
  const defaultCtx = {
    travelTimeMin: 0,
    place: makePlace({ placeId: 1, lat: 16.10, lng: 108.30, avgVisitDurationMin: 60 }),
    weatherAtSlot: { rainMmPerH: 0 },
    user: { preferenceVector: new Array(10).fill(0.1), pace: 0.5, mobilityRestrictions: [] },
    simulatedAt: '2026-05-23T02:00:00.000Z',
  } as const;

  it('B19.1 — slotOrder tăng đúng 1 so với state trước', () => {
    const s = makeState({ slotOrder: 4 });
    const next = evolver.evolve(s, makeSlot(), defaultCtx);
    expect(next.slotOrder).toBe(5);
  });

  it('B19.2 — dayIndex KHÔNG thay đổi (copyied từ s.dayIndex)', () => {
    const s = makeState({ dayIndex: 2 });
    const next = evolver.evolve(s, makeSlot({ dayIndex: 2 }), defaultCtx);
    expect(next.dayIndex).toBe(2);
  });

  it('B19.3 — currentLat/Lng được cập nhật từ place, không từ state trước', () => {
    const place = makePlace({ lat: 16.10, lng: 108.30 });
    const s = makeState({ currentLat: 16.00, currentLng: 108.00 });
    const next = evolver.evolve(s, makeSlot(), { ...defaultCtx, place });
    expect(next.currentLat).toBe(16.10);
    expect(next.currentLng).toBe(108.30);
  });

  it('B19.4 — capturedAt được lấy từ simulatedAt (không phải new Date())', () => {
    const slot = makeSlot({ plannedStart: '2026-05-23T05:00:00.000Z' });
    const s = makeState();
    const next = evolver.evolve(s, slot, { ...defaultCtx, simulatedAt: '2026-05-23T05:00:00.000Z' });
    expect(next.capturedAt).toBe('2026-05-23T05:00:00.000Z');
  });

  it('B19.5 — budgetRemaining = s.budgetRemaining - actualCost khi actualCost được cung cấp', () => {
    const s = makeState({ budgetRemaining: 1_000_000 });
    const slot = makeSlot({ estimatedCost: 200_000 });
    const next = evolver.evolve(s, slot, { ...defaultCtx, actualCost: 150_000 });
    // actualCost ưu tiên hơn estimatedCost
    expect(next.budgetRemaining).toBe(850_000);
  });

  it('B19.6 — timeRemainingMin giảm đúng = travelTimeMin + duration', () => {
    const s = makeState({ timeRemainingMin: 600 });
    const place = makePlace({ avgVisitDurationMin: 90 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 30,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
      simulatedAt: '2026-05-23T02:00:00.000Z',
    });
    // 600 - (30 + 90) = 480
    expect(next.timeRemainingMin).toBe(480);
  });

  it('B19.7 — timeRemainingMin có thể âm (overflow không bị che khuất)', () => {
    const s = makeState({ timeRemainingMin: 50 });
    const place = makePlace({ avgVisitDurationMin: 90 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 30,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // 50 - (30 + 90) = -70 — phải âm để isFeasible() phát hiện
    expect(next.timeRemainingMin).toBe(-70);
    expect(evolver.isFeasible(next)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batch 20 — buildEvolveContext: weather lookup và travelTime edge cases
// ---------------------------------------------------------------------------

describe('Batch 20 — buildEvolveContext + weather + travelTime', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  it('B20.1 — weatherForecast[slot.dayIndex] được dùng khi dayIndex khớp', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor' });
    const slot = makeSlot({ placeId: 1, dayIndex: 2,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    // dayIndex=2 → forecast[2] có mưa lớn
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      weatherForecast: [
        { rainMmPerH: 0 },   // day 0
        { rainMmPerH: 0 },   // day 1
        { rainMmPerH: 20 },  // day 2 — mưa to
      ],
      defaultWeather: { rainMmPerH: 0 },
      initialState: makeState({ fatigue: 0, currentLat: 16.06, currentLng: 108.22 }),
    });
    const states = evolver.computeTrajectory([slot], ctx.initialState, ctx);
    // Mưa + outdoor → weatherLoad=0.15 → fatigue tăng thêm 0.15
    expect(states[1]!.fatigue).toBeGreaterThan(0.14);
  });

  it('B20.2 — fallback về defaultWeather khi dayIndex không có trong weatherForecast', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor' });
    const slot = makeSlot({ placeId: 1, dayIndex: 5,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    // forecast chỉ có day 0–1, dayIndex=5 sẽ fallback về defaultWeather (mưa=0)
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      weatherForecast: [{ rainMmPerH: 0 }, { rainMmPerH: 0 }],
      defaultWeather: { rainMmPerH: 0 },  // không mưa
      initialState: makeState({ fatigue: 0 }),
    });
    const states = evolver.computeTrajectory([slot], ctx.initialState, ctx);
    // Không mưa → weatherLoad=0 → fatigue thấp (chỉ từ terrainLoad và travelLoad)
    expect(states[1]!.fatigue).toBeLessThan(0.1);
  });

  it('B20.3 — travelTimeMin=0 khi currentLat/Lng là null (không có vị trí hiện tại)', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const slot = makeSlot({ placeId: 1,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      // Không có vị trí → currentLat/Lng = null
      initialState: makeState({ currentLat: null as any, currentLng: null as any, fatigue: 0, timeRemainingMin: 600 }),
    });
    const states = evolver.computeTrajectory([slot], ctx.initialState, ctx);
    // Không có toạ độ → travelTimeMin=0 → timeRemainingMin giảm đúng 60 (duration)
    expect(states[1]!.timeRemainingMin).toBe(540);  // 600 - (0 + 60)
  });

  it('B20.4 — estimateTravelTime trả về 0 khi hai điểm trùng nhau', () => {
    const travelTime = evolver.estimateTravelTime(16.06, 108.22, 16.06, 108.22);
    expect(travelTime).toBe(0);
  });

  it('B20.5 — estimateTravelTime > 0 khi hai điểm khác nhau', () => {
    // Từ Hội An đến Đà Nẵng ~30 km → khoảng 80-90 phút ở 25 km/h
    const travelTime = evolver.estimateTravelTime(15.88, 108.33, 16.06, 108.22);
    expect(travelTime).toBeGreaterThan(60);
    expect(travelTime).toBeLessThan(150);
  });
});

// ---------------------------------------------------------------------------
// Batch 21 — evolve(): moodProxy và fatiguePenalty formula
// ---------------------------------------------------------------------------

describe('Batch 21 — evolve(): moodProxy và fatiguePenalty', () => {
  const evolver = new StateEvolver();

  it('B21.1 — moodProxy bị clamp tại 1.0 khi interestMatch rất cao', () => {
    // preferenceVector = [1, 0, ...] và place có tag 1 → interestMatch = 1
    // moodDelta = 0.08 * 1 - 0 - 0 = 0.08 → moodProxy = clamp(0.99 + 0.08, 0, 1) = 1.0
    const place = makePlace({ tags: [{ tagId: 1, name: 't', displayName: 'T' }], avgVisitDurationMin: 60 });
    const s = makeState({ moodProxy: 0.99, fatigue: 0.0 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], pace: 0.5, mobilityRestrictions: [] },
      simulatedAt: '2026-05-23T02:00:00.000Z',
    });
    expect(next.moodProxy).toBe(1.0);
  });

  it('B21.2 — moodProxy bị clamp tại 0 khi fatiguePenalty rất lớn', () => {
    // fatigue = 0.95, fatiguePenalty = (0.95 - 0.7) * 0.3 = 0.075
    // interestMatch = 0, moodDelta = -0.075 → moodProxy = clamp(0.0 - 0.075, 0, 1) = 0
    const place = makePlace({ tags: [], avgVisitDurationMin: 60 });
    const s = makeState({ moodProxy: 0.0, fatigue: 0.95 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
      simulatedAt: '2026-05-23T02:00:00.000Z',
    });
    expect(next.moodProxy).toBe(0);
  });

  it('B21.3 — fatiguePenalty = 0 khi fatigue sau evolve() đúng bằng 0.7 (threshold)', () => {
    // Dùng terrainEasiness=1.0 để fatigueDelta=0 → fatigue sau evolve vẫn là 0.7
    // 0.7 > 0.7 là false → fatiguePenalty = 0 → moodProxy không thay đổi
    const place = makePlace({ tags: [], avgVisitDurationMin: 60, terrainEasiness: 1.0 });
    const s = makeState({ moodProxy: 0.5, fatigue: 0.7 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
      simulatedAt: '2026-05-23T02:00:00.000Z',
    });
    // fatigueDelta = 0 → new fatigue = 0.7, penalty = 0, moodDelta = 0
    expect(next.fatigue).toBeCloseTo(0.7, 5);
    expect(next.moodProxy).toBeCloseTo(0.5, 5);
  });

  it('B21.4 — fatiguePenalty > 0 khi fatigue vượt 0.7 chỉ một chút', () => {
    // Đặt fatigue khởi đầu cao để sau evolve() fatigue > 0.7
    const place = makePlace({ avgVisitDurationMin: 60, terrainEasiness: 0.0 });
    // terrainLoad = (1-0) * (60/60) = 1.0; fatigueDelta = 0 + 0.10*1.0 = 0.1
    // fatigue bắt đầu tại 0.65 → sau: 0.65 + 0.1 = 0.75 > 0.7 → penalty = (0.75-0.7)*0.3=0.015
    const s = makeState({ moodProxy: 0.8, fatigue: 0.65 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
      simulatedAt: '2026-05-23T02:00:00.000Z',
    });
    // moodDelta = 0 - 0.015 - 0 = -0.015 → moodProxy giảm từ 0.8
    expect(next.moodProxy).toBeCloseTo(0.785, 3);
  });

  it('B21.5 — rainTransitLoad chỉ áp dụng khi có di chuyển (travelTimeMin > 0)', () => {
    // Mưa nhưng travelTimeMin = 0 → rainTransitLoad = 0
    const s0 = makeState({ fatigue: 0.0 });
    const place = makePlace({ avgVisitDurationMin: 60, indoorOutdoor: 'indoor' });
    const noTravel = evolver.evolve(s0, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 10 },  // mưa to
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // rainTransitLoad = 0 (vì travelTimeMin=0), weatherLoad = 0 (indoor)
    // fatigueDelta = 0 + 0.10*(1-0.8)*(60/60) = 0.02
    expect(noTravel.fatigue).toBeCloseTo(0.02, 5);

    // Cùng điều kiện nhưng travelTimeMin = 60 → rainTransitLoad = 0.04 * (60/60) = 0.04
    const s1 = makeState({ fatigue: 0.0 });
    const withTravel = evolver.evolve(s1, makeSlot(), {
      travelTimeMin: 60,
      place,
      weatherAtSlot: { rainMmPerH: 10 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // travelLoad = 60/120 = 0.5 → 0.05*0.5 = 0.025
    // terrainLoad = (1-0.8)*(60/60) = 0.2 → 0.10*0.2 = 0.02
    // rainTransitLoad = 0.04*(60/60) = 0.04
    // fatigueDelta = 0.025 + 0.02 + 0 + 0.04 = 0.085
    expect(withTravel.fatigue).toBeCloseTo(0.085, 4);
  });

  it('B21.6 — terrainEasiness = 0 (địa hình cực khó) → terrainLoad lớn nhất', () => {
    const place = makePlace({ avgVisitDurationMin: 60, terrainEasiness: 0.0 });
    // terrainLoad = (1-0) * (60/60) = 1.0 → 0.10*1.0 = 0.10 fatigue từ địa hình
    const s = makeState({ fatigue: 0.0 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    expect(next.fatigue).toBeCloseTo(0.10, 5);
  });
});

// ---------------------------------------------------------------------------
// Batch 22 — shiftSlot: kiểm tra trường timing
// ---------------------------------------------------------------------------

describe('Batch 22 — shiftSlot: trường plannedStart/plannedEnd', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);
  const shiftSlot = (slot: ReturnType<typeof makeSlot>, minutes: number) =>
    (ops as any).shiftSlot(slot, minutes) as ReturnType<typeof makeSlot>;

  it('B22.1 — shiftSlot +30min: plannedStart tiến về trước 30 phút', () => {
    const slot = makeSlot({
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const shifted = shiftSlot(slot, 30);
    const delta = new Date(shifted.plannedStart).getTime() - new Date(slot.plannedStart).getTime();
    expect(delta).toBe(30 * 60_000);
  });

  it('B22.2 — shiftSlot -60min: plannedStart lùi về sau 60 phút', () => {
    const slot = makeSlot({
      plannedStart: '2026-05-23T03:00:00.000Z',
      plannedEnd:   '2026-05-23T04:00:00.000Z',
    });
    const shifted = shiftSlot(slot, -60);
    const delta = new Date(shifted.plannedStart).getTime() - new Date(slot.plannedStart).getTime();
    expect(delta).toBe(-60 * 60_000);
  });

  it('B22.3 — shiftSlot bảo toàn duration (plannedEnd - plannedStart không đổi)', () => {
    const slot = makeSlot({
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:30:00.000Z',
    });
    const originalDuration = new Date(slot.plannedEnd).getTime() - new Date(slot.plannedStart).getTime();
    const shifted = shiftSlot(slot, 45);
    const newDuration = new Date(shifted.plannedEnd).getTime() - new Date(shifted.plannedStart).getTime();
    expect(newDuration).toBe(originalDuration);
  });

  it('B22.4 — shiftSlot với date không hợp lệ: trả về nguyên bản, không crash', () => {
    const slot = makeSlot({ plannedStart: 'INVALID_DATE', plannedEnd: 'INVALID_DATE' });
    const shifted = shiftSlot(slot, 30);
    expect(shifted.plannedStart).toBe('INVALID_DATE');
    expect(shifted.plannedEnd).toBe('INVALID_DATE');
  });

  it('B22.5 — shiftSlot không thay đổi các trường khác (placeId, status, cost...)', () => {
    const slot = makeSlot({
      placeId: 42, status: 'planned', estimatedCost: 75_000,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const shifted = shiftSlot(slot, 30);
    expect(shifted.placeId).toBe(42);
    expect(shifted.status).toBe('planned');
    expect(shifted.estimatedCost).toBe(75_000);
  });
});

// ---------------------------------------------------------------------------
// Batch 23 — generateAllAdaptive: budget allocation per operator
// ---------------------------------------------------------------------------

describe('Batch 23 — generateAllAdaptive: budget allocation', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeTwoSlotCtx() {
    const p1 = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, avgVisitDurationMin: 60, lat: 16.07, lng: 108.23 });
    const plan = [
      makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'slot-002', placeId: 2, dayIndex: 0, slotOrder: 1,
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2],
      placeMap: new Map([[1, p1], [2, p2]]),
      initialState: makeState({
        timeRemainingMin: 600, budgetRemaining: 1_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z',
      }),
    });
    return { plan, ctx };
  }

  it('B23.1 — budget=0 cho một operator: operator đó không sinh ra kết quả', () => {
    const { plan, ctx } = makeTwoSlotCtx();
    const allocation = new Map<OperatorName, number>([
      ['TIME_SHIFT', 0], ['SWAP_ORDER', 5], ['REPLACE_PLACE', 0],
      ['DROP_SLOT', 0], ['INSERT_ALT', 0], ['TSP_REORDER', 0],
    ]);
    const { candidates, generatedCounts } = ops.generateAllAdaptive(plan, ctx, allocation);
    expect(generatedCounts.get('TIME_SHIFT')).toBe(0);
    // chỉ SWAP_ORDER được chạy; nếu swap feasible thì candidates.length > 0
    // (không assert cụ thể vì phụ thuộc feasibility)
    expect(candidates.every(c => c.operator === 'SWAP_ORDER')).toBe(true);
  });

  it('B23.2 — tổng candidates <= GENERATE_ALL_CAP dù budget lớn', () => {
    const { plan, ctx } = makeTwoSlotCtx();
    const allocation = new Map<OperatorName, number>([
      ['TIME_SHIFT', 100], ['SWAP_ORDER', 100], ['REPLACE_PLACE', 100],
      ['DROP_SLOT', 100], ['INSERT_ALT', 100], ['TSP_REORDER', 100],
    ]);
    const { candidates } = ops.generateAllAdaptive(plan, ctx, allocation);
    expect(candidates.length).toBeLessThanOrEqual(GENERATE_ALL_CAP);
  });

  it('B23.3 — generatedCounts phản ánh số kết quả thực tế đã lấy (không phải budget)', () => {
    const { plan, ctx } = makeTwoSlotCtx();
    const allocation = new Map<OperatorName, number>([
      ['TIME_SHIFT', 2], ['SWAP_ORDER', 0], ['REPLACE_PLACE', 0],
      ['DROP_SLOT', 0], ['INSERT_ALT', 0], ['TSP_REORDER', 0],
    ]);
    const { candidates, generatedCounts } = ops.generateAllAdaptive(plan, ctx, allocation);
    // generatedCounts['TIME_SHIFT'] <= 2 (budget), và === candidates.length
    expect(generatedCounts.get('TIME_SHIFT')).toBeLessThanOrEqual(2);
    expect(generatedCounts.get('TIME_SHIFT')).toBe(candidates.filter(c => c.operator === 'TIME_SHIFT').length);
  });
});

// ---------------------------------------------------------------------------
// Batch 24 — replaceSlotPlace: kiểm tra trường cost, version, status
// ---------------------------------------------------------------------------

describe('Batch 24 — replaceSlotPlace: trường cost, version, status', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);
  const replaceSlotPlace = (slot: ReturnType<typeof makeSlot>, place: ReturnType<typeof makePlace>) =>
    (ops as any).replaceSlotPlace(slot, place) as ReturnType<typeof makeSlot>;

  it('B24.1 — cost: ưu tiên place.estimatedCost khi defined', () => {
    const place = makePlace({ estimatedCost: 80_000, minPrice: 50_000 });
    const slot = makeSlot({ estimatedCost: 30_000 });
    const replaced = replaceSlotPlace(slot, place);
    expect(replaced.estimatedCost).toBe(80_000);
  });

  it('B24.2 — cost: fallback về place.minPrice khi place.estimatedCost undefined', () => {
    const place = makePlace({ estimatedCost: undefined, minPrice: 50_000 });
    const slot = makeSlot({ estimatedCost: 30_000 });
    const replaced = replaceSlotPlace(slot, place);
    expect(replaced.estimatedCost).toBe(50_000);
  });

  it('B24.3 — cost: fallback về slot.estimatedCost khi cả estimatedCost và minPrice đều null', () => {
    const place = makePlace({ estimatedCost: undefined, minPrice: undefined });
    const slot = makeSlot({ estimatedCost: 30_000 });
    const replaced = replaceSlotPlace(slot, place);
    // place.estimatedCost ?? place.minPrice ?? slot.estimatedCost = slot.estimatedCost
    expect(replaced.estimatedCost).toBe(30_000);
  });

  it('B24.4 — cost: place.estimatedCost=0 → cost=0 (khác repairSuffix dùng > 0)', () => {
    // replaceSlotPlace dùng ?? (null-coalescing), nên 0 được giữ nguyên
    const place = makePlace({ estimatedCost: 0, minPrice: 100_000 });
    const slot = makeSlot({ estimatedCost: 30_000 });
    const replaced = replaceSlotPlace(slot, place);
    // replaceSlotPlace: place.estimatedCost=0 → cost=0 ✓ (dùng ??)
    expect(replaced.estimatedCost).toBe(0);
  });

  it('B24.5 — version tăng 1 so với slot gốc', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slot = makeSlot({ version: 3 });
    const replaced = replaceSlotPlace(slot, place);
    expect(replaced.version).toBe(4);
  });

  it('B24.6 — status luôn là planned, actualStart/End/rationale reset về null', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slot = makeSlot({ status: 'replaced', rationale: 'old reason' });
    const replaced = replaceSlotPlace(slot, place);
    expect(replaced.status).toBe('planned');
    expect(replaced.actualStart).toBeNull();
    expect(replaced.actualEnd).toBeNull();
    expect(replaced.rationale).toBeNull();
  });

  it('B24.7 — plannedEnd được tính lại từ place.avgVisitDurationMin (không dùng thời lượng slot cũ)', () => {
    const place = makePlace({ avgVisitDurationMin: 90 });
    const slot = makeSlot({
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T04:00:00.000Z',  // duration = 2h (120 min)
    });
    const replaced = replaceSlotPlace(slot, place);
    const newDuration = new Date(replaced.plannedEnd).getTime() - new Date(slot.plannedStart).getTime();
    // Phải dùng 90 min của place mới, không phải 120 min của slot cũ
    expect(newDuration).toBe(90 * 60_000);
  });

  it('B24.8 — [INCONSISTENCY] replaceSlotPlace dùng ?? còn repairSuffix dùng > 0', () => {
    // Khi place.estimatedCost=0 và minPrice>0:
    //   replaceSlotPlace: 0 ?? minPrice ?? ... = 0 (giữ nguyên)
    //   repairSuffix: 0 > 0 ? 0 : minPrice = minPrice (ghi đè)
    // Nếu replacePlace gọi replaceSlotPlace rồi repairSuffix, cost sẽ bị ghi đè thêm lần nữa.
    const place = makePlace({ placeId: 1, estimatedCost: 0, minPrice: 100_000, avgVisitDurationMin: 60 });
    const slot = makeSlot({ placeId: 1,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    // Bước 1: replaceSlotPlace → estimatedCost = 0 (đúng)
    const afterReplace = replaceSlotPlace(slot, place);
    expect(afterReplace.estimatedCost).toBe(0);

    // Bước 2: repairSuffix → estimatedCost = minPrice = 100_000 (ghi đè)
    const ctx = makeCtx({
      candidatePool: [place],
      placeMap: new Map([[1, place]]),
      initialState: makeState({ capturedAt: '2026-05-23T01:00:00.000Z' }),
    });
    const repaired = ops.repairSuffix([afterReplace], 0, ctx);
    expect(repaired).not.toBeNull();
    // repairSuffix ghi đè cost từ 0 → 100_000 → bất nhất quán với replaceSlotPlace
    expect(repaired![0]!.estimatedCost).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Batch 25 — evolve() edge cases: terrainEasiness > 1, actualDurationMin = 0
// ---------------------------------------------------------------------------

describe('Batch 25 — evolve() edge cases: terrainEasiness, actualDurationMin', () => {
  const evolver = new StateEvolver();

  it('B25.1 — terrainEasiness > 1: terrainLoad âm → fatigue GIẢM (hành vi ngoài ý muốn)', () => {
    // terrainEasiness=1.5 → terrainLoad = (1-1.5)*(60/60) = -0.5
    // fatigueDelta += 0.10*(-0.5) = -0.05 (terrain làm GIẢM fatigue — phi lý về mặt vật lý)
    const place = makePlace({ avgVisitDurationMin: 60, terrainEasiness: 1.5 });
    const s = makeState({ fatigue: 0.5 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // terrainEasiness=1.5 không được clamp → terrainLoad âm → fatigue giảm từ 0.5
    expect(next.fatigue).toBeLessThan(0.5);  // tài liệu hành vi không mong muốn
  });

  it('B25.2 — terrainEasiness âm: terrainLoad > 1 (địa hình siêu khó, phi lý)', () => {
    // terrainEasiness=-0.5 → terrainLoad = (1-(-0.5))*(60/60) = 1.5
    // fatigueDelta += 0.10*1.5 = 0.15 (rất cao)
    const place = makePlace({ avgVisitDurationMin: 60, terrainEasiness: -0.5 });
    const s = makeState({ fatigue: 0.0 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // terrainLoad = 1.5 → fatigueDelta = 0.15 → fatigue = 0.15
    expect(next.fatigue).toBeCloseTo(0.15, 5);
  });

  it('B25.3 — actualDurationMin=0: timeElapsed = travelTimeMin, không trừ thêm duration', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const s = makeState({ timeRemainingMin: 600 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 30,
      actualDurationMin: 0,  // ghi đè avgVisitDurationMin
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // timeElapsed = 30 + 0 = 30 → timeRemainingMin = 600 - 30 = 570
    expect(next.timeRemainingMin).toBe(570);
  });

  it('B25.4 — actualDurationMin ưu tiên hơn place.avgVisitDurationMin', () => {
    const place = makePlace({ avgVisitDurationMin: 120 });
    const s = makeState({ timeRemainingMin: 600 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      actualDurationMin: 45,  // override 120 → 45
      place,
      weatherAtSlot: { rainMmPerH: 0 },
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // duration = 45 (actualDurationMin), timeRemainingMin = 600 - 45 = 555
    expect(next.timeRemainingMin).toBe(555);
  });

  it('B25.5 — rain < 5 mm/h KHÔNG tính là mưa (threshold chính xác)', () => {
    const place = makePlace({ avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', terrainEasiness: 1.0 });
    const s = makeState({ fatigue: 0.0 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 60,
      place,
      weatherAtSlot: { rainMmPerH: 4.9 },  // dưới ngưỡng 5mm/h
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // isRaining = (4.9 >= 5) = false → weatherLoad = 0, rainTransitLoad = 0
    // travelLoad = 60/120 = 0.5 → fatigueDelta = 0.05*0.5 = 0.025
    expect(next.fatigue).toBeCloseTo(0.025, 5);
  });

  it('B25.6 — rain đúng 5 mm/h ĐƯỢC tính là mưa (inclusive threshold)', () => {
    const place = makePlace({ avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', terrainEasiness: 1.0 });
    const s = makeState({ fatigue: 0.0 });
    const next = evolver.evolve(s, makeSlot(), {
      travelTimeMin: 0,
      place,
      weatherAtSlot: { rainMmPerH: 5.0 },  // đúng ngưỡng
      user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] },
    });
    // isRaining = (5.0 >= 5) = true, outdoor → weatherLoad = 0.15
    // fatigueDelta = 0 + 0 + 0.15 + 0 = 0.15
    expect(next.fatigue).toBeCloseTo(0.15, 5);
  });
});

// ---------------------------------------------------------------------------
// Batch 26 — timeShift: thiếu kiểm tra slot.status (potential bug)
// ---------------------------------------------------------------------------

describe('Batch 26 — timeShift: hành vi với slot completed/skipped', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeShiftCtx(slot: ReturnType<typeof makeSlot>) {
    const place = makePlace({ placeId: slot.placeId, avgVisitDurationMin: 60, openingHours: [] });
    return makeCtx({
      candidatePool: [place],
      placeMap: new Map([[place.placeId, place]]),
      initialState: makeState({
        timeRemainingMin: 600, budgetRemaining: 1_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z',
      }),
    });
  }

  it('B26.1 — [INVARIANT] timeShift không được shift slot có status=planned khi isLocked=true', () => {
    // Locked slot không được shift — đây là invariant đã biết
    const slot = makeSlot({
      placeId: 1,
      status: 'planned',
      isLocked: true,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeShiftCtx(slot);
    const results = ops.timeShift([slot], ctx);
    // Slot locked → không có kết quả nào
    expect(results).toHaveLength(0);
  });

  it('B26.2 — [BUG] timeShift CÓ THỂ shift slot completed (thiếu kiểm tra status)', () => {
    // timeShift chỉ check isLocked, không check status
    // Slot completed + isLocked=false → có thể bị shift — đây là hành vi sai
    const slot = makeSlot({
      placeId: 1,
      status: 'completed',
      isLocked: false,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeShiftCtx(slot);
    const results = ops.timeShift([slot], ctx);
    // Đúng ra phải là 0 (không shift slot đã hoàn thành)
    // Nhưng hiện tại có thể > 0 vì thiếu check status
    // Test này document bug: completed slot có thể bị time-shifted
    if (results.length > 0) {
      // BUG confirmed: completed slot was shifted
      const shiftedPlan = results[0]!.newPlan;
      const originalStart = new Date(slot.plannedStart).getTime();
      const newStart = new Date(shiftedPlan[0]!.plannedStart).getTime();
      expect(Math.abs(newStart - originalStart)).toBeGreaterThan(0);  // was shifted
    }
    // Document: expected=0 (correct), actual may be > 0 (bug)
    expect(results).toHaveLength(0);  // này sẽ FAIL nếu bug tồn tại
  });

  it('B26.3 — dropSlot KHÔNG drop slot completed (status check đúng)', () => {
    // dropSlot kiểm tra status đúng → completed slot không bị drop
    const slot = makeSlot({
      placeId: 1,
      status: 'completed',
      isLocked: false,
      activityType: 'sightseeing',
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeShiftCtx(slot);
    const results = ops.dropSlot([slot], ctx);
    expect(results).toHaveLength(0);
  });

  it('B26.4 — [FIX VERIFIED] sau fix, timeShift cũng bỏ qua completed (nhất quán với dropSlot)', () => {
    const completedSlot = makeSlot({
      placeId: 1, status: 'completed', isLocked: false,
      activityType: 'sightseeing',
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeShiftCtx(completedSlot);
    const dropResults = ops.dropSlot([completedSlot], ctx);
    const shiftResults = ops.timeShift([completedSlot], ctx);

    // Sau fix: cả hai đều trả về 0 kết quả cho completed slot
    expect(dropResults).toHaveLength(0);
    expect(shiftResults).toHaveLength(0);
  });

  it('B26.5 — timeShift bỏ qua skipped slot (sau fix)', () => {
    const skippedSlot = makeSlot({
      placeId: 1, status: 'skipped', isLocked: false,
      plannedStart: '2026-05-23T02:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });
    const ctx = makeShiftCtx(skippedSlot);
    const results = ops.timeShift([skippedSlot], ctx);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 27 — swapOrder & tspReorder: trường stateTrajectory và resumeIndex
// ---------------------------------------------------------------------------

describe('Batch 27 — swapOrder & tspReorder: trường stateTrajectory và resumeIndex', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeTwoDayCtx() {
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    const p3 = makePlace({ placeId: 3, lat: 16.08, lng: 108.24, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, dayIndex: 0, slotOrder: 1,
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
      makeSlot({ slotId: 's3', placeId: 3, dayIndex: 1, slotOrder: 0,
        plannedStart: '2026-05-24T02:00:00.000Z', plannedEnd: '2026-05-24T03:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2, p3],
      placeMap: new Map([[1, p1], [2, p2], [3, p3]]),
      initialState: makeState({
        timeRemainingMin: 1200, budgetRemaining: 2_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z',
      }),
    });
    return { plan, ctx };
  }

  it('B27.1 — swapOrder không hoán đổi slots từ 2 ngày khác nhau (s2 và s3)', () => {
    const { plan, ctx } = makeTwoDayCtx();
    const results = ops.swapOrder(plan, ctx);
    for (const r of results) {
      // Kiểm tra: không có kết quả nào swap s2 (day0) với s3 (day1)
      const swappedPlan = r.newPlan;
      const newS2 = swappedPlan.find(s => s.slotId === 's2');
      const newS3 = swappedPlan.find(s => s.slotId === 's3');
      expect(newS2?.dayIndex).toBe(0);  // s2 vẫn ở day 0
      expect(newS3?.dayIndex).toBe(1);  // s3 vẫn ở day 1
    }
  });

  it('B27.2 — swapOrder.resumeIndex = vị trí swap nhỏ nhất (i)', () => {
    const { plan, ctx } = makeTwoDayCtx();
    const results = ops.swapOrder(plan, ctx);
    // Chỉ có thể swap s1 và s2 (cùng day0) → resumeIndex = 0
    for (const r of results) {
      expect(r.resumeIndex).toBe(0);
    }
  });

  it('B27.3 — stateTrajectory.length = newPlan.length + 1 (invariant)', () => {
    const { plan, ctx } = makeTwoDayCtx();
    const results = ops.swapOrder(plan, ctx);
    for (const r of results) {
      expect(r.stateTrajectory).not.toBeUndefined();
      expect(r.stateTrajectory!.length).toBe(r.newPlan.length + 1);
    }
  });

  it('B27.4 — tspReorder.resumeIndex luôn là 0 (full recompute)', () => {
    const { plan, ctx } = makeTwoDayCtx();
    const results = ops.tspReorder(plan, ctx);
    for (const r of results) {
      expect(r.resumeIndex).toBe(0);
      expect(r.repairedFromIndex).toBe(0);
    }
  });

  it('B27.5 — tspReorder không thay đổi số slots (chỉ đổi thứ tự)', () => {
    const { plan, ctx } = makeTwoDayCtx();
    const results = ops.tspReorder(plan, ctx);
    for (const r of results) {
      expect(r.newPlan).toHaveLength(plan.length);
      const originalPlaceIds = new Set(plan.map(s => s.placeId));
      const newPlaceIds = new Set(r.newPlan.map(s => s.placeId));
      expect(newPlaceIds).toEqual(originalPlaceIds);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 28 — dot() và tagVectorOf(): data field correctness
// ---------------------------------------------------------------------------

describe('Batch 28 — dot() và tagVectorOf(): field correctness', () => {
  it('B28.1 — dot([1,0,...], [0,1,...]) = 0 (orthogonal vectors)', () => {
    const result = dot([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result).toBe(0);
  });

  it('B28.2 — dot([1,...], [1,...]) = sum of products', () => {
    const a = [0.5, 0.3, 0.2, 0, 0, 0, 0, 0, 0, 0];
    const b = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(dot(a, b)).toBeCloseTo(1.0, 5);
  });

  it('B28.3 — tagVectorOf: tag 1 → index 0, tag 10 → index 9', () => {
    const place = { tags: [{ tagId: 1 }, { tagId: 10 }] };
    const v = tagVectorOf(place);
    expect(v[0]).toBe(1);   // tag 1 → index 0
    expect(v[9]).toBe(1);   // tag 10 → index 9
    expect(v.slice(1, 9).every((x: number) => x === 0)).toBe(true);
  });

  it('B28.4 — tagVectorOf: tagId ngoài [1,10] bị bỏ qua', () => {
    const place = { tags: [{ tagId: 0 }, { tagId: 11 }, { tagId: -1 }] };
    const v = tagVectorOf(place);
    expect(v.every((x: number) => x === 0)).toBe(true);
  });

  it('B28.5 — tagVectorOf: tags=null → vector toàn 0', () => {
    const place = { tags: null };
    const v = tagVectorOf(place);
    expect(v.every((x: number) => x === 0)).toBe(true);
  });

  it('B28.6 — dot() với vector ngắn hơn: thiếu elements được coi là 0', () => {
    // a có 3 phần tử, b có 5 → max(3,5) iterations; a[3], a[4] = undefined → 0
    const a = [1, 2, 3];
    const b = [1, 1, 1, 1, 1];
    // sum = 1*1 + 2*1 + 3*1 + 0*1 + 0*1 = 6
    expect(dot(a, b)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Batch 29 — dropSlot: status filter, affectedSlotIds, repairedFromIndex
// ---------------------------------------------------------------------------

describe('Batch 29 — dropSlot: trường status, affectedSlotIds, repairedFromIndex', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeDropCtx() {
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    const p3 = makePlace({ placeId: 3, lat: 16.08, lng: 108.24, avgVisitDurationMin: 60 });
    return {
      p1, p2, p3,
      ctx: makeCtx({
        candidatePool: [p1, p2, p3],
        placeMap: new Map([[1, p1], [2, p2], [3, p3]]),
        initialState: makeState({
          timeRemainingMin: 1200, budgetRemaining: 5_000_000,
          capturedAt: '2026-05-23T01:00:00.000Z',
        }),
      }),
    };
  }

  it('B29.1 — dropSlot không xoá slot meal', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 'm1', placeId: 1, activityType: 'meal',
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    expect(results).toHaveLength(0);
  });

  it('B29.2 — dropSlot không xoá slot completed', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 'c1', placeId: 1, status: 'completed', activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    expect(results).toHaveLength(0);
  });

  it('B29.3 — dropSlot không xoá slot locked', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 'l1', placeId: 1, isLocked: true, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    expect(results).toHaveLength(0);
  });

  it('B29.4 — dropSlot: affectedSlotIds chỉ chứa slotId của slot bị xoá (không chứa suffix)', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, activityType: 'sightseeing',
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    // Kết quả drop s1 → affectedSlotIds chỉ chứa 's1', không chứa 's2'
    const dropS1 = results.find(r => r.affectedSlotIds.includes('s1'));
    expect(dropS1).toBeDefined();
    expect(dropS1!.affectedSlotIds).toEqual(['s1']);
    expect(dropS1!.affectedSlotIds).not.toContain('s2');
  });

  it('B29.5 — dropSlot: xoá slot cuối cùng → repairedFromIndex không có trong result', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, activityType: 'sightseeing',
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    // Drop s2 (last slot) → isSuffixRepaired=false → repairedFromIndex undefined
    const dropS2 = results.find(r => r.affectedSlotIds.includes('s2'));
    expect(dropS2).toBeDefined();
    expect(dropS2!.repairedFromIndex).toBeUndefined();
    // Drop s1 (non-last) → isSuffixRepaired=true → repairedFromIndex defined
    const dropS1 = results.find(r => r.affectedSlotIds.includes('s1'));
    expect(dropS1!.repairedFromIndex).toBe(0);
  });

  it('B29.6 — dropSlot: sau khi xoá, newPlan.length = plan.length - 1', () => {
    const { ctx } = makeDropCtx();
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, activityType: 'sightseeing',
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
      makeSlot({ slotId: 's3', placeId: 3, activityType: 'sightseeing',
        plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T07:00:00.000Z' }),
    ];
    const results = ops.dropSlot(plan, ctx);
    for (const r of results) {
      expect(r.newPlan).toHaveLength(plan.length - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 30 — replacePlace & insertAlt: status filter, candidatePool, MAX limits
// ---------------------------------------------------------------------------

describe('Batch 30 — replacePlace & insertAlt: field correctness', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  function makeReplaceCtx(extra: Place[] = []) {
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60,
      indoorOutdoor: 'indoor', tags: [{ tagId: 1, name: 'beach', displayName: 'Beach' }] });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60,
      indoorOutdoor: 'indoor', tags: [{ tagId: 1, name: 'beach', displayName: 'Beach' }] });
    const candidates = [p1, p2, ...extra];
    const pm = new Map<number, Place>(candidates.map(p => [p.placeId, p]));
    return {
      p1, p2,
      ctx: makeCtx({
        candidatePool: candidates,
        placeMap: pm,
        initialState: makeState({
          timeRemainingMin: 1200, budgetRemaining: 5_000_000,
          capturedAt: '2026-05-23T01:00:00.000Z',
        }),
        user: {
          ...makeCtx({ candidatePool: [] }).user,
          preferredTagIds: [1],
          preferenceVector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      }),
    };
  }

  it('B30.1 — replacePlace không thay thế slot completed', () => {
    const { ctx } = makeReplaceCtx();
    const plan = [
      makeSlot({ slotId: 'c1', placeId: 1, status: 'completed', activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const results = ops.replacePlace(plan, ctx);
    // No result should have 'c1' as the slot being replaced
    for (const r of results) {
      const replacedSlot = r.newPlan.find(s => s.slotId === 'c1');
      // slot vẫn tồn tại trong plan với placeId gốc
      expect(replacedSlot?.placeId).toBe(1);
    }
    // Không thể replace completed slot → results rỗng (chỉ có 1 slot trong plan và nó completed)
    expect(results).toHaveLength(0);
  });

  it('B30.2 — replacePlace không thay thế slot meal (activityType=meal)', () => {
    const { p2, ctx } = makeReplaceCtx();
    const plan = [
      makeSlot({ slotId: 'm1', placeId: 1, status: 'planned', activityType: 'meal',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const results = ops.replacePlace(plan, ctx);
    expect(results).toHaveLength(0);
  });

  it('B30.3 — insertAlt: tất cả places đều trong plan → không có kết quả', () => {
    const { ctx } = makeReplaceCtx();
    // Both p1 and p2 are in the plan
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, activityType: 'sightseeing',
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
    ];
    // candidatePool = [p1, p2], both occupied → score filter → no insertable candidates
    const results = ops.insertAlt(plan, ctx);
    expect(results).toHaveLength(0);
  });

  it('B30.4 — insertAlt với forceIncludePlaceId đã có trong plan → không có kết quả', () => {
    const { ctx } = makeReplaceCtx();
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const ctxWithForce = { ...ctx, forceIncludePlaceId: 1 };
    const results = ops.insertAlt(plan, ctxWithForce);
    expect(results).toHaveLength(0);
  });

  it('B30.5 — insertAlt: newPlan.length = plan.length + 1 (chèn thêm 1 slot)', () => {
    // Cần place không có trong plan để insertAlt hoạt động
    const p3 = makePlace({ placeId: 3, lat: 16.09, lng: 108.25, avgVisitDurationMin: 60,
      indoorOutdoor: 'indoor', tags: [{ tagId: 1, name: 'beach', displayName: 'Beach' }] });
    const { ctx } = makeReplaceCtx([p3]);
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const results = ops.insertAlt(plan, ctx);
    for (const r of results) {
      expect(r.newPlan).toHaveLength(plan.length + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Batch 31 — repairSuffix dayIndex regression + synthesizeSlot estimatedCost pipeline
// ---------------------------------------------------------------------------

describe('Batch 31 — repairSuffix dayIndex regression + estimatedCost pipeline', () => {
  const evolver = new StateEvolver();
  const ops = new MutationOperators(evolver);

  it('B31.1 — [REGRESSION] repairSuffix giữ dayIndex=1 cho slot trên ngày hôm sau', () => {
    // Bug đã fix: slot ngày 1 bị gán dayIndex=0 sau repairSuffix
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, dayIndex: 0,
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, dayIndex: 1,
        plannedStart: '2026-05-24T02:00:00.000Z', plannedEnd: '2026-05-24T03:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2],
      placeMap: new Map([[1, p1], [2, p2]]),
      initialState: makeState({
        timeRemainingMin: 1200, budgetRemaining: 2_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z', dayIndex: 0,
      }),
    });
    const repaired = (ops as any).repairSuffix(plan, 0, ctx);
    expect(repaired).not.toBeNull();
    expect(repaired[0].dayIndex).toBe(0);  // ngày 0 không đổi
    expect(repaired[1].dayIndex).toBe(1);  // ngày 1 phải được giữ nguyên
  });

  it('B31.2 — [REGRESSION] swapOrder giữ dayIndex=1 cho s3 sau khi swap s1 và s2 (dayIndex=0)', () => {
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    const p3 = makePlace({ placeId: 3, lat: 16.08, lng: 108.24, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, dayIndex: 0, slotOrder: 1,
        plannedStart: '2026-05-23T04:00:00.000Z', plannedEnd: '2026-05-23T05:00:00.000Z' }),
      makeSlot({ slotId: 's3', placeId: 3, dayIndex: 1, slotOrder: 0,
        plannedStart: '2026-05-24T02:00:00.000Z', plannedEnd: '2026-05-24T03:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2, p3],
      placeMap: new Map([[1, p1], [2, p2], [3, p3]]),
      initialState: makeState({
        timeRemainingMin: 1200, budgetRemaining: 2_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z', dayIndex: 0,
      }),
    });
    const results = ops.swapOrder(plan, ctx);
    // Mọi kết quả swap (chỉ swap s1,s2 cùng day0) phải giữ s3.dayIndex=1
    for (const r of results) {
      const s3 = r.newPlan.find(s => s.slotId === 's3');
      expect(s3?.dayIndex).toBe(1);
    }
  });

  it('B31.3 — estimatedCost pipeline: synthesizeSlot(estimatedCost=0) → repairSuffix ghi đè bằng minPrice', () => {
    // synthesizeSlot dùng `??` → preserves 0
    // repairSuffix dùng `> 0` → overwrites 0 with minPrice
    // Kết quả cuối: estimatedCost = minPrice (không phải 0)
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60, minPrice: 50_000,
      estimatedCost: 0 });  // 0 = free theo synthesizeSlot, nhưng repairSuffix sẽ ghi đè
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60, minPrice: 50_000,
      estimatedCost: 0, tags: [{ tagId: 1, name: 'beach', displayName: 'Beach' }] });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing',
        plannedStart: '2026-05-23T02:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2],
      placeMap: new Map([[1, p1], [2, p2]]),
      initialState: makeState({
        timeRemainingMin: 1200, budgetRemaining: 2_000_000,
        capturedAt: '2026-05-23T01:00:00.000Z',
      }),
      user: {
        ...makeCtx({ candidatePool: [] }).user,
        preferredTagIds: [1],
        preferenceVector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    });
    const results = ops.insertAlt(plan, ctx);
    // Sau khi insert p2, repairSuffix xử lý slot mới
    // slot.estimatedCost=0 (từ synthesizeSlot dùng ??) → repairSuffix ghi đè bằng minPrice=50_000
    for (const r of results) {
      const insertedSlot = r.newPlan.find(s => s.placeId === 2);
      if (insertedSlot) {
        // [DOCUMENTED INCONSISTENCY] estimatedCost=0 từ synthesizeSlot bị repairSuffix ghi đè
        expect(insertedSlot.estimatedCost).toBe(50_000);  // repairSuffix ghi đè
      }
    }
  });

  it('B31.4 — repairSuffix với dayIndex > 0 trong initialState: dayJump tính đúng', () => {
    // Kịch bản: replan ở giữa trip (dayIndex=2), slot ngày 3 phải có dayIndex=3
    const p1 = makePlace({ placeId: 1, lat: 16.06, lng: 108.22, avgVisitDurationMin: 60 });
    const p2 = makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ slotId: 's1', placeId: 1, dayIndex: 2,
        plannedStart: '2026-05-25T02:00:00.000Z', plannedEnd: '2026-05-25T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', placeId: 2, dayIndex: 3,
        plannedStart: '2026-05-26T02:00:00.000Z', plannedEnd: '2026-05-26T03:00:00.000Z' }),
    ];
    const ctx = makeCtx({
      candidatePool: [p1, p2],
      placeMap: new Map([[1, p1], [2, p2]]),
      initialState: makeState({
        timeRemainingMin: 1200, budgetRemaining: 2_000_000,
        capturedAt: '2026-05-25T01:00:00.000Z', dayIndex: 2,  // mid-trip, day 2
      }),
    });
    const repaired = (ops as any).repairSuffix(plan, 0, ctx);
    expect(repaired).not.toBeNull();
    expect(repaired[0].dayIndex).toBe(2);  // day 2
    expect(repaired[1].dayIndex).toBe(3);  // day 3 (không phải 2!)
  });
});
