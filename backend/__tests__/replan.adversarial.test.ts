/**
 * Adversarial bug-hunt suite for the replan engine.
 *
 * Each test below targets a hypothesis about a possible defect. The goal is
 * to keep adding cases until one fails — that's the bug to investigate.
 *
 * Hypotheses under test:
 *   H1. INSERT_ALT at pos=0 with capturedAt mid-afternoon must NOT produce a
 *       slot whose plannedStart < capturedAt nor a wrong dayIndex.
 *   H2. INSERT_ALT after a 'completed' prefix slot must place the new slot
 *       at or after capturedAt, even when prev.plannedEnd is BEFORE capturedAt.
 *   H3. REPLACE_PLACE on a single-day plan with a 1500-min replacement must
 *       NOT produce a result (overflows past maxAllowedDayIndex=0).
 *   H4. TSP_REORDER across a day whose only slots are completed must leave
 *       that day fully untouched (no slotOrder churn, no time shift).
 *   H5. TIME_SHIFT past guard: shifting an anchor that starts only 15 min after
 *       capturedAt by -30 must be filtered out (anchor would land in the past).
 *   H6. maxAllowedDayIndex shrinkage trap: when the input plan has dayIndex
 *       values {0,1}, a small mutation that legitimately fits within day 0–1
 *       must still succeed (sanity that we didn't accidentally tighten the bound).
 *   H7. DROP_SLOT immediately after a 'completed' prefix slot must produce a
 *       newPlan whose slotOrder is contiguous per day starting from 0 AND
 *       whose dayIndex is preserved for unrelated days.
 *   H8. SWAP_ORDER between two consecutive day-1 slots when day-0 has a
 *       completed slot must produce slotOrder {0,1} on day 1 (counter reset).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import type { TripSlot, Place, TripState, UserPreference, PlaceTag } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories (mirrors replan.bug-hunt.test.ts patterns)
// ---------------------------------------------------------------------------
function makeTag(tagId: number): PlaceTag {
  return { tagId, name: `tag${tagId}`, displayName: `Tag ${tagId}` };
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'P',
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
    slotId: `slot-${Math.random().toString(36).slice(2, 11)}`,
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

// Common pool: 5 short places at slightly different coords
const P1 = makePlace({ placeId: 1, name: 'P1', avgVisitDurationMin: 60, lat: 16.06, lng: 108.22 });
const P2 = makePlace({ placeId: 2, name: 'P2', avgVisitDurationMin: 60, lat: 16.07, lng: 108.23 });
const P3 = makePlace({ placeId: 3, name: 'P3', avgVisitDurationMin: 60, lat: 16.08, lng: 108.24, tags: [makeTag(1)] });
const P4 = makePlace({ placeId: 4, name: 'P4', avgVisitDurationMin: 60, lat: 16.09, lng: 108.25, tags: [makeTag(1)] });
const P5 = makePlace({ placeId: 5, name: 'P5', avgVisitDurationMin: 60, lat: 16.10, lng: 108.26 });
const ALL = [P1, P2, P3, P4, P5];

// VN offset helper
const VN = 7 * 60 * 60_000;
function vnMinutesOfDay(iso: string): number {
  const d = new Date(new Date(iso).getTime() + VN);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function vnCalendarDay(iso: string): number {
  return Math.floor((new Date(iso).getTime() + VN) / 86_400_000);
}

// ---------------------------------------------------------------------------
describe('replan adversarial bug-hunt', () => {
  let ops: MutationOperators;
  beforeEach(() => { ops = new MutationOperators(new StateEvolver()); });

  // -------------------------------------------------------------------------
  // H1: INSERT_ALT pos=0 with capturedAt in the afternoon
  // -------------------------------------------------------------------------
  describe('H1: INSERT_ALT pos=0 respects mid-day capturedAt', () => {
    it('inserted slot at pos=0 has plannedStart >= capturedAt and dayIndex matches its calendar day', () => {
      // Existing plan has one slot at 18:00 VN (already in the future, after capturedAt).
      const plan = [
        makeSlot({ slotId: 'next', placeId: 2, slotOrder: 0,
          plannedStart: '2026-04-21T11:00:00.000Z', // 18:00 VN
          plannedEnd:   '2026-04-21T12:00:00.000Z' }), // 19:00 VN
      ];
      const ctx = makeCtx(ALL, {
        forceIncludePlaceId: 1, // force P1 insertion
        initialState: makeState({
          capturedAt: '2026-04-21T10:30:00.000Z', // 17:30 VN, same day
        }),
      });
      const results = ops.insertAlt(plan, ctx);
      const r0 = results.find((r) => r.repairedFromIndex === 0);
      if (!r0) return; // no pos=0 insertion possible — separate concern

      const inserted = r0.newPlan[0]!;
      const startMs = new Date(inserted.plannedStart).getTime();
      const capturedMs = new Date(ctx.initialState.capturedAt).getTime();
      expect(
        startMs,
        `inserted plannedStart=${inserted.plannedStart} but capturedAt=${ctx.initialState.capturedAt}`
      ).toBeGreaterThanOrEqual(capturedMs);

      // dayIndex must match the calendar day of plannedStart relative to next
      const insertedCal = vnCalendarDay(inserted.plannedStart);
      const nextCal = vnCalendarDay(r0.newPlan[1]!.plannedStart);
      // If same calendar day as next, dayIndex should match next.dayIndex
      if (insertedCal === nextCal) {
        expect(inserted.dayIndex).toBe(r0.newPlan[1]!.dayIndex);
      }
    });
  });

  // -------------------------------------------------------------------------
  // H2: INSERT_ALT after completed slot whose end is BEFORE capturedAt
  // -------------------------------------------------------------------------
  describe('H2: INSERT_ALT after completed prefix slot honors capturedAt', () => {
    it('inserted slot starts at or after capturedAt even when prev.plannedEnd is in the past', () => {
      const plan = [
        makeSlot({ slotId: 'done', placeId: 1, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        forceIncludePlaceId: 2,
        initialState: makeState({ capturedAt: '2026-04-21T07:00:00.000Z' }), // 14:00 VN — long after 'done' ended
      });
      const results = ops.insertAlt(plan, ctx);
      // startPos should be 1 (after the completed slot), so inserts happen at pos>=1
      for (const r of results) {
        const inserted = r.newPlan.find((s) => s.placeId === 2);
        expect(inserted, 'P2 must be inserted somewhere').toBeDefined();
        const startMs = new Date(inserted!.plannedStart).getTime();
        const capturedMs = new Date(ctx.initialState.capturedAt).getTime();
        expect(
          startMs,
          `inserted plannedStart=${inserted!.plannedStart} BEFORE capturedAt=${ctx.initialState.capturedAt}`
        ).toBeGreaterThanOrEqual(capturedMs);
      }
    });
  });

  // -------------------------------------------------------------------------
  // H3: REPLACE_PLACE with megalong replacement on single-day plan
  // -------------------------------------------------------------------------
  describe('H3: REPLACE_PLACE single-day overflow is rejected by trip boundary', () => {
    it('replacing P1 with a 1500-min place must not produce results on a single-day plan', () => {
      const megaP9 = makePlace({ placeId: 9, name: 'Mega', avgVisitDurationMin: 1500, lat: 16.06, lng: 108.22 });
      const pool = [P1, P2, megaP9];

      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, slotOrder: 0, dayIndex: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(pool);

      const results = ops.replacePlace(plan, ctx);
      // A 1500-min slot (25h) cannot fit in any single day. Either no result,
      // or any result must NOT have a slot with placeId=9 spilling beyond day 0.
      for (const r of results) {
        const mega = r.newPlan.find((s) => s.placeId === 9);
        if (mega) {
          // If mega was placed, its dayIndex must be 0 AND it must fit before 22:30 VN.
          expect(mega.dayIndex).toBe(0);
          const endMin = vnMinutesOfDay(mega.plannedEnd);
          // A 25h slot cannot end before 22:30 VN of the same day — this should be impossible.
          expect(
            endMin,
            `mega slot dayIndex=${mega.dayIndex} ends at ${endMin} VN min — exceeds 22:30 within same day`
          ).toBeLessThanOrEqual(22 * 60 + 30);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // H4: TSP_REORDER skips a day with a 'completed' slot (preserves it)
  // -------------------------------------------------------------------------
  describe('H4: TSP_REORDER preserves day with completed slot, reorders other day only', () => {
    it('a day containing any completed slot is left untouched while another day may reorder', () => {
      // Day 0: one completed + two planned (TSP must NOT reorder day 0)
      // Day 1: three planned (TSP may reorder day 1)
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd0-far', placeId: 4, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
        makeSlot({ slotId: 'd0-near', placeId: 2, dayIndex: 0, slotOrder: 2,
          plannedStart: '2026-04-21T06:00:00.000Z', plannedEnd: '2026-04-21T07:00:00.000Z' }),
        // Day 1: three planned slots with non-optimal order
        makeSlot({ slotId: 'd1-far', placeId: 5, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1-near', placeId: 1, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T04:00:00.000Z', plannedEnd: '2026-04-22T05:00:00.000Z' }),
        makeSlot({ slotId: 'd1-mid', placeId: 3, dayIndex: 1, slotOrder: 2,
          plannedStart: '2026-04-22T06:00:00.000Z', plannedEnd: '2026-04-22T07:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }), // 10:30 VN, right after 'done'
      });
      const results = ops.tspReorder(plan, ctx);
      for (const r of results) {
        // Day 0 ordering must be unchanged: done(0) -> far(1) -> near(2) by slotId order
        const day0Sorted = r.newPlan
          .filter((s) => s.dayIndex === 0)
          .sort((a, b) => a.slotOrder - b.slotOrder)
          .map((s) => s.slotId);
        expect(
          day0Sorted,
          `TSP changed day-0 order despite a completed slot present`
        ).toEqual(['d0-done', 'd0-far', 'd0-near']);

        // Day-0 completed slot's plannedStart/End must be unchanged
        const done = r.newPlan.find((s) => s.slotId === 'd0-done');
        expect(done!.plannedStart).toBe('2026-04-21T02:00:00.000Z');
        expect(done!.plannedEnd).toBe('2026-04-21T03:00:00.000Z');
      }
    });
  });

  // -------------------------------------------------------------------------
  // H5: TIME_SHIFT past guard
  // -------------------------------------------------------------------------
  describe('H5: TIME_SHIFT past guard blocks shifts that land before capturedAt', () => {
    it('shifting anchor by -30 when anchor.plannedStart is only +15 from capturedAt produces no -30 variant', () => {
      const plan = [
        makeSlot({ slotId: 'anchor', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T07:15:00.000Z', // 14:15 VN
          plannedEnd:   '2026-04-21T08:15:00.000Z' }),
        makeSlot({ slotId: 'next', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T08:30:00.000Z',
          plannedEnd:   '2026-04-21T09:30:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T07:00:00.000Z' }), // 14:00 VN
      });
      const results = ops.timeShift(plan, ctx);
      const minus30 = results.find(
        (r) => r.affectedSlotIds[0] === 'anchor' && r.description.includes('-30')
      );
      expect(
        minus30,
        `−30 shift produced even though it lands anchor 15 min BEFORE capturedAt`
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // H6: Sanity — a small valid mutation on a 2-day plan must still be producible
  // -------------------------------------------------------------------------
  describe('H6: small mutation on multi-day plan still feasible (sanity)', () => {
    it('SWAP_ORDER on day 0 with day 1 untouched still works', () => {
      const plan = [
        makeSlot({ slotId: 'd0a', placeId: 1, dayIndex: 0, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd0b', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'd1a', placeId: 3, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
      ];
      const results = ops.swapOrder(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);
      // Day 1 slot must be untouched
      for (const r of results) {
        const d1 = r.newPlan.find((s) => s.slotId === 'd1a');
        expect(d1!.plannedStart).toBe('2026-04-22T02:00:00.000Z');
        expect(d1!.dayIndex).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // H7: DROP_SLOT after completed prefix preserves day-1 dayIndex
  // -------------------------------------------------------------------------
  describe('H7: DROP_SLOT after completed prefix preserves dayIndex on later days', () => {
    it('dropping a day-0 planned slot keeps day-1 slot at dayIndex=1', () => {
      const plan = [
        makeSlot({ slotId: 'done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'killme', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
        makeSlot({ slotId: 'd1', placeId: 3, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }), // 10:30 VN
      });
      const results = ops.dropSlot(plan, ctx);
      const drop = results.find((r) => r.affectedSlotIds[0] === 'killme');
      expect(drop, 'should produce a drop result for killme').toBeDefined();
      const d1 = drop!.newPlan.find((s) => s.slotId === 'd1');
      expect(d1, 'd1 must survive the drop').toBeDefined();
      expect(d1!.dayIndex, `d1 dayIndex changed after drop: was 1, became ${d1!.dayIndex}`).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // H8: SWAP_ORDER on day-1 slots when day-0 has a completed prefix
  // -------------------------------------------------------------------------
  describe('H8: SWAP_ORDER on day-1 slots when day-0 has completed prefix', () => {
    it('swapping the two day-1 slots produces contiguous slotOrders {0,1} on day 1', () => {
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1a', placeId: 2, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1b', placeId: 3, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T03:30:00.000Z', plannedEnd: '2026-04-22T04:30:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }),
      });
      const results = ops.swapOrder(plan, ctx);
      const swap = results.find((r) =>
        r.affectedSlotIds.includes('d1a') && r.affectedSlotIds.includes('d1b')
      );
      expect(swap, 'should produce a swap of the two day-1 slots').toBeDefined();
      const day1 = swap!.newPlan.filter((s) => s.dayIndex === 1);
      expect(day1.length).toBe(2);
      const orders = day1.map((s) => s.slotOrder).sort((a, b) => a - b);
      expect(
        orders,
        `day-1 slot orders after swap: ${orders.join(',')} — expected [0,1]`
      ).toEqual([0, 1]);
    });
  });

  // -------------------------------------------------------------------------
  // H10: INSERT_ALT with completed-day-0 prefix + day-1 suffix
  //      Variant of H7/H8 — does the dayIndex-squash bug also hit INSERT_ALT?
  // -------------------------------------------------------------------------
  describe('H10: INSERT_ALT into day-1 with completed day-0 prefix preserves dayIndex=1', () => {
    it('inserting between two day-1 planned slots keeps everything on day 1', () => {
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1a', placeId: 2, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1b', placeId: 3, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        forceIncludePlaceId: 4,
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }), // 10:30 VN
      });
      const results = ops.insertAlt(plan, ctx);
      for (const r of results) {
        const d1a = r.newPlan.find((s) => s.slotId === 'd1a');
        const d1b = r.newPlan.find((s) => s.slotId === 'd1b');
        expect(d1a!.dayIndex, `d1a dayIndex regressed to ${d1a!.dayIndex}`).toBe(1);
        expect(d1b!.dayIndex, `d1b dayIndex regressed to ${d1b!.dayIndex}`).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // H11: REPLACE_PLACE on a day-1 slot with completed day-0 prefix
  // -------------------------------------------------------------------------
  describe('H11: REPLACE_PLACE on day-1 keeps dayIndex=1 when prefix is day-0 completed', () => {
    it('replacing day-1 slot does not squash it onto day 0', () => {
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1-victim', placeId: 2, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z',
          tags: [makeTag(1)] }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }),
      });
      const results = ops.replacePlace(plan, ctx);
      for (const r of results) {
        const victim = r.newPlan.find((s) => s.slotId === 'd1-victim' || (s.placeId !== 1 && s.placeId !== 2));
        if (!victim) continue;
        // The replacement slot inherits 'd1-victim' slotId? Let me check by dayIndex.
        const dayOne = r.newPlan.filter((s) => s.slotId !== 'd0-done');
        for (const s of dayOne) {
          expect(s.dayIndex, `replaced day-1 slot squashed to dayIndex=${s.dayIndex}`).toBe(1);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // H12: TIME_SHIFT on day-1 slot with completed day-0 prefix
  // -------------------------------------------------------------------------
  describe('H12: TIME_SHIFT on day-1 slot preserves dayIndex=1 with completed day-0 prefix', () => {
    it('+60 shift on day-1 slot stays on day 1', () => {
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1-anchor', placeId: 2, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1-tail', placeId: 3, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }),
      });
      const results = ops.timeShift(plan, ctx);
      const shift = results.find(
        (r) => r.affectedSlotIds[0] === 'd1-anchor' && r.description.includes('+60')
      );
      if (!shift) return; // shift not produced is OK
      for (const s of shift.newPlan) {
        if (s.slotId === 'd0-done') continue;
        expect(s.dayIndex, `shifted/repaired ${s.slotId} squashed to ${s.dayIndex}`).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // H13: DROP_SLOT skipped-status prefix (mirror of H7 using 'skipped')
  // -------------------------------------------------------------------------
  describe('H13: DROP_SLOT after skipped prefix preserves dayIndex (parallel to H7)', () => {
    it('dropping a day-0 planned slot keeps day-1 slot at dayIndex=1 when prefix is skipped', () => {
      const plan = [
        makeSlot({ slotId: 'skipped', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'skipped',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'killme', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
        makeSlot({ slotId: 'd1', placeId: 3, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }),
      });
      const results = ops.dropSlot(plan, ctx);
      const drop = results.find((r) => r.affectedSlotIds[0] === 'killme');
      expect(drop, 'should produce a drop result for killme').toBeDefined();
      const d1 = drop!.newPlan.find((s) => s.slotId === 'd1');
      expect(d1!.dayIndex, `d1 dayIndex changed after drop: was 1, became ${d1!.dayIndex}`).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // H14: Multi-step day jump — prefix on day 0, suffix slot 1 originally on day 2 (skipping day 1)
  // -------------------------------------------------------------------------
  describe('H14: multi-step dayJump preserved (day-0 prefix, day-2 suffix)', () => {
    it('day-2 slot retains dayIndex=2 after DROP_SLOT on the day-0 mid slot', () => {
      const plan = [
        makeSlot({ slotId: 'd0-done', placeId: 1, dayIndex: 0, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd0-killme', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
        // dayIndex 2 (skipping 1) — multi-step jump
        makeSlot({ slotId: 'd2', placeId: 3, dayIndex: 2, slotOrder: 0,
          plannedStart: '2026-04-23T02:00:00.000Z', plannedEnd: '2026-04-23T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:30:00.000Z' }),
      });
      const results = ops.dropSlot(plan, ctx);
      const drop = results.find((r) => r.affectedSlotIds[0] === 'd0-killme');
      if (!drop) return;
      const d2 = drop.newPlan.find((s) => s.slotId === 'd2');
      expect(d2!.dayIndex, `d2 dayIndex regressed: expected 2, got ${d2!.dayIndex}`).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // H15: SWAP_ORDER day-1 with capturedAt BEFORE the trip starts
  //      (the original clamp-fix scenario — should still work)
  // -------------------------------------------------------------------------
  describe('H15: SWAP_ORDER works when capturedAt is the day BEFORE the trip', () => {
    it('day-0 slot preserves dayIndex=0 when capturedAt is yesterday', () => {
      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, dayIndex: 0, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'b', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-20T08:00:00.000Z' }), // day BEFORE trip
      });
      const results = ops.swapOrder(plan, ctx);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        for (const s of r.newPlan) {
          expect(s.dayIndex, `${s.slotId} dayIndex regressed to ${s.dayIndex}`).toBe(0);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // H9: INSERT_ALT — plannedEnd should match place.avgVisitDurationMin
  // -------------------------------------------------------------------------
  describe('H9: INSERT_ALT inserted slot duration matches place.avgVisitDurationMin', () => {
    it('forced insert of a 90-min place produces a slot with end-start = 90 min after repair', () => {
      const P90 = makePlace({ placeId: 7, name: '90min', avgVisitDurationMin: 90, lat: 16.06, lng: 108.22 });
      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'b', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];
      const ctx = makeCtx([P1, P2, P90], {
        forceIncludePlaceId: 7,
        placeMap: new Map([[1, P1], [2, P2], [7, P90]]),
      });
      const results = ops.insertAlt(plan, ctx);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const inserted = r.newPlan.find((s) => s.placeId === 7);
        expect(inserted, 'P7 must be inserted').toBeDefined();
        const durMin = (new Date(inserted!.plannedEnd).getTime() - new Date(inserted!.plannedStart).getTime()) / 60_000;
        expect(
          durMin,
          `inserted ${inserted!.slotId} has duration=${durMin}min, expected 90min`
        ).toBe(90);
      }
    });
  });
});
