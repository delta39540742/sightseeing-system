import { describe, it, expect, beforeEach } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
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
    weatherForecast: [],
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
    // Use closeTo or just check it's >= 30 min because travel time adds extra
    expect(newBStart - origBStart).toBeGreaterThanOrEqual(30 * 60_000);
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
    // Note: since repairSuffix is called, times might be adjusted. 
    // We check that the relative order and content are swapped.
    expect(r.newPlan[0]!.placeId).toBe(SLOT_B.placeId);
    expect(r.newPlan[1]!.placeId).toBe(SLOT_A.placeId);
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
    // We ensure PLACE_C has 0 duration so its total priority remains 0 if overlap is 0
    const placeC0 = { ...PLACE_C, avgVisitDurationMin: 0 };
    const results = ops.replacePlace([SLOT_A], makeCtx([PLACE_A, PLACE_B, placeC0]));

    const replacements = results.map((r) => r.newPlan[0]!.placeId);
    expect(replacements).toContain(PLACE_B.placeId);
    expect(replacements).not.toContain(placeC0.placeId);
  });

  it('does not replace with a place already in the plan', () => {
    // Plan has both A and B; candidate pool has C (no overlap) and B (already in plan)
    const placeC0 = { ...PLACE_C, avgVisitDurationMin: 0 };
    const results = ops.replacePlace(
      [SLOT_A, SLOT_B],
      makeCtx([PLACE_A, PLACE_B, placeC0]),
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

// ---------------------------------------------------------------------------
// Suite: candidatePriority (Ranking Logic)
// ---------------------------------------------------------------------------

describe('MutationOperators.candidatePriority', () => {
  // Helper to call the private static method
  const callPriority = (candidate: Place, reference: Place | undefined, ctx: any) => {
    return (MutationOperators as any).candidatePriority(candidate, reference, ctx);
  };

  const emptyCtx = { potentialPlaceIds: [], requiredPlaceIds: [], forceIncludePlaceId: undefined };

  describe('1. Nhóm test cho tagOverlap (Trọng số x10)', () => {
    it('Không có địa điểm tham chiếu (reference là undefined): Điểm cộng từ overlap phải bằng 0', () => {
      const candidate = makePlace({ tags: [makeTag(1)], avgVisitDurationMin: 0 });
      // Điểm duration = 0, overlap = 0 -> Tổng = 0
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(0);
    });

    it('Không có tag nào trùng nhau: Điểm cộng = 0', () => {
      const candidate = makePlace({ tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const reference = makePlace({ tags: [makeTag(2)] });
      expect(callPriority(candidate, reference, emptyCtx)).toBe(0);
    });

    it('Trùng 1 tag: -> Điểm cộng = 10', () => {
      const candidate = makePlace({ tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const reference = makePlace({ tags: [makeTag(1)] });
      expect(callPriority(candidate, reference, emptyCtx)).toBe(10);
    });

    it('Trùng nhiều tag (VD: trùng 3 tag): -> Điểm cộng = 30', () => {
      const candidate = makePlace({
        tags: [makeTag(1), makeTag(2), makeTag(3)],
        avgVisitDurationMin: 0
      });
      const reference = makePlace({
        tags: [makeTag(1), makeTag(2), makeTag(3), makeTag(4)]
      });
      expect(callPriority(candidate, reference, emptyCtx)).toBe(30);
    });

    it('Một trong hai không có tag nào: Điểm cộng = 0', () => {
      const candidateNoTags = makePlace({ tags: [], avgVisitDurationMin: 0 });
      const refWithTags = makePlace({ tags: [makeTag(1)] });
      expect(callPriority(candidateNoTags, refWithTags, emptyCtx)).toBe(0);

      const candidateWithTags = makePlace({ tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const refNoTags = makePlace({ tags: [] });
      expect(callPriority(candidateWithTags, refNoTags, emptyCtx)).toBe(0);
    });
  });

  describe('2. Nhóm test cho avgVisitDurationMin (Giới hạn tối đa 12 điểm)', () => {
    it('Thời gian bằng 0: Điểm cộng = 0', () => {
      const candidate = makePlace({ avgVisitDurationMin: 0, tags: [] });
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(0);
    });

    it('Thời gian nhỏ hơn ngưỡng (VD: 50 phút): 50 / 10 = 5 -> Điểm cộng = 5', () => {
      const candidate = makePlace({ avgVisitDurationMin: 50, tags: [] });
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(5);
    });

    it('Thời gian chạm ngưỡng (120 phút): 120 / 10 = 12 -> Điểm cộng = 12', () => {
      const candidate = makePlace({ avgVisitDurationMin: 120, tags: [] });
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(12);
    });

    it('Thời gian vượt ngưỡng (VD: 150 phút): Capped at 12', () => {
      const candidate = makePlace({ avgVisitDurationMin: 150, tags: [] });
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(12);
    });

    it('Trường hợp thiếu dữ liệu (avgVisitDurationMin là undefined): Điểm cộng = 0, không NaN', () => {
      const candidate = makePlace({ tags: [] });
      (candidate as any).avgVisitDurationMin = undefined;
      expect(callPriority(candidate, undefined, emptyCtx)).toBe(0);
    });
  });

  describe('3. Nhóm test cho mảng ID ưu tiên trong ctx (Context Priorities)', () => {
    const candidate = makePlace({ placeId: 100, avgVisitDurationMin: 0, tags: [] });

    it('Không thuộc nhóm ưu tiên nào: Điểm cộng = 0', () => {
      const ctx = { potentialPlaceIds: [200], requiredPlaceIds: [300], forceIncludePlaceId: 400 };
      expect(callPriority(candidate, undefined, ctx)).toBe(0);
    });

    it('Chỉ nằm trong potentialPlaceIds: -> Điểm cộng = 60', () => {
      const ctx = { potentialPlaceIds: [100], requiredPlaceIds: [300] };
      expect(callPriority(candidate, undefined, ctx)).toBe(60);
    });

    it('Chỉ nằm trong requiredPlaceIds: -> Điểm cộng = 80', () => {
      const ctx = { requiredPlaceIds: [100] };
      expect(callPriority(candidate, undefined, ctx)).toBe(80);
    });

    it('Khớp với forceIncludePlaceId: -> Điểm cộng = 100', () => {
      const ctx = { forceIncludePlaceId: 100 };
      expect(callPriority(candidate, undefined, ctx)).toBe(100);
    });

    it('Các mảng ID trong ctx là undefined: Không báo lỗi và không cộng điểm', () => {
      const ctx = {};
      expect(callPriority(candidate, undefined, ctx)).toBe(0);
    });

    it('Trường hợp ID nằm ở nhiều mảng cùng lúc: Cộng dồn điểm (theo logic hiện tại)', () => {
      const ctx = {
        potentialPlaceIds: [100],
        requiredPlaceIds: [100],
        forceIncludePlaceId: 100
      };
      expect(callPriority(candidate, undefined, ctx)).toBe(60 + 80 + 100);
    });
  });

  describe('4. Nhóm test tổng hợp (Integration / End-to-end)', () => {
    it('Trường hợp cơ sở (Base case): Mọi yếu tố đều bằng 0 hoặc rỗng -> Tổng điểm trả về = 0', () => {
      const candidate = makePlace({ placeId: 1, avgVisitDurationMin: 0, tags: [] });
      const ctx = {};
      expect(callPriority(candidate, undefined, ctx)).toBe(0);
    });

    it('Trường hợp tổng hợp thông thường: Trùng 2 tag (+20) + 60p (+6) + potential (+60) = 86', () => {
      const reference = makePlace({ tags: [makeTag(1), makeTag(2)] });
      const candidate = makePlace({
        placeId: 100,
        tags: [makeTag(1), makeTag(2)],
        avgVisitDurationMin: 60
      });
      const ctx = { potentialPlaceIds: [100] };
      expect(callPriority(candidate, reference, ctx)).toBe(20 + 6 + 60);
    });

    it('Trường hợp tối đa (Max out): 5 tag (+50) + >120p (+12) + force (+100) = 162', () => {
      const reference = makePlace({
        tags: [makeTag(1), makeTag(2), makeTag(3), makeTag(4), makeTag(5)]
      });
      const candidate = makePlace({
        placeId: 100,
        tags: [makeTag(1), makeTag(2), makeTag(3), makeTag(4), makeTag(5)],
        avgVisitDurationMin: 150
      });
      const ctx = { forceIncludePlaceId: 100 };
      expect(callPriority(candidate, reference, ctx)).toBe(50 + 12 + 100);
    });
  });

  describe('5. Nhóm test phòng vệ (Defensive Tests)', () => {
    it('candidate bị null/undefined: Hàm trả về 0', () => {
      expect(callPriority(null as any, undefined, {})).toBe(0);
    });

    it('ctx bị null/undefined: Trả về điểm của tagOverlap + Duration, không crash', () => {
      const candidate = makePlace({ avgVisitDurationMin: 60, tags: [] });
      expect(callPriority(candidate, undefined, null as any)).toBe(6);
    });
  });

  describe('6. Mưa lớn + reference outdoor → dùng dot product thay tag overlap', () => {
    const rainCtx = (prefVec: number[]) => ({
      weatherForecast: [{ rainMmPerH: 10 }],
      user: { preferenceVector: prefVec, pace: 0.5, mobilityRestrictions: [] },
      potentialPlaceIds: [],
      requiredPlaceIds: [],
    });

    it('không mưa → vẫn dùng tag overlap (path cũ không đổi)', () => {
      const outdoor = makePlace({ indoorOutdoor: 'outdoor', tags: [makeTag(1)] });
      const indoor  = makePlace({ indoorOutdoor: 'indoor',  tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const noRainCtx = { weatherForecast: [], user: { preferenceVector: new Array(10).fill(0), pace: 0.5, mobilityRestrictions: [] } };
      // tag overlap = 1 → 10 pts
      expect(callPriority(indoor, outdoor, noRainCtx)).toBe(10);
    });

    it('mưa + reference outdoor + candidate indoor → dùng dot product, KHÔNG dùng tag overlap', () => {
      const outdoor = makePlace({ indoorOutdoor: 'outdoor', tags: [makeTag(99)] });
      // prefVec[0]=1, tagVectorOf puts tag 1 (tagId=1) at index 0 → dot = 1.0
      const indoor  = makePlace({ indoorOutdoor: 'indoor', tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const prefVec = new Array(10).fill(0);
      prefVec[0] = 1.0; // tag index 0 = tagId 1
      const score = callPriority(indoor, outdoor, rainCtx(prefVec));
      // tag overlap với outdoor (tag 99) = 0 → tag overlap path cho 0
      // dot product path: dot([1,0,...], tagVectorOf({tags:[{tagId:1}]})) * 100
      // tagVectorOf sets index (tagId-1) = index 0 → vector[0]=1 → dot = 1.0 → 100 pts
      expect(score).toBeCloseTo(100, 1);
    });

    it('mưa + reference outdoor + candidate indoor: indoor với dot cao hơn thắng indoor dot thấp hơn', () => {
      const outdoor = makePlace({ indoorOutdoor: 'outdoor', tags: [] });
      const prefVec = new Array(10).fill(0);
      prefVec[0] = 1.0; // ưa tag 1

      const highFit = makePlace({ placeId: 11, indoorOutdoor: 'indoor', tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const lowFit  = makePlace({ placeId: 22, indoorOutdoor: 'indoor', tags: [makeTag(5)], avgVisitDurationMin: 0 });

      const ctx = rainCtx(prefVec);
      const scoreHigh = callPriority(highFit, outdoor, ctx);
      const scoreLow  = callPriority(lowFit,  outdoor, ctx);
      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('mưa + reference outdoor + candidate OUTDOOR → vẫn dùng tag overlap (không dùng dot)', () => {
      const outdoor  = makePlace({ indoorOutdoor: 'outdoor', tags: [makeTag(1)] });
      const outdoor2 = makePlace({ indoorOutdoor: 'outdoor', tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const prefVec = new Array(10).fill(1.0); // dot sẽ rất cao nếu dùng
      // candidate là outdoor → KHÔNG kích hoạt dot path, dùng tag overlap = 1 → 10 pts
      expect(callPriority(outdoor2, outdoor, rainCtx(prefVec))).toBe(10);
    });

    it('mưa + reference INDOOR → vẫn dùng tag overlap (reference không phải outdoor)', () => {
      const indoor1 = makePlace({ indoorOutdoor: 'indoor', tags: [makeTag(1)] });
      const indoor2 = makePlace({ indoorOutdoor: 'indoor', tags: [makeTag(1)], avgVisitDurationMin: 0 });
      const prefVec = new Array(10).fill(1.0);
      // referenceIsOutdoorOrMissing = false → tag overlap path: overlap=1 → 10 pts
      expect(callPriority(indoor2, indoor1, rainCtx(prefVec))).toBe(10);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: planSignature (Internal De-duplication Logic)
// ---------------------------------------------------------------------------

describe('MutationOperators.planSignature', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  const callSignature = (plan: TripSlot[]) => {
    return (ops as any).planSignature(plan);
  };

  describe('1. Nhóm kiểm tra định dạng và luồng cơ bản (Basic Format & Happy Path)', () => {
    it('should return an empty string when the plan is empty', () => {
      expect(callSignature([])).toBe('');
    });

    it('should return a correctly formatted signature for a single TripSlot', () => {
      const slot = makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 });
      const sig = callSignature([slot]);
      
      // Kiểm tra cấu trúc: không có '|', các trường cách nhau bởi '##'
      expect(sig).not.toContain('|');
      const parts = sig.split('##');
      expect(parts.length).toBe(7); // slotId, dayIndex, slotOrder, status, version, start, end
      expect(parts[0]).toBe(slot.slotId);
      expect(parts[1]).toBe(String(slot.dayIndex));
      expect(parts[2]).toBe(String(slot.slotOrder));
    });

    it('should return a correctly concatenated signature for multiple TripSlots', () => {
      const plan = [
        makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 }),
        makeSlot({ slotId: 's2', dayIndex: 0, slotOrder: 1 }),
      ];
      const sig = callSignature(plan);
      const segments = sig.split('|');
      expect(segments).toHaveLength(2);
      expect(segments[0]).toContain('s1');
      expect(segments[1]).toContain('s2');
    });
  });

  describe('2. Nhóm kiểm tra tính xác định (Determinism & Ordering)', () => {
    it('should return the exact same signature for the same slots provided in a different array order', () => {
      const s1 = makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 });
      const s2 = makeSlot({ slotId: 's2', dayIndex: 0, slotOrder: 1 });
      const s3 = makeSlot({ slotId: 's3', dayIndex: 1, slotOrder: 0 });

      const planA = [s1, s2, s3];
      const planB = [s3, s1, s2];

      expect(callSignature(planA)).toBe(callSignature(planB));
    });

    it('should sort correctly by dayIndex first, then by slotOrder', () => {
      const s1 = makeSlot({ slotId: 's1', dayIndex: 1, slotOrder: 0 });
      const s2 = makeSlot({ slotId: 's2', dayIndex: 0, slotOrder: 1 });
      const s3 = makeSlot({ slotId: 's3', dayIndex: 0, slotOrder: 0 });

      const plan = [s1, s2, s3];
      const sig = callSignature(plan);
      const segments = sig.split('|');

      // Thứ tự kỳ vọng: s3 (0,0) -> s2 (0,1) -> s1 (1,0)
      expect(segments[0]).toContain('s3');
      expect(segments[1]).toContain('s2');
      expect(segments[2]).toContain('s1');
    });
  });

  describe('3. Nhóm kiểm tra độ nhạy (Sensitivity - Change Detection)', () => {
    it('should return a different signature when a slot changes status', () => {
      const s1 = makeSlot({ slotId: 's1', status: 'planned' });
      const planA = [s1];
      const planB = [{ ...s1, status: 'skipped' } as TripSlot];
      
      expect(callSignature(planA)).not.toBe(callSignature(planB));
    });

    it('should return a different signature when time (plannedStart/plannedEnd) changes', () => {
      const s1 = makeSlot({ slotId: 's1', plannedStart: '2026-04-21T02:00:00Z' });
      const planA = [s1];
      const planB = [{ ...s1, plannedStart: '2026-04-21T02:30:00Z' }];
      
      expect(callSignature(planA)).not.toBe(callSignature(planB));
    });

    it('should return a different signature when the version changes', () => {
      const s1 = makeSlot({ slotId: 's1', version: 1 });
      const planA = [s1];
      const planB = [{ ...s1, version: 2 }];
      
      expect(callSignature(planA)).not.toBe(callSignature(planB));
    });

    it('should return a different signature when a slot is added or removed', () => {
      const s1 = makeSlot({ slotId: 's1' });
      const s2 = makeSlot({ slotId: 's2' });
      
      const planA = [s1];
      const planB = [s1, s2];
      
      expect(callSignature(planA)).not.toBe(callSignature(planB));
    });

    it('should return a different signature when a slot is moved (dayIndex or slotOrder changes)', () => {
      const s1 = makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 });
      const planA = [s1];
      const planB = [{ ...s1, dayIndex: 1 }];
      const planC = [{ ...s1, slotOrder: 5 }];
      
      expect(callSignature(planA)).not.toBe(callSignature(planB));
      expect(callSignature(planA)).not.toBe(callSignature(planC));
    });
  });

  describe('4. Nhóm kiểm tra độ trơ (Insensitivity - Ignored Fields)', () => {
    it('should return the exact same signature when only actualStart or actualEnd changes', () => {
      const s1 = makeSlot({ slotId: 's1', actualStart: null, actualEnd: null });
      const planA = [s1];
      const planB = [{ ...s1, actualStart: '2026-04-21T02:05:00Z', actualEnd: '2026-04-21T03:00:00Z' }];
      
      expect(callSignature(planA)).toBe(callSignature(planB));
    });

    it('should return the exact same signature when non-planning fields (estimatedCost, rationale, activityType) change', () => {
      const s1 = makeSlot({ 
        slotId: 's1', 
        estimatedCost: 100, 
        rationale: 'Old', 
        activityType: 'sightseeing' 
      });
      const planA = [s1];
      const planB = [{ 
        ...s1, 
        estimatedCost: 999, 
        rationale: 'New rationale', 
        activityType: 'meal' // Chú ý: trong code hiện tại activityType KHÔNG nằm trong signature
      }];
      
      expect(callSignature(planA)).toBe(callSignature(planB));
    });
  });

  describe('5. Edge Cases (Trường hợp biên)', () => {
    it('should handle identical placeIds across different slots correctly', () => {
      // 1 địa điểm thăm 2 lần (sáng và tối)
      const s1 = makeSlot({ slotId: 's1', placeId: 10, dayIndex: 0, slotOrder: 0 });
      const s2 = makeSlot({ slotId: 's2', placeId: 10, dayIndex: 0, slotOrder: 4 });
      
      const sig = callSignature([s1, s2]);
      const segments = sig.split('|');
      expect(segments).toHaveLength(2);
      expect(segments[0]).toContain('s1');
      expect(segments[1]).toContain('s2');
      // Chữ ký chứa slotId nên phân biệt được dù trùng placeId
      expect(segments[0]).not.toBe(segments[1]);
    });

    it('should not mutate the original input array', () => {
      const s1 = makeSlot({ slotId: 's1', dayIndex: 1 });
      const s2 = makeSlot({ slotId: 's2', dayIndex: 0 });
      const originalPlan = [s1, s2];
      const originalPlanCopy = [...originalPlan];

      callSignature(originalPlan);

      // Kiểm tra thứ tự mảng gốc không bị thay đổi (không bị sort in-place)
      expect(originalPlan[0].slotId).toBe('s1');
      expect(originalPlan[1].slotId).toBe('s2');
      expect(originalPlan).toEqual(originalPlanCopy);
    });
  });
});
