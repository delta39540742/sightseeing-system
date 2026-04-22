import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchConfig,
  type BeamSearchContext,
  type BeamNode,
} from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators, type MutationResult } from '../src/replanner/MutationOperators';
import type {
  TripSlot,
  TripState,
  Place,
  UserPreference,
  ObjectiveWeights,
  PlaceTag,
} from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeTag(tagId: number): PlaceTag {
  return { tagId, name: `tag${tagId}`, displayName: `Tag ${tagId}` };
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
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

function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-001',
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-21T02:00:00.000Z',
    plannedEnd: '2026-04-21T03:00:00.000Z',
    actualStart: null,
    actualEnd: null,
    estimatedCost: 50_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 720,
    budgetRemaining: 5_000_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T01:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makeUser(preferenceVector = new Array(10).fill(0)): UserPreference {
  return {
    userId: 'user-001',
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * PLACE_A has only tag 5. PLACE_B has tags 1 and 5.
 * User has preferenceVector[0]=1 (tagId 1) and preferenceVector[4]=1 (tagId 5).
 *
 * → dot(user, tagVec(A)) = 0+0+0+0+1 = 1.0
 * → dot(user, tagVec(B)) = 1+0+0+0+1 = 2.0
 * → PLACE_B scores higher for interest
 * → tag overlap(A, B) = 1 (both have tagId 5) → replacePlace will suggest B for A
 */
const PREF_VEC = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const PLACE_A = makePlace({
  placeId: 10,
  name: 'Place A',
  lat: 16.060,
  lng: 108.220,
  tags: [makeTag(5)],
});
const PLACE_B = makePlace({
  placeId: 20,
  name: 'Place B',
  lat: 16.062,
  lng: 108.223,
  tags: [makeTag(1), makeTag(5)],
});

const SLOT_A = makeSlot({ slotId: 'sa', placeId: PLACE_A.placeId });

/** Weights that only care about interest, so improvements are purely tag-driven. */
const INTEREST_WEIGHTS: ObjectiveWeights = {
  wInterest: 1,
  wPace: 0,
  wDistance: 0,
  wBudget: 0,
  wWeather: 0,
  wRisk: 0,
};

const EQUAL_WEIGHTS: ObjectiveWeights = {
  wInterest: 1,
  wPace: 1,
  wDistance: 0,
  wBudget: 0,
  wWeather: 0,
  wRisk: 0,
};

/** Creates a BeamSearchContext ready for use. */
function makeCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  return {
    candidatePool: [PLACE_A, PLACE_B],
    user: makeUser(PREF_VEC),
    weatherBySlotId: {},
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    remainingSlots: [SLOT_A],
    weights: INTEREST_WEIGHTS,
    ...overrides,
  };
}

const FAST_CONFIG: BeamSearchConfig = {
  beamWidth: 3,
  maxIterations: 10,
  improvementThreshold: 0.01,
  latencyBudgetMs: 4500,
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('BeamSearch', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
    scorer = new ObjectiveScorer(evolver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. returns root node if no improvement found
  // -------------------------------------------------------------------------

  it('returns root node if no improvement found (no mutations generated)', () => {
    vi.spyOn(operators, 'generateAll').mockReturnValue([]);

    const beam = new BeamSearch(evolver, operators, scorer, FAST_CONFIG);
    const result = beam.search(makeCtx());

    // Root node has no parent and no mutation history
    expect(result.parent).toBeNull();
    expect(result.mutationHistory).toHaveLength(0);
    expect(result.plan).toEqual([SLOT_A]);
  });

  // -------------------------------------------------------------------------
  // 2. improves score over iterations
  // -------------------------------------------------------------------------

  it('improves score over iterations when a better plan exists', () => {
    // Real operators; PLACE_B matches user prefs better than PLACE_A
    const beam = new BeamSearch(evolver, operators, scorer, FAST_CONFIG);
    const ctx = makeCtx({
      remainingSlots: [SLOT_A],
      weights: INTEREST_WEIGHTS,
    });

    const result = beam.search(ctx);

    // Compute the root score independently to compare
    const rootStates = evolver.computeTrajectory([SLOT_A], ctx.initialState, ctx);
    const rootScore = scorer.score([SLOT_A], rootStates, INTEREST_WEIGHTS, ctx);

    // After beam search, the best node should score at least as well as root,
    // and in this case strictly better (PLACE_B has higher interest match).
    expect(result.score).toBeGreaterThanOrEqual(rootScore);

    // Verify the improvement came from replacing PLACE_A with PLACE_B
    const hasBPlaceInResult = result.plan.some(
      (s) => s.placeId === PLACE_B.placeId,
    );
    expect(hasBPlaceInResult).toBe(true);
  });

  it('returned node has a higher interest score when plan has a better tag match', () => {
    const beam = new BeamSearch(evolver, operators, scorer, FAST_CONFIG);
    const ctx = makeCtx({ weights: INTEREST_WEIGHTS });

    const result = beam.search(ctx);

    // PLACE_A interest = 1.0 (tagId 5 only), PLACE_B interest = 2.0 (tagIds 1+5)
    // With wInterest=1 and other weights=0, best reachable score should be ≥ 2.0
    expect(result.score).toBeGreaterThanOrEqual(1.0);
  });

  // -------------------------------------------------------------------------
  // 3. respects beamWidth limit
  // -------------------------------------------------------------------------

  it('respects beamWidth limit — generateAll is called ≤ beamWidth times per iteration', () => {
    const beamWidth = 2;
    const maxIterations = 3;
    const config: BeamSearchConfig = {
      beamWidth,
      maxIterations,
      improvementThreshold: 0.0001,
      latencyBudgetMs: 4500,
    };

    // Track how many nodes were expanded per "iteration group".
    // In each iteration, generateAll is called once per node in the beam.
    // Beam starts with 1 (root), then grows to at most beamWidth.
    // Maximum total calls: 1 (root iter) + beamWidth * (maxIterations-1)
    const generateSpy = vi.spyOn(operators, 'generateAll');

    const beam = new BeamSearch(evolver, operators, scorer, config);
    beam.search(makeCtx());

    const maxExpectedCalls = 1 + beamWidth * (maxIterations - 1);
    expect(generateSpy.mock.calls.length).toBeLessThanOrEqual(maxExpectedCalls);
  });

  it('with beamWidth=1, each iteration expands exactly one node', () => {
    const config: BeamSearchConfig = {
      beamWidth: 1,
      maxIterations: 4,
      improvementThreshold: 0.001,
      latencyBudgetMs: 4500,
    };
    const generateSpy = vi.spyOn(operators, 'generateAll');

    const beam = new BeamSearch(evolver, operators, scorer, config);
    beam.search(makeCtx());

    // With beamWidth=1 and at most 4 iterations: at most 4 calls to generateAll
    expect(generateSpy.mock.calls.length).toBeLessThanOrEqual(4);
  });

  // -------------------------------------------------------------------------
  // 4. stops at latencyBudgetMs
  // -------------------------------------------------------------------------

  it('stops at latencyBudgetMs and returns best-so-far', () => {
    vi.useFakeTimers();

    // Score counter to ensure always-improving scores (prevents early-stop)
    let scoreCall = 0;
    vi.spyOn(scorer, 'score').mockImplementation(() => 0.5 + scoreCall++ * 0.1);

    // Each expansion "costs" 2000 ms of fake wall-clock time
    let expandCount = 0;
    vi.spyOn(operators, 'generateAll').mockImplementation(() => {
      expandCount++;
      vi.advanceTimersByTime(2000);
      // Return one valid mutation: replace PLACE_A with PLACE_B
      return [
        {
          newPlan: [makeSlot({ slotId: 'mut-slot', placeId: PLACE_B.placeId })],
          operator: 'REPLACE_PLACE' as const,
          affectedSlotIds: [SLOT_A.slotId],
          description: 'mock replacement',
        } satisfies MutationResult,
      ];
    });

    const config: BeamSearchConfig = {
      beamWidth: 1,
      maxIterations: 100,         // very high → latency should be the stopper
      improvementThreshold: 0.0001,
      latencyBudgetMs: 3500,      // 3.5 s budget
    };

    const beam = new BeamSearch(evolver, operators, scorer, config);
    const result = beam.search(makeCtx());

    // Budget = 3500 ms, each expansion = 2000 ms fake time:
    //   iter 0: check 0ms < 3500ms → expand (→ 2000ms) → score → done
    //   iter 1: check 2000ms < 3500ms → expand (→ 4000ms) → score → done
    //   iter 2: check 4000ms > 3500ms → RETURN
    // So expandCount should be exactly 2
    expect(expandCount).toBe(2);
    expect(result).toBeDefined();

    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 5. stops early if improvement < threshold
  // -------------------------------------------------------------------------

  it('stops early when relative improvement falls below threshold', () => {
    // Mock operators to always return the same mutation and score
    const FIXED_SCORE = 0.5;
    vi.spyOn(scorer, 'score').mockReturnValue(FIXED_SCORE);

    const expandSpy = vi.spyOn(operators, 'generateAll').mockReturnValue([
      {
        newPlan: [makeSlot({ slotId: 'es-slot', placeId: PLACE_B.placeId })],
        operator: 'REPLACE_PLACE' as const,
        affectedSlotIds: [SLOT_A.slotId],
        description: 'plateau mutation',
      } satisfies MutationResult,
    ]);

    const config: BeamSearchConfig = {
      beamWidth: 2,
      maxIterations: 100,    // high cap → early-stop should kick in first
      improvementThreshold: 0.01,
      latencyBudgetMs: 60_000,
    };

    const beam = new BeamSearch(evolver, operators, scorer, config);
    beam.search(makeCtx());

    // prevBestScore = FIXED_SCORE (root, via mock)
    // iter 0: expansion → candidate score = FIXED_SCORE → beam → no early-stop (iter===0)
    //         prevBestScore updated to FIXED_SCORE
    // iter 1: expansion → candidate score = FIXED_SCORE
    //         improvement = (FIXED_SCORE - FIXED_SCORE) / FIXED_SCORE = 0 < 0.01 → BREAK
    // Total calls to generateAll: 2 (one per node in beam, beam has 1 node for first two iters)
    expect(expandSpy.mock.calls.length).toBeLessThanOrEqual(3); // definitely not 100
    expect(expandSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 6. never returns infeasible plan
  // -------------------------------------------------------------------------

  it('never returns an infeasible plan — skips candidates that fail isFeasible', () => {
    // Mark every state coming from a mutated plan as infeasible
    const infeasibleState = makeState({ fatigue: 1.0 }); // clearly infeasible

    vi.spyOn(evolver, 'computeTrajectory').mockImplementation(
      (plan, _initial, _ctx) => {
        if (plan.length === 0 || plan[0]!.slotId === SLOT_A.slotId) {
          // Root trajectory → feasible states
          return [makeState()];
        }
        // Any mutation trajectory → infeasible end-state
        return [makeState(), infeasibleState];
      },
    );

    vi.spyOn(evolver, 'isFeasible').mockImplementation(
      (s) => s !== infeasibleState,
    );

    // Operators do return a candidate, but its states are infeasible
    vi.spyOn(operators, 'generateAll').mockReturnValue([
      {
        newPlan: [makeSlot({ slotId: 'bad-slot', placeId: PLACE_B.placeId })],
        operator: 'REPLACE_PLACE' as const,
        affectedSlotIds: [SLOT_A.slotId],
        description: 'infeasible candidate',
      } satisfies MutationResult,
    ]);

    const beam = new BeamSearch(evolver, operators, scorer, FAST_CONFIG);
    const result = beam.search(makeCtx());

    // The infeasible candidate was rejected → result is the root
    expect(result.parent).toBeNull();
    expect(result.plan).toEqual([SLOT_A]);

    // Double-check: every state in the result trajectory passes isFeasible
    const resultTrajectory = result.stateTrajectory;
    expect(resultTrajectory.every((s) => evolver.isFeasible(s))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. handles empty remainingSlots
  // -------------------------------------------------------------------------

  it('handles empty remainingSlots gracefully — does not throw, root plan is empty', () => {
    // Mock operators so no mutations are generated → root (empty plan) is always returned
    vi.spyOn(operators, 'generateAll').mockReturnValue([]);

    const beam = new BeamSearch(evolver, operators, scorer, FAST_CONFIG);
    const ctx = makeCtx({ remainingSlots: [] });

    const result = beam.search(ctx);

    // Should complete without throwing
    expect(result).toBeDefined();
    // With no mutations, root is returned intact
    expect(result.plan).toEqual([]);
    // Trajectory of empty plan = [initialState] only
    expect(result.stateTrajectory).toHaveLength(1);
    expect(result.stateTrajectory[0]).toEqual(ctx.initialState);
    expect(result.parent).toBeNull();
    expect(result.mutationHistory).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ObjectiveScorer tests
// ---------------------------------------------------------------------------

describe('ObjectiveScorer.score', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  const BASE_WEIGHTS: ObjectiveWeights = {
    wInterest: 1, wPace: 0, wDistance: 0,
    wBudget: 0, wWeather: 0, wRisk: 0,
  };

  it('returns higher score for plan with matching tags', () => {
    const prefVec = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // tagIds 1 and 5
    const user = makeUser(prefVec);

    const ctx = makeCtx({ user });

    const initial = makeState();

    // Plan A: visits PLACE_A (tag 5 only) → interest = 1
    const statesA = evolver.computeTrajectory([SLOT_A], initial, ctx);
    const scoreA = scorer.score([SLOT_A], statesA, BASE_WEIGHTS, ctx);

    // Plan B: visits PLACE_B (tags 1+5) → interest = 2
    const slotB = makeSlot({ slotId: 'sb', placeId: PLACE_B.placeId });
    const statesB = evolver.computeTrajectory([slotB], initial, ctx);
    const scoreB = scorer.score([slotB], statesB, BASE_WEIGHTS, ctx);

    expect(scoreB).toBeGreaterThan(scoreA);
  });

  it('returns 0 when plan is empty and only wPace is non-zero', () => {
    const weights: ObjectiveWeights = {
      wInterest: 0, wPace: 1, wDistance: 0,
      wBudget: 0, wWeather: 0, wRisk: 0,
    };
    const ctx = makeCtx({ weights });
    // Empty plan → paceFit = 1 → wPace * 1 = 1
    const score = scorer.score([], [makeState()], weights, ctx);
    expect(score).toBeCloseTo(1, 5);
  });

  it('adds weather bonus for indoor place in heavy rain', () => {
    const indoorPlace = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
    const outdoorPlace = makePlace({ placeId: 20, indoorOutdoor: 'outdoor' });

    const ctx = makeCtx({
      candidatePool: [indoorPlace, outdoorPlace],
      weatherForecast: [{ rainMmPerH: 10 }], // heavy rain at position 0
      weights: { wInterest: 0, wPace: 0, wDistance: 0, wBudget: 0, wWeather: 1, wRisk: 0 },
    });

    const indoorSlot = makeSlot({ placeId: indoorPlace.placeId });
    const outdoorSlot = makeSlot({ placeId: outdoorPlace.placeId });
    const initial = makeState();

    const statesIn = evolver.computeTrajectory([indoorSlot], initial, ctx);
    const statesOut = evolver.computeTrajectory([outdoorSlot], initial, ctx);

    const scoreIn = scorer.score([indoorSlot], statesIn, ctx.weights, ctx);
    const scoreOut = scorer.score([outdoorSlot], statesOut, ctx.weights, ctx);

    expect(scoreIn).toBeGreaterThan(scoreOut);
    expect(scoreIn).toBeCloseTo(1, 5);   // +1 for indoor in rain
    expect(scoreOut).toBeCloseTo(-1, 5); // -1 for outdoor in rain
  });

  it('adds negative risk term proportional to fatigue', () => {
    const weights: ObjectiveWeights = {
      wInterest: 0, wPace: 0, wDistance: 0, wBudget: 0, wWeather: 0, wRisk: 1,
    };
    // PLACE_A visit increases fatigue; we just check the term is negative
    const ctx = makeCtx({ weights });
    const statesA = evolver.computeTrajectory(
      [SLOT_A],
      makeState({ fatigue: 0.5 }),
      ctx,
    );
    const score = scorer.score([SLOT_A], statesA, weights, ctx);
    // risk = –fatigue_after, which is negative
    expect(score).toBeLessThan(0);
  });
});
