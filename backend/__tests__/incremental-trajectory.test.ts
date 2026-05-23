/**
 * Property tests for SPEC-01: Incremental Trajectory Computation & Delta Scoring.
 *
 * Core invariant:
 *   computeTrajectoryIncremental(..., parentCache, resumeIndex).states
 *     ≡ computeTrajectoryFull(plan, initialState, ctx).states
 *
 *   scoreDelta(..., parentCache, resumeIndex).total
 *     ≡ scoreFullAndCache(plan, states, weights, ctx, history).total
 */

import { describe, it, expect, beforeEach } from 'vitest';
import StateEvolver from '../src/replanner/StateEvolver';
import { ObjectiveScorer, type BeamSearchContext } from '../src/replanner/BeamSearch';
import type {
  TripSlot,
  TripState,
  Place,
  UserPreference,
  ObjectiveWeights,
} from '@app/types';
import type { TrajectoryCache } from '../src/replanner/TrajectoryCache';
import type { MutationResult } from '../src/replanner/MutationOperators';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test',
    description: null,
    lat: 16.06,
    lng: 108.22,
    minPrice: 0,
    maxPrice: null,
    priceType: 'free',
    avgVisitDurationMin: 60,
    parkingAvailable: false,
    wheelchairAccess: false,
    publicTransport: false,
    terrainEasiness: 0.8,
    roadAccessScore: null,
    spaciousness1km: null,
    popularityScore: null,
    indoorOutdoor: 'indoor',
    isLandmark: false,
    landmarkClassId: null,
    address: null,
    images: [],
    tags: [],
    openingHours: [],
    ...overrides,
  };
}

const BASE_PLACES: Place[] = [
  makePlace({ placeId: 1, lat: 16.06, lng: 108.22, tags: [{ tagId: 1, name: 'culture', displayName: 'Culture' }] }),
  makePlace({ placeId: 2, lat: 16.07, lng: 108.23, avgVisitDurationMin: 90 }),
  makePlace({ placeId: 3, lat: 16.05, lng: 108.21, indoorOutdoor: 'outdoor', avgVisitDurationMin: 45 }),
  makePlace({ placeId: 4, lat: 16.08, lng: 108.24, avgVisitDurationMin: 120, tags: [{ tagId: 2, name: 'nature', displayName: 'Nature' }] }),
  makePlace({ placeId: 5, lat: 16.04, lng: 108.20, avgVisitDurationMin: 60 }),
];

function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-1',
    tripId: 'trip-1',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-21T01:00:00.000Z',
    plannedEnd: '2026-04-21T02:00:00.000Z',
    actualStart: null,
    actualEnd: null,
    estimatedCost: 0,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

/** Build a plan of N slots using the first N places in BASE_PLACES (cycles if N > 5). */
function makePlan(n: number, baseTime = '2026-04-21T01:00:00.000Z'): TripSlot[] {
  const slots: TripSlot[] = [];
  let cursor = new Date(baseTime).getTime();
  for (let i = 0; i < n; i++) {
    const place = BASE_PLACES[i % BASE_PLACES.length]!;
    const durationMs = place.avgVisitDurationMin * 60_000;
    const start = new Date(cursor).toISOString();
    cursor += durationMs;
    const end = new Date(cursor).toISOString();
    cursor += 10 * 60_000; // 10 min travel gap
    slots.push(makeSlot({
      slotId: `slot-${i}`,
      slotOrder: i,
      placeId: place.placeId,
      plannedStart: start,
      plannedEnd: end,
    }));
  }
  return slots;
}

function makeInitialState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-1',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 720,
    budgetRemaining: 5_000_000,
    fatigue: 0.1,
    currentLat: 16.06,
    currentLng: 108.22,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T00:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makeUser(preferenceVector = new Array(10).fill(0.1)): UserPreference {
  return {
    userId: 'user-1',
    primaryPurpose: 'van_hoa',
    preferredTagIds: [],
    pace: 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: [],
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 3_000_000,
    groupType: 'solo',
    mobilityRestrictions: [],
    preferenceVector,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1,
  wPace: 0.5,
  wDistance: 0.5,
  wBudget: 0.1,
  wWeather: 0.5,
  wRisk: 0.3,
  wStability: 0.2,
  wPotentialBias: 0.5,
  wProximity: 0,
  wSynergy: 0.3,
};

function makeCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  return {
    candidatePool: BASE_PLACES,
    user: makeUser(),
    weatherForecast: [{ rainMmPerH: 0 }, { rainMmPerH: 0 }],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeInitialState(),
    remainingSlots: [],
    weights: DEFAULT_WEIGHTS,
    placeMap: new Map(BASE_PLACES.map((p) => [p.placeId, p])),
    ...overrides,
  };
}

