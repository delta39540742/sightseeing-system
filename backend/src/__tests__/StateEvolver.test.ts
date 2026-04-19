import { describe, it, expect, beforeEach } from 'vitest';
import StateEvolver, {
  type EvolveContext,
  type ReplanContext,
  type WeatherSnapshot,
} from '../replanner/StateEvolver';
import type { TripState, TripSlot, Place, UserPreference } from '@app/types';

// ---------------------------------------------------------------------------
// Test fixture factories
// ---------------------------------------------------------------------------

/** Creates a minimal TripState with sane defaults. Override via partial. */
function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,   // 8 h remaining
    budgetRemaining: 500_000, // 500k VND
    fatigue: 0.2,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-20T08:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

/**
 * Creates a minimal Place.
 * Default: indoor, terrainEasiness = 0.8, avgVisitDurationMin = 60,
 *          no tags, coords at Cầu Rồng.
 */
function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    minPrice: null,
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

/** Creates a sightseeing TripSlot with a given placeId and cost. */
function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-001',
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-20T09:00:00+07:00',
    plannedEnd: '2026-04-20T10:00:00+07:00',
    actualStart: null,
    actualEnd: null,
    estimatedCost: 50_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

/** Creates a UserPreference with an all-zero preferenceVector (no interest match). */
function makeUser(preferenceVector: number[] = new Array(10).fill(0)): UserPreference {
  return {
    userId: 'user-001',
    primaryPurpose: 'van_hoa',
    preferredTagIds: [],
    pace: 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: [],
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 1_000_000,
    groupType: 'solo',
    mobilityRestrictions: [],
    preferenceVector,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const CLEAR_WEATHER: WeatherSnapshot = { rainMmPerH: 0 };
const HEAVY_RAIN: WeatherSnapshot = { rainMmPerH: 10 };

/**
 * Helper: build a minimal EvolveContext.
 * Defaults: 10 min travel, indoor place, clear weather, zero preference vector.
 */
function makeCtx(overrides: Partial<EvolveContext> = {}): EvolveContext {
  return {
    travelTimeMin: 10,
    place: makePlace(),
    weatherAtSlot: CLEAR_WEATHER,
    user: makeUser(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: evolve()
// ---------------------------------------------------------------------------

describe('StateEvolver.evolve', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  it('decreases timeRemainingMin by travelTimeMin + duration', () => {
    const s = makeState({ timeRemainingMin: 480 });
    const slot = makeSlot();
    const ctx = makeCtx({ travelTimeMin: 20, actualDurationMin: 90 });

    const next = evolver.evolve(s, slot, ctx);

    // 480 − (20 + 90) = 370
    expect(next.timeRemainingMin).toBe(370);
  });

  it('falls back to place.avgVisitDurationMin when actualDurationMin is omitted', () => {
    const s = makeState({ timeRemainingMin: 480 });
    const place = makePlace({ avgVisitDurationMin: 45 });
    const ctx = makeCtx({ travelTimeMin: 15, place, actualDurationMin: undefined });

    const next = evolver.evolve(s, makeSlot(), ctx);

    expect(next.timeRemainingMin).toBe(480 - 15 - 45);
  });

  it('decreases budgetRemaining by slot.estimatedCost', () => {
    const s = makeState({ budgetRemaining: 500_000 });
    const slot = makeSlot({ estimatedCost: 80_000 });
    const ctx = makeCtx();

    const next = evolver.evolve(s, slot, ctx);

    expect(next.budgetRemaining).toBe(420_000);
  });

  it('uses actualCost when provided, overriding estimatedCost', () => {
    const s = makeState({ budgetRemaining: 500_000 });
    const slot = makeSlot({ estimatedCost: 80_000 });
    const ctx = makeCtx({ actualCost: 120_000 });

    const next = evolver.evolve(s, slot, ctx);

    expect(next.budgetRemaining).toBe(380_000);
  });

  it('increases fatigue more for an outdoor slot visited in heavy rain', () => {
    const base = makeState({ fatigue: 0.2 });
    const slot = makeSlot({ activityType: 'sightseeing' });
    const outdoorPlace = makePlace({ indoorOutdoor: 'outdoor', terrainEasiness: 0.8 });
    const indoorPlace = makePlace({ indoorOutdoor: 'indoor', terrainEasiness: 0.8 });

    const ctxRainyOutdoor = makeCtx({
      place: outdoorPlace,
      weatherAtSlot: HEAVY_RAIN,
      travelTimeMin: 0,
      actualDurationMin: 60,
    });
    const ctxIndoor = makeCtx({
      place: indoorPlace,
      weatherAtSlot: HEAVY_RAIN,
      travelTimeMin: 0,
      actualDurationMin: 60,
    });

    const nextOutdoor = evolver.evolve(base, slot, ctxRainyOutdoor);
    const nextIndoor = evolver.evolve(base, slot, ctxIndoor);

    expect(nextOutdoor.fatigue).toBeGreaterThan(nextIndoor.fatigue);
  });

  it('decreases fatigue for a meal slot (recovery)', () => {
    // Start at moderate fatigue; with zero travel and easy terrain the
    // fatigueDelta without meal adjustment = 0. With meal: delta = −0.12 → fatigue goes down.
    const s = makeState({ fatigue: 0.5 });
    const slot = makeSlot({ activityType: 'meal' });
    const ctx = makeCtx({
      travelTimeMin: 0,
      actualDurationMin: 60,
      place: makePlace({ terrainEasiness: 1.0 }), // no terrain load
      weatherAtSlot: CLEAR_WEATHER,
    });

    const next = evolver.evolve(s, slot, ctx);

    expect(next.fatigue).toBeLessThan(s.fatigue);
  });

  it('decreases fatigue more for a rest slot than a meal slot', () => {
    const s = makeState({ fatigue: 0.5 });
    const baseCtx = makeCtx({
      travelTimeMin: 0,
      actualDurationMin: 60,
      place: makePlace({ terrainEasiness: 1.0 }),
      weatherAtSlot: CLEAR_WEATHER,
    });

    const mealSlot = makeSlot({ activityType: 'meal' });
    const restSlot = makeSlot({ activityType: 'rest' });

    const afterMeal = evolver.evolve(s, mealSlot, baseCtx);
    const afterRest = evolver.evolve(s, restSlot, baseCtx);

    expect(afterRest.fatigue).toBeLessThan(afterMeal.fatigue);
  });

  it('clamps fatigue to 0 when it would go below 0', () => {
    // Rest slot with low starting fatigue can produce negative delta
    const s = makeState({ fatigue: 0.05 });
    const slot = makeSlot({ activityType: 'rest' });
    const ctx = makeCtx({
      travelTimeMin: 0,
      actualDurationMin: 60,
      place: makePlace({ terrainEasiness: 1.0 }),
    });

    const next = evolver.evolve(s, slot, ctx);

    expect(next.fatigue).toBeGreaterThanOrEqual(0);
  });

  it('clamps fatigue to 1 when it would exceed 1', () => {
    // Start near cap, heavy travel + hard outdoor terrain should push past 1
    const s = makeState({ fatigue: 0.9 });
    const slot = makeSlot({ activityType: 'sightseeing' });
    const ctx = makeCtx({
      travelTimeMin: 300,                              // 5 h travel → travelLoad = 2.5
      actualDurationMin: 180,                          // 3 h visit
      place: makePlace({ terrainEasiness: 0.0, indoorOutdoor: 'outdoor' }),
      weatherAtSlot: HEAVY_RAIN,
    });

    const next = evolver.evolve(s, slot, ctx);

    expect(next.fatigue).toBeLessThanOrEqual(1);
  });

  it('increases moodProxy when preferenceVector matches place tags', () => {
    // User has interest in tag 3; place has tag 3 → interestMatch = 1
    const prefVec = new Array(10).fill(0);
    prefVec[2] = 1; // tagId 3
    const user = makeUser(prefVec);

    const place = makePlace({
      tags: [{ tagId: 3, name: 'culture', displayName: 'Văn hóa' }],
    });

    const s = makeState({ moodProxy: 0.5 });
    const ctx = makeCtx({
      user,
      place,
      travelTimeMin: 0,
      actualDurationMin: 60,
      weatherAtSlot: CLEAR_WEATHER,
    });

    const next = evolver.evolve(s, makeSlot(), ctx);

    // moodDelta = 0.08 × 1 − 0 − 0 = +0.08
    expect(next.moodProxy).toBeGreaterThan(s.moodProxy);
  });

  it('does not increase moodProxy when place has no matching tags', () => {
    // User is interested in tag 1; place has no tags → interestMatch = 0
    const prefVec = new Array(10).fill(0);
    prefVec[0] = 1;
    const user = makeUser(prefVec);
    const place = makePlace({ tags: [] });

    const s = makeState({ moodProxy: 0.5, fatigue: 0.2 });
    const ctx = makeCtx({ user, place, travelTimeMin: 0, actualDurationMin: 60 });

    const next = evolver.evolve(s, makeSlot(), ctx);

    // moodDelta = 0 − fatiguePenalty(0.2≤0.7→0) − 0 = 0 → mood unchanged
    expect(next.moodProxy).toBeCloseTo(s.moodProxy, 5);
  });

  it('preserves purity: same inputs always produce the same output', () => {
    const s = makeState();
    const slot = makeSlot();
    const ctx = makeCtx({ travelTimeMin: 15, actualDurationMin: 45 });

    const result1 = evolver.evolve(s, slot, ctx);
    const result2 = evolver.evolve(s, slot, ctx);

    // All numeric fields must be identical
    expect(result1.timeRemainingMin).toBe(result2.timeRemainingMin);
    expect(result1.budgetRemaining).toBe(result2.budgetRemaining);
    expect(result1.fatigue).toBe(result2.fatigue);
    expect(result1.moodProxy).toBe(result2.moodProxy);
    expect(result1.slotOrder).toBe(result2.slotOrder);
    expect(result1.currentLat).toBe(result2.currentLat);
    expect(result1.currentLng).toBe(result2.currentLng);
  });

  it('does not mutate the original state', () => {
    const s = makeState({ timeRemainingMin: 480, budgetRemaining: 500_000 });
    const frozen = Object.freeze({ ...s }); // shallow freeze

    evolver.evolve(frozen as TripState, makeSlot(), makeCtx());

    // If evolve had mutated s, the frozen copy would throw — reaching here means purity held.
    expect(frozen.timeRemainingMin).toBe(480);
    expect(frozen.budgetRemaining).toBe(500_000);
  });

  it('increments slotOrder by 1', () => {
    const s = makeState({ slotOrder: 4 });
    const next = evolver.evolve(s, makeSlot(), makeCtx());
    expect(next.slotOrder).toBe(5);
  });

  it('updates currentLat/Lng to the visited place coordinates', () => {
    const place = makePlace({ lat: 16.0003, lng: 108.2600 });
    const ctx = makeCtx({ place });

    const next = evolver.evolve(makeState(), makeSlot(), ctx);

    expect(next.currentLat).toBe(16.0003);
    expect(next.currentLng).toBe(108.2600);
  });

  it('sets source to "simulated"', () => {
    const s = makeState({ source: 'planned' });
    const next = evolver.evolve(s, makeSlot(), makeCtx());
    expect(next.source).toBe('simulated');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: isFeasible()
// ---------------------------------------------------------------------------

describe('StateEvolver.isFeasible', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  it('returns true for a healthy state', () => {
    const s = makeState({ timeRemainingMin: 60, budgetRemaining: 100_000, fatigue: 0.5 });
    expect(evolver.isFeasible(s)).toBe(true);
  });

  it('returns false when budgetRemaining < 0', () => {
    const s = makeState({ budgetRemaining: -1 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('returns false when timeRemainingMin < 0', () => {
    const s = makeState({ timeRemainingMin: -1 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('returns false when fatigue > 0.95 (FATIGUE_CAP)', () => {
    const s = makeState({ fatigue: 0.96 });
    expect(evolver.isFeasible(s)).toBe(false);
  });

  it('returns true when fatigue equals exactly 0.95', () => {
    const s = makeState({ fatigue: 0.95 });
    expect(evolver.isFeasible(s)).toBe(true);
  });

  it('returns true when budgetRemaining and timeRemainingMin are both 0', () => {
    const s = makeState({ timeRemainingMin: 0, budgetRemaining: 0, fatigue: 0.5 });
    expect(evolver.isFeasible(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: estimateTravelTime()
// ---------------------------------------------------------------------------

describe('StateEvolver.estimateTravelTime', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  it('returns 0 for identical coordinates', () => {
    const t = evolver.estimateTravelTime(16.0614, 108.2273, 16.0614, 108.2273);
    expect(t).toBe(0);
  });

  it('Cầu Rồng → Bảo tàng Điêu khắc Chăm ≈ 1–5 min (short urban hop)', () => {
    // Cầu Rồng:        16.0614, 108.2273
    // Bảo tàng Chăm:   16.0603, 108.2235
    // Straight-line ≈ 0.42 km → formula gives ≈ 1.4 min
    const t = evolver.estimateTravelTime(16.0614, 108.2273, 16.0603, 108.2235);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(5);
  });

  it('Đà Nẵng trung tâm → Bà Nà Hills ≈ 60–120 min (mountain road, formula uses 25 km/h)', () => {
    // Đà Nẵng center:  16.0544, 108.2022
    // Bà Nà Hills:     15.9971, 107.9913
    // Straight-line ≈ 23 km → road-corrected ≈ 32 km → at 25 km/h ≈ 78 min
    const t = evolver.estimateTravelTime(16.0544, 108.2022, 15.9971, 107.9913);
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(120);
  });

  it('is symmetric: A→B equals B→A', () => {
    const t1 = evolver.estimateTravelTime(16.0614, 108.2273, 16.0603, 108.2235);
    const t2 = evolver.estimateTravelTime(16.0603, 108.2235, 16.0614, 108.2273);
    expect(t1).toBeCloseTo(t2, 8);
  });

  it('longer distance produces longer travel time', () => {
    const short = evolver.estimateTravelTime(16.0614, 108.2273, 16.0603, 108.2235); // ~0.4 km
    const long = evolver.estimateTravelTime(16.0544, 108.2022, 15.9971, 107.9913);  // ~23 km
    expect(long).toBeGreaterThan(short);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: computeTrajectory()
// ---------------------------------------------------------------------------

describe('StateEvolver.computeTrajectory', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  const place1 = makePlace({ placeId: 10, lat: 16.06, lng: 108.22 });
  const place2 = makePlace({ placeId: 20, lat: 16.07, lng: 108.23 });

  const slot1 = makeSlot({ slotId: 's1', placeId: 10, estimatedCost: 30_000 });
  const slot2 = makeSlot({ slotId: 's2', placeId: 20, estimatedCost: 50_000 });

  const ctx: ReplanContext = {
    candidatePool: [place1, place2],
    user: makeUser(),
    weatherBySlotId: {},
    defaultWeather: CLEAR_WEATHER,
    initialState: makeState({ budgetRemaining: 2_000_000, timeRemainingMin: 600 }),
  };

  it('returns array of length plan.length + 1 (includes initial state)', () => {
    const trajectory = evolver.computeTrajectory(
      [slot1, slot2],
      makeState(),
      ctx,
    );
    expect(trajectory).toHaveLength(3);
  });

  it('first element equals the initial state object', () => {
    const initial = makeState();
    const trajectory = evolver.computeTrajectory([slot1], initial, ctx);
    expect(trajectory[0]).toBe(initial);
  });

  it('budget decreases monotonically when all costs are positive', () => {
    const trajectory = evolver.computeTrajectory(
      [slot1, slot2],
      makeState({ budgetRemaining: 500_000 }),
      ctx,
    );
    expect(trajectory[1]!.budgetRemaining).toBeLessThan(trajectory[0]!.budgetRemaining);
    expect(trajectory[2]!.budgetRemaining).toBeLessThan(trajectory[1]!.budgetRemaining);
  });

  it('throws when a placeId is not in candidatePool', () => {
    const badSlot = makeSlot({ placeId: 999 });
    expect(() =>
      evolver.computeTrajectory([badSlot], makeState(), ctx),
    ).toThrow('placeId 999 not found in candidatePool');
  });

  it('returns only the initial state for an empty plan', () => {
    const initial = makeState();
    const trajectory = evolver.computeTrajectory([], initial, ctx);
    expect(trajectory).toHaveLength(1);
    expect(trajectory[0]).toBe(initial);
  });
});
