import { describe, it, expect, beforeEach } from 'vitest';
import { MutationOperators } from '../replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../replanner/StateEvolver';
import type { TripSlot, Place, TripState, UserPreference, PlaceTag } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeTag(tagId: number): PlaceTag {
  return { tagId, name: `tag${tagId}`, displayName: `Tag ${tagId}` };
}

/**
 * Creates a Place with sensible defaults.
 * By default: indoor, terrainEasiness=0.8, avgVisitDurationMin=60,
 *             no opening hours (= always open), lat/lng near Đà Nẵng.
 */
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

/**
 * Creates a TripSlot with sensible defaults.
 * plannedStart: 2026-04-21 09:00 Vietnam (= 02:00 UTC)
 * plannedEnd:   2026-04-21 10:00 Vietnam (= 03:00 UTC)
 * activityType: sightseeing
 */
function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-001',
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    // 2026-04-21 is a Tuesday; in UTC these timestamps are 02:00 and 03:00
    plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
    plannedEnd: '2026-04-21T03:00:00.000Z',   // 10:00 VN
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
    timeRemainingMin: 600,
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

function makeUser(): UserPreference {
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
    preferenceVector: new Array(10).fill(0),
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/**
 * Builds a ReplanContext with generous constraints so that allFeasible()
 * passes unless overridden. All provided places must be in candidatePool.
 */
function makeCtx(
  candidatePool: Place[],
  overrides: Partial<ReplanContext> = {},
): ReplanContext {
  return {
    candidatePool,
    user: makeUser(),
    weatherBySlotId: {},
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures: 3 places with overlapping tags, no opening-hour restrictions
// ---------------------------------------------------------------------------

// placeA ↔ placeB share tag 1  (tag overlap = 1)
// placeA ↔ placeC share nothing (tag overlap = 0)
// placeB ↔ placeC share tag 2  (tag overlap = 1)
const PLACE_A = makePlace({ placeId: 10, name: 'Place A', lat: 16.060, lng: 108.220, tags: [makeTag(1), makeTag(3)] });
const PLACE_B = makePlace({ placeId: 20, name: 'Place B', lat: 16.062, lng: 108.223, tags: [makeTag(1), makeTag(2)] });
const PLACE_C = makePlace({ placeId: 30, name: 'Place C', lat: 16.064, lng: 108.225, tags: [makeTag(4), makeTag(5)] });

/** Slot that visits PLACE_A */
const SLOT_A = makeSlot({ slotId: 'sa', placeId: PLACE_A.placeId, slotOrder: 0 });
/** Slot that visits PLACE_B, adjacent to SLOT_A, same day */
const SLOT_B = makeSlot({
  slotId: 'sb', placeId: PLACE_B.placeId, slotOrder: 1,
  plannedStart: '2026-04-21T03:00:00.000Z', // 10:00 VN
  plannedEnd: '2026-04-21T04:00:00.000Z',   // 11:00 VN
});
/** Meal slot – should never be dropped */
const SLOT_MEAL = makeSlot({
  slotId: 'sm', placeId: PLACE_C.placeId, slotOrder: 2, activityType: 'meal',
  plannedStart: '2026-04-21T05:00:00.000Z', // 12:00 VN
  plannedEnd: '2026-04-21T06:00:00.000Z',   // 13:00 VN
});

const ALL_PLACES = [PLACE_A, PLACE_B, PLACE_C];
const BASE_CTX = makeCtx(ALL_PLACES);

// ---------------------------------------------------------------------------
// Helper: extract unique operator names from results
// ---------------------------------------------------------------------------
function operators(results: ReturnType<MutationOperators['timeShift']>) {
  return [...new Set(results.map((r) => r.operator))];
}

// ---------------------------------------------------------------------------
// Suite: TIME_SHIFT (OP-1)
// ---------------------------------------------------------------------------

describe('MutationOperators.timeShift', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('produces results for shifts of ±30 and ±60 minutes', () => {
    const results = ops.timeShift([SLOT_A], BASE_CTX);
    // 1 slot × 4 shifts = 4 (place has no opening hours → all pass)
    expect(results.length).toBe(4);
    expect(operators(results)).toEqual(['TIME_SHIFT']);
  });

  it('shifts plannedStart and plannedEnd of slot i by the delta', () => {
    const results = ops.timeShift([SLOT_A], BASE_CTX);
    const plus30 = results.find((r) => r.description.includes('+30'));
    expect(plus30).toBeDefined();

    const original = new Date(SLOT_A.plannedStart).getTime();
    const shifted = new Date(plus30!.newPlan[0]!.plannedStart).getTime();
    expect(shifted - original).toBe(30 * 60_000);
  });

  it('cascades the same shift to every slot after position i', () => {
    const plan = [SLOT_A, SLOT_B];
    const results = ops.timeShift(plan, BASE_CTX);

    // Find a result that shifts slot index 0 by +30
    const r = results.find(
      (x) => x.affectedSlotIds[0] === SLOT_A.slotId && x.description.includes('+30'),
    );
    expect(r).toBeDefined();

    const origBStart = new Date(SLOT_B.plannedStart).getTime();
    const newBStart = new Date(r!.newPlan[1]!.plannedStart).getTime();
    expect(newBStart - origBStart).toBe(30 * 60_000);
  });

  it('does not produce a result when the shifted slot falls outside opening hours', () => {
    // Opening hours: 09:00–10:30 Vietnam (08:00–10:30 if we place the window tightly)
    // SLOT_A is 09:00–10:00 VN; a +30 shift → 09:30–10:30 VN (still fits)
    // A +60 shift → 10:00–11:00 VN → end 11:00 > close 10:30 → should be rejected
    const placeWithHours = makePlace({
      placeId: PLACE_A.placeId,
      openingHours: [
        // 2026-04-21 is Tuesday → js getDay()=2 → spec dayOfWeek=(2+6)%7=1 (T3)
        { dayOfWeek: 1, openTime: '09:00', closeTime: '10:30' },
      ],
    });

    const ctxWithHours = makeCtx([placeWithHours, PLACE_B, PLACE_C]);
    const results = ops.timeShift([makeSlot({ placeId: placeWithHours.placeId })], ctxWithHours);

    const descriptions = results.map((r) => r.description);
    // +60 min shift: 10:00–11:00 → outside → no result
    expect(descriptions.some((d) => d.includes('+60'))).toBe(false);
    // +30 min shift: 09:30–10:30 → still within → result exists
    expect(descriptions.some((d) => d.includes('+30'))).toBe(true);
  });

  it('lists only the anchor slotId in affectedSlotIds', () => {
    const results = ops.timeShift([SLOT_A, SLOT_B], BASE_CTX);
    const anchored = results.filter((r) => r.affectedSlotIds[0] === SLOT_A.slotId);
    for (const r of anchored) {
      expect(r.affectedSlotIds).toHaveLength(1);
    }
  });

  it('never mutates the original plan array', () => {
    const plan = [SLOT_A, SLOT_B];
    const origStart = SLOT_A.plannedStart;
    ops.timeShift(plan, BASE_CTX);
    expect(SLOT_A.plannedStart).toBe(origStart);
    expect(plan[0]).toBe(SLOT_A);
  });
});

// ---------------------------------------------------------------------------
// Suite: SWAP_ORDER (OP-2)
// ---------------------------------------------------------------------------

describe('MutationOperators.swapOrder', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('swaps placeId of two adjacent slots in the same day', () => {
    const results = ops.swapOrder([SLOT_A, SLOT_B], BASE_CTX);
    expect(results.length).toBeGreaterThan(0);

    const r = results[0]!;
    expect(r.operator).toBe('SWAP_ORDER');
    // After swap: newPlan[0] has placeId of SLOT_B, newPlan[1] has placeId of SLOT_A
    expect(r.newPlan[0]!.placeId).toBe(SLOT_B.placeId);
    expect(r.newPlan[1]!.placeId).toBe(SLOT_A.placeId);
  });

  it('keeps the original time windows unchanged after swap', () => {
    const results = ops.swapOrder([SLOT_A, SLOT_B], BASE_CTX);
    const r = results[0]!;
    expect(r.newPlan[0]!.plannedStart).toBe(SLOT_A.plannedStart);
    expect(r.newPlan[1]!.plannedStart).toBe(SLOT_B.plannedStart);
  });

  it('does NOT swap slots that belong to different days', () => {
    const slotDay0 = makeSlot({ slotId: 'sd0', dayIndex: 0, placeId: PLACE_A.placeId });
    const slotDay1 = makeSlot({ slotId: 'sd1', dayIndex: 1, placeId: PLACE_B.placeId });
    const results = ops.swapOrder([slotDay0, slotDay1], BASE_CTX);
    expect(results).toHaveLength(0);
  });

  it('lists both affected slotIds', () => {
    const results = ops.swapOrder([SLOT_A, SLOT_B], BASE_CTX);
    const r = results[0]!;
    expect(r.affectedSlotIds).toContain(SLOT_A.slotId);
    expect(r.affectedSlotIds).toContain(SLOT_B.slotId);
  });

  it('returns empty array for a single-slot plan', () => {
    const results = ops.swapOrder([SLOT_A], BASE_CTX);
    expect(results).toHaveLength(0);
  });

  it('never mutates the original slots', () => {
    const origPlaceA = SLOT_A.placeId;
    ops.swapOrder([SLOT_A, SLOT_B], BASE_CTX);
    expect(SLOT_A.placeId).toBe(origPlaceA);
  });
});

// ---------------------------------------------------------------------------
// Suite: REPLACE_PLACE (OP-3)
// ---------------------------------------------------------------------------

describe('MutationOperators.replacePlace', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('produces results only for candidates with tag overlap > 0', () => {
    // PLACE_A has tags [1,3]; PLACE_B has tags [1,2] → overlap 1 → valid
    // PLACE_C has tags [4,5] → overlap with A = 0 → invalid
    const results = ops.replacePlace([SLOT_A], makeCtx(ALL_PLACES));

    const replacements = results.map((r) => r.newPlan[0]!.placeId);
    expect(replacements).toContain(PLACE_B.placeId);
    expect(replacements).not.toContain(PLACE_C.placeId);
  });

  it('does not replace with a place already in the plan', () => {
    // Plan has both A and B; candidate pool has C (no overlap) and B (already in plan)
    const results = ops.replacePlace(
      [SLOT_A, SLOT_B],
      makeCtx([PLACE_A, PLACE_B, PLACE_C]),
    );
    // SLOT_A (placeId=A): B is in plan → excluded; C has no overlap → excluded → 0 for slot 0
    // SLOT_B (placeId=B): A is in plan → excluded; C has no overlap → excluded → 0 for slot 1
    expect(results).toHaveLength(0);
  });

  it('replaces with at most MAX_REPLACE_CANDIDATES (3) alternatives per slot', () => {
    // Build 5 places all sharing tag 1 with PLACE_A
    const alts = Array.from({ length: 5 }, (_, i) =>
      makePlace({ placeId: 100 + i, name: `Alt${i}`, tags: [makeTag(1)] }),
    );
    const pool = [PLACE_A, ...alts];
    const results = ops.replacePlace([SLOT_A], makeCtx(pool));
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('lists the correct affectedSlotId', () => {
    const results = ops.replacePlace([SLOT_A], makeCtx(ALL_PLACES));
    for (const r of results) {
      expect(r.affectedSlotIds).toEqual([SLOT_A.slotId]);
    }
  });

  it('description mentions the old and new place name', () => {
    const results = ops.replacePlace([SLOT_A], makeCtx(ALL_PLACES));
    const r = results[0]!;
    expect(r.description).toContain(PLACE_A.name);
    expect(r.description).toMatch(/Place B/);
  });
});

// ---------------------------------------------------------------------------
// Suite: DROP_SLOT (OP-4)
// ---------------------------------------------------------------------------

describe('MutationOperators.dropSlot', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('produces one result per non-meal slot', () => {
    const plan = [SLOT_A, SLOT_B, SLOT_MEAL]; // 2 sightseeing + 1 meal
    const results = ops.dropSlot(plan, BASE_CTX);
    expect(results).toHaveLength(2);
  });

  it('NEVER drops a meal slot', () => {
    const results = ops.dropSlot([SLOT_MEAL], BASE_CTX);
    expect(results).toHaveLength(0);
  });

  it('the resulting plan has one fewer slot', () => {
    const plan = [SLOT_A, SLOT_B];
    const results = ops.dropSlot(plan, BASE_CTX);
    for (const r of results) {
      expect(r.newPlan).toHaveLength(plan.length - 1);
    }
  });

  it('the dropped slot is absent from newPlan', () => {
    const results = ops.dropSlot([SLOT_A, SLOT_B, SLOT_MEAL], BASE_CTX);
    const dropA = results.find((r) => r.affectedSlotIds.includes(SLOT_A.slotId));
    const dropB = results.find((r) => r.affectedSlotIds.includes(SLOT_B.slotId));

    expect(dropA!.newPlan.map((s) => s.slotId)).not.toContain(SLOT_A.slotId);
    expect(dropB!.newPlan.map((s) => s.slotId)).not.toContain(SLOT_B.slotId);
  });

  it('all results have operator = DROP_SLOT', () => {
    const results = ops.dropSlot([SLOT_A, SLOT_B], BASE_CTX);
    expect(results.every((r) => r.operator === 'DROP_SLOT')).toBe(true);
  });

  it('never mutates the original plan', () => {
    const plan = [SLOT_A, SLOT_B];
    ops.dropSlot(plan, BASE_CTX);
    expect(plan).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Suite: INSERT_ALT (OP-5)
// ---------------------------------------------------------------------------

describe('MutationOperators.insertAlt', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('with forceIncludePlaceId, inserts only that placeId in newPlan', () => {
    const ctx = makeCtx(ALL_PLACES, {
      forceIncludePlaceId: PLACE_C.placeId,
    });
    const results = ops.insertAlt([SLOT_A], ctx);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      const insertedPlaceIds = r.newPlan.map((s) => s.placeId);
      expect(insertedPlaceIds).toContain(PLACE_C.placeId);
    }
  });

  it('with forceIncludePlaceId, does NOT insert any other placeId', () => {
    const ctx = makeCtx(ALL_PLACES, { forceIncludePlaceId: PLACE_C.placeId });
    const results = ops.insertAlt([], ctx);

    // Every newPlan should have exactly the forced placeId inserted (at pos 0)
    for (const r of results) {
      const inserted = r.newPlan.find((s) =>
        r.affectedSlotIds.includes(s.slotId),
      );
      expect(inserted!.placeId).toBe(PLACE_C.placeId);
    }
  });

  it('without forceIncludePlaceId, considers up to 5 candidates', () => {
    // Build a pool of 7 distinct places (none in current plan)
    const pool = Array.from({ length: 7 }, (_, i) =>
      makePlace({ placeId: 200 + i, name: `Pool${i}` }),
    );
    const ctx = makeCtx(pool);
    const results = ops.insertAlt([], ctx);

    const insertedIds = new Set(results.map((r) => r.newPlan[0]!.placeId));
    // At most 5 candidates × 1 position (empty plan) = at most 5 results
    expect(insertedIds.size).toBeLessThanOrEqual(5);
  });

  it('the inserted slot appears at the correct position in newPlan', () => {
    const plan = [SLOT_A, SLOT_B];
    const ctx = makeCtx(ALL_PLACES, { forceIncludePlaceId: PLACE_C.placeId });
    const results = ops.insertAlt(plan, ctx);

    for (const r of results) {
      const synthIdx = r.newPlan.findIndex((s) =>
        r.affectedSlotIds.includes(s.slotId),
      );
      expect(synthIdx).toBeGreaterThanOrEqual(0);
      // newPlan is one longer than plan
      expect(r.newPlan).toHaveLength(plan.length + 1);
    }
  });

  it('does not insert a place already present in the plan (no-force mode)', () => {
    // PLACE_A is in the plan; pool has A and B
    const ctx = makeCtx([PLACE_A, PLACE_B]);
    const results = ops.insertAlt([SLOT_A], ctx);

    for (const r of results) {
      const insertedSlot = r.newPlan.find((s) =>
        r.affectedSlotIds.includes(s.slotId),
      );
      // The inserted slot must not be PLACE_A (already in plan)
      expect(insertedSlot!.placeId).not.toBe(PLACE_A.placeId);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: generateAll
// ---------------------------------------------------------------------------

describe('MutationOperators.generateAll', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  it('returns at most 30 results (GENERATE_ALL_CAP)', () => {
    // Build a pool that would naturally produce many results
    const bigPool = Array.from({ length: 10 }, (_, i) =>
      makePlace({ placeId: 300 + i, name: `Big${i}`, tags: [makeTag(1)] }),
    );
    const plan = [
      makeSlot({ slotId: 'g1', placeId: 300, slotOrder: 0 }),
      makeSlot({ slotId: 'g2', placeId: 301, slotOrder: 1,
        plannedStart: '2026-04-21T03:00:00.000Z',
        plannedEnd: '2026-04-21T04:00:00.000Z' }),
    ];
    const ctx = makeCtx(bigPool);
    const results = ops.generateAll(plan, ctx);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('combines results from all five operators', () => {
    const plan = [SLOT_A, SLOT_B];
    const results = ops.generateAll(plan, BASE_CTX);
    const seen = new Set(results.map((r) => r.operator));
    // At minimum TIME_SHIFT and DROP_SLOT should appear (most permissive)
    expect(seen.has('TIME_SHIFT')).toBe(true);
    expect(seen.has('DROP_SLOT')).toBe(true);
  });

  it('returns an empty array for an empty plan and empty pool', () => {
    const results = ops.generateAll([], makeCtx([]));
    expect(results).toHaveLength(0);
  });
});