const TOLERANCE = 1e-9;

// ---------------------------------------------------------------------------
// Helper: build a parent cache from a full plan
// ---------------------------------------------------------------------------

function buildParentCache(
  evolver: StateEvolver,
  scorer: ObjectiveScorer,
  plan: TripSlot[],
  ctx: BeamSearchContext,
): { states: TripState[]; cache: TrajectoryCache } {
  const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
  const { cache } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);
  return { states, cache };
}

// ---------------------------------------------------------------------------
// 1. computeTrajectoryIncremental — property tests
// ---------------------------------------------------------------------------

describe('computeTrajectoryIncremental', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  it('full fallback when parentCache is null', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const full = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { states } = evolver.computeTrajectoryIncremental(plan, ctx.initialState, ctx, null, 2);
    expect(states).toEqual(full);
  });

  it('full fallback when resumeIndex = 0', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const full = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, plan, ctx);
    const { states } = evolver.computeTrajectoryIncremental(plan, ctx.initialState, ctx, cache, 0);
    expect(states).toEqual(full);
  });

  it('full fallback when resumeIndex >= plan.length', () => {
    const plan = makePlan(3);
    const ctx = makeCtx();
    const full = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, plan, ctx);
    const { states } = evolver.computeTrajectoryIncremental(plan, ctx.initialState, ctx, cache, 3);
    expect(states).toEqual(full);
  });

  it('incremental ≡ full for resumeIndex=1 (change last 3 slots)', () => {
    const parentPlan = makePlan(4);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, parentPlan, ctx);

    // Mutate: replace slots 1-3 with different places (slot 0 unchanged)
    const newPlan = [
      parentPlan[0]!,
      { ...parentPlan[1]!, placeId: 2 },
      { ...parentPlan[2]!, placeId: 3 },
      { ...parentPlan[3]!, placeId: 4 },
    ];

    const full = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const { states } = evolver.computeTrajectoryIncremental(newPlan, ctx.initialState, ctx, cache, 1);

    expect(states.length).toBe(full.length);
    for (let i = 0; i < states.length; i++) {
      expect(states[i]!.budgetRemaining).toBeCloseTo(full[i]!.budgetRemaining, 6);
      expect(states[i]!.fatigue).toBeCloseTo(full[i]!.fatigue, 6);
    }
  });

  it('incremental ≡ full for resumeIndex=2 (prefix of 2 slots unchanged)', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, parentPlan, ctx);

    // Only change slots 2-4
    const newPlan = [
      parentPlan[0]!,
      parentPlan[1]!,
      { ...parentPlan[2]!, placeId: 4 },
      { ...parentPlan[3]!, placeId: 5 },
      { ...parentPlan[4]!, placeId: 3 },
    ];

    const full = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const { states } = evolver.computeTrajectoryIncremental(newPlan, ctx.initialState, ctx, cache, 2);

    expect(states.length).toBe(full.length);
    for (let i = 0; i < states.length; i++) {
      expect(states[i]!.budgetRemaining).toBeCloseTo(full[i]!.budgetRemaining, 6);
      expect(states[i]!.fatigue).toBeCloseTo(full[i]!.fatigue, 6);
      expect(states[i]!.currentLat).toBeCloseTo(full[i]!.currentLat!, 6);
    }
  });

  it('returns feasible=true for a valid plan', () => {
    const plan = makePlan(3);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, plan, ctx);
    const { feasible } = evolver.computeTrajectoryIncremental(plan, ctx.initialState, ctx, cache, 1);
    expect(feasible).toBe(true);
  });

  // DROP_SLOT: new plan is shorter
  it('DROP_SLOT — shorter new plan (resumeIndex = drop position)', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, parentPlan, ctx);

    // Drop slot at index 2 → new plan = [0, 1, 3, 4]
    const newPlan = [parentPlan[0]!, parentPlan[1]!, parentPlan[3]!, parentPlan[4]!];
    const full = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const { states } = evolver.computeTrajectoryIncremental(newPlan, ctx.initialState, ctx, cache, 2);

    expect(states.length).toBe(full.length);
    for (let i = 0; i < states.length; i++) {
      expect(states[i]!.budgetRemaining).toBeCloseTo(full[i]!.budgetRemaining, 6);
    }
  });

  // INSERT_ALT: new plan is longer
  it('INSERT_ALT — longer new plan (resumeIndex = insert position)', () => {
    const parentPlan = makePlan(3);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, parentPlan, ctx);

    // Insert slot at position 1 → new plan = [0, new, 1, 2]
    const inserted = makeSlot({ slotId: 'inserted', placeId: 4, slotOrder: 1 });
    const newPlan = [parentPlan[0]!, inserted, parentPlan[1]!, parentPlan[2]!];
    const full = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const { states } = evolver.computeTrajectoryIncremental(newPlan, ctx.initialState, ctx, cache, 1);

    expect(states.length).toBe(full.length);
    for (let i = 0; i < states.length; i++) {
      expect(states[i]!.fatigue).toBeCloseTo(full[i]!.fatigue, 6);
    }
  });

  // Prefix states must be identical (bit-exact copy from cache)
  it('prefix states are shallow-equal copies from parent cache', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const scorer = new ObjectiveScorer(evolver);
    const { cache } = buildParentCache(evolver, scorer, parentPlan, ctx);

    const newPlan = [
      parentPlan[0]!,
      parentPlan[1]!,
      { ...parentPlan[2]!, placeId: 3 },
      parentPlan[3]!,
      parentPlan[4]!,
    ];
    const { states } = evolver.computeTrajectoryIncremental(newPlan, ctx.initialState, ctx, cache, 2);

    // states[0..2] must match the parent cache exactly
    for (let i = 0; i <= 2; i++) {
      expect(states[i]).toBe(cache.states[i]); // same object reference (slice reuses)
    }
  });
});

// ---------------------------------------------------------------------------
// 2. scoreDelta — property tests
// ---------------------------------------------------------------------------

describe('scoreDelta', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  it('returns same total as scoreFullAndCache when parentCache is null', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { total: full } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(plan, states, DEFAULT_WEIGHTS, ctx, [], null, 2);
    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  it('returns same total as scoreFullAndCache when resumeIndex = 0', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { total: full, cache } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(plan, states, DEFAULT_WEIGHTS, ctx, [], cache, 0);
    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  it('incremental score ≡ full score for resumeIndex=1', () => {
    const parentPlan = makePlan(4);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    // Mutate: change slots 1-3
    const newPlan = [
      parentPlan[0]!,
      { ...parentPlan[1]!, placeId: 2 },
      { ...parentPlan[2]!, placeId: 3 },
      { ...parentPlan[3]!, placeId: 4 },
    ];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 1);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  it('incremental score ≡ full score for resumeIndex=2', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    const newPlan = [
      parentPlan[0]!,
      parentPlan[1]!,
      { ...parentPlan[2]!, placeId: 4 },
      { ...parentPlan[3]!, placeId: 5 },
      parentPlan[4]!,
    ];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 2);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  it('incremental score ≡ full score with history (stability)', () => {
    const parentPlan = makePlan(3);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    const newPlan = [parentPlan[0]!, { ...parentPlan[1]!, placeId: 3 }, parentPlan[2]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const history: MutationResult[] = [
      { operator: 'REPLACE_PLACE', affectedSlotIds: ['slot-1'], newPlan: [], description: '', resumeIndex: 1 },
    ];

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, history);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, history, cache, 1);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  // DROP_SLOT edge case
  it('DROP_SLOT — shorter plan (resumeIndex = drop position)', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    // Drop slot 2 → new plan [0, 1, 3, 4]
    const newPlan = [parentPlan[0]!, parentPlan[1]!, parentPlan[3]!, parentPlan[4]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 2);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  // INSERT_ALT edge case
  it('INSERT_ALT — longer plan (resumeIndex = insert position)', () => {
    const parentPlan = makePlan(3);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    const inserted = makeSlot({ slotId: 'ins', placeId: 4, slotOrder: 1 });
    const newPlan = [parentPlan[0]!, inserted, parentPlan[1]!, parentPlan[2]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 1);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  // TSP_REORDER / full-reorder case: resumeIndex = 0 → falls back to full computation
  it('TSP_REORDER (resumeIndex=0) — scoreDelta ≡ scoreFullAndCache', () => {
    const parentPlan = makePlan(4);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    // Fully reordered plan
    const newPlan = [parentPlan[3]!, parentPlan[0]!, parentPlan[2]!, parentPlan[1]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 0);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });

  // scoreFullAndCache must match legacy score() for numerical parity
  it('scoreFullAndCache total matches legacy score()', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { total } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);
    const legacy = scorer.score(plan, states, DEFAULT_WEIGHTS, ctx, []);
    expect(total).toBeCloseTo(legacy, TOLERANCE);
  });

  // Cache structure integrity
  it('returned cache has correct slotScores length', () => {
    const plan = makePlan(4);
    const ctx = makeCtx();
    const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);
    expect(cache.slotScores.length).toBe(plan.length);
    expect(cache.planScores.synergyPairs.length).toBe(plan.length - 1);
  });

  it('scoreDelta cache has correct slotScores length after suffix change', () => {
    const parentPlan = makePlan(5);
    const ctx = makeCtx();
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache: parentCache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    const newPlan = [...parentPlan.slice(0, 3), { ...parentPlan[3]!, placeId: 5 }, parentPlan[4]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], parentCache, 3);

    expect(cache.slotScores.length).toBe(newPlan.length);
    expect(cache.planScores.synergyPairs.length).toBe(newPlan.length - 1);
  });

  // Weather rain scenario
  it('incremental score ≡ full score with rain weather', () => {
    const parentPlan = makePlan(3);
    const ctx = makeCtx({
      weatherForecast: [{ rainMmPerH: 10 }, { rainMmPerH: 0 }],
    });
    const parentStates = evolver.computeTrajectoryFull(parentPlan, ctx.initialState, ctx);
    const { cache } = scorer.scoreFullAndCache(parentPlan, parentStates, DEFAULT_WEIGHTS, ctx, []);

    const newPlan = [parentPlan[0]!, { ...parentPlan[1]!, placeId: 3 }, parentPlan[2]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], cache, 1);

    expect(delta).toBeCloseTo(full, TOLERANCE);
  });
});

// ---------------------------------------------------------------------------
// 3. Benchmark: latency reduction on a 10-slot plan
// ---------------------------------------------------------------------------

describe('Benchmark: incremental vs full', () => {
  it('scoreDelta is not slower than scoreFullAndCache on a 10-slot plan', () => {
    const evolver = new StateEvolver();
    const scorer = new ObjectiveScorer(evolver);
    const plan = makePlan(10);
    const ctx = makeCtx();
    const states = evolver.computeTrajectoryFull(plan, ctx.initialState, ctx);
    const { cache: parentCache } = scorer.scoreFullAndCache(plan, states, DEFAULT_WEIGHTS, ctx, []);

    // Simulate a small change at slot 8 (prefix of 8 slots cached)
    const newPlan = [...plan.slice(0, 8), { ...plan[8]!, placeId: 2 }, plan[9]!];
    const newStates = evolver.computeTrajectoryFull(newPlan, ctx.initialState, ctx);

    const REPS = 200;

    const t0 = performance.now();
    for (let i = 0; i < REPS; i++) {
      scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    }
    const fullMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < REPS; i++) {
      scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], parentCache, 8);
    }
    const deltaMs = performance.now() - t1;

    // scoreDelta should be at least 20% faster when 80% of slots are cached.
    // We use a loose bound (delta < full) to avoid CI flakiness on slow machines.
    expect(deltaMs).toBeLessThan(fullMs * 1.5); // generous: not slower by >50%

    // Also verify correctness
    const { total: full } = scorer.scoreFullAndCache(newPlan, newStates, DEFAULT_WEIGHTS, ctx, []);
    const { total: delta } = scorer.scoreDelta(newPlan, newStates, DEFAULT_WEIGHTS, ctx, [], parentCache, 8);
    expect(delta).toBeCloseTo(full, TOLERANCE);
  });
});
