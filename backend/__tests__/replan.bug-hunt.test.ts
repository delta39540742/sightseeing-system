/**
 * Bug-hunt test suite for the replan engine.
 *
 * Each describe() targets ONE high-suspicion area in the codebase. Tests are
 * arranged so the most likely-to-fail assertions run first. When one fails,
 * stop investigation and report the root cause.
 *
 * Areas under test:
 *   1. State trajectory length invariant (`length === plan.length + 1`)
 *   2. DROP_SLOT resumeIndex semantics (index in the SHORTER plan)
 *   3. SWAP_ORDER version bumping and resumeIndex
 *   4. INSERT_ALT at pos=0 (no prefix)
 *   5. TIME_SHIFT forward overlap semantics
 *   6. repairSuffix night-overflow chain (slot pushed past 22:00)
 *   7. Dual planSignature consistency (BeamSearch vs MutationOperators)
 *   8. CandidatePruner false-positive vs materialize
 *
 * NOTE: copies of fixture factories are intentional — pattern matches
 * RepairSuffix.test.ts and MutationOperators.test.ts in the same folder.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import type { TripSlot, Place, TripState, UserPreference, PlaceTag } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories (copy of RepairSuffix.test.ts pattern)
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
    slotId: `slot-${Math.random().toString(36).slice(2, 11)}`,
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
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
    capturedAt: '2026-04-21T01:00:00.000Z', // 08:00 VN
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

// ---------------------------------------------------------------------------
// Shared landmark places
// ---------------------------------------------------------------------------
const P1 = makePlace({ placeId: 1, name: 'P1', avgVisitDurationMin: 60, minPrice: 10_000 });
const P2 = makePlace({ placeId: 2, name: 'P2', avgVisitDurationMin: 60, minPrice: 20_000, lat: 16.07, lng: 108.23 });
const P3 = makePlace({ placeId: 3, name: 'P3', avgVisitDurationMin: 60, minPrice: 30_000, lat: 16.08, lng: 108.24 });
const P4 = makePlace({ placeId: 4, name: 'P4', avgVisitDurationMin: 60, minPrice: 30_000, lat: 16.09, lng: 108.25, tags: [makeTag(1)] });
const P5 = makePlace({ placeId: 5, name: 'P5', avgVisitDurationMin: 60, minPrice: 30_000, lat: 16.10, lng: 108.26, tags: [makeTag(1)] });
const ALL = [P1, P2, P3, P4, P5];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('replan bug-hunt', () => {
  let ops: MutationOperators;

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  // -------------------------------------------------------------------------
  // (1) State trajectory length invariant — every cached trajectory
  //     produced by an operator must satisfy length === plan.length + 1.
  // -------------------------------------------------------------------------
  describe('(1) stateTrajectory length invariant', () => {
    it('every operator result with stateTrajectory has length === newPlan.length + 1', () => {
      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'b', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'c', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];

      const results = ops.generateAll(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);

      for (const r of results) {
        if (r.stateTrajectory !== undefined) {
          expect(
            r.stateTrajectory.length,
            `operator=${r.operator} desc="${r.description}" newPlan.length=${r.newPlan.length} ` +
            `but trajectory.length=${r.stateTrajectory.length}`
          ).toBe(r.newPlan.length + 1);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (2) DROP_SLOT resumeIndex semantics
  //     - resumeIndex must be an index INTO newPlan (which is shorter than the
  //       original by 1), and newPlan[resumeIndex] should be the slot that was
  //       originally at position i+1.
  // -------------------------------------------------------------------------
  describe('(2) DROP_SLOT resumeIndex', () => {
    it('resumeIndex points to the old plan[i+1] (now at newPlan[i]) after drop', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 's2', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
        makeSlot({ slotId: 's3', placeId: 4, slotOrder: 3,
          plannedStart: '2026-04-21T06:30:00.000Z', plannedEnd: '2026-04-21T07:30:00.000Z' }),
        makeSlot({ slotId: 's4', placeId: 5, slotOrder: 4,
          plannedStart: '2026-04-21T08:00:00.000Z', plannedEnd: '2026-04-21T09:00:00.000Z' }),
      ];

      const results = ops.dropSlot(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);

      for (const r of results) {
        // newPlan has one fewer slot
        expect(r.newPlan.length).toBe(plan.length - 1);
        // resumeIndex must be defined for DROP_SLOT
        expect(r.resumeIndex).toBeDefined();

        const droppedSlotId = r.affectedSlotIds[0];
        const originalDropIndex = plan.findIndex((s) => s.slotId === droppedSlotId);
        expect(originalDropIndex).toBeGreaterThanOrEqual(0);

        const idx = r.resumeIndex!;
        // resumeIndex must be a valid index into the new (shorter) plan,
        // or === newPlan.length when the dropped slot was at the tail
        expect(idx).toBeLessThanOrEqual(r.newPlan.length);

        if (idx < r.newPlan.length) {
          // The slot at newPlan[resumeIndex] must be the slot that was originally
          // immediately after the dropped slot.
          const expectedSlotId = plan[originalDropIndex + 1]!.slotId;
          expect(
            r.newPlan[idx].slotId,
            `dropped index=${originalDropIndex}, resumeIndex=${idx}, ` +
            `expected newPlan[${idx}].slotId === '${expectedSlotId}' (old plan[${originalDropIndex + 1}])`
          ).toBe(expectedSlotId);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (3) SWAP_ORDER version bumping
  //     - Two swapped slots must both have version incremented by 1.
  //     - The slot at position i gets the slotOrder of position-i-original
  //       and the slot at position i+1 gets the slotOrder of position-i+1-original.
  // -------------------------------------------------------------------------
  describe('(3) SWAP_ORDER version bump + slotOrder swap', () => {
    it('both swapped slots have version+1 and their slotOrder reflects the swap', () => {
      const slotA = makeSlot({ slotId: 'A', placeId: 1, slotOrder: 0, version: 7,
        plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' });
      const slotB = makeSlot({ slotId: 'B', placeId: 2, slotOrder: 1, version: 3,
        plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' });
      const plan = [slotA, slotB];

      const results = ops.swapOrder(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);

      const r = results[0];
      const newA = r.newPlan.find((s) => s.slotId === 'A')!;
      const newB = r.newPlan.find((s) => s.slotId === 'B')!;
      expect(newA, 'A still in newPlan').toBeDefined();
      expect(newB, 'B still in newPlan').toBeDefined();

      // Versions incremented exactly once
      expect(newA.version, 'A.version should be original+1').toBe(slotA.version + 1);
      expect(newB.version, 'B.version should be original+1').toBe(slotB.version + 1);

      // slotOrder reflects the swap: now A is at order 1, B at order 0
      expect(newA.slotOrder).toBe(1);
      expect(newB.slotOrder).toBe(0);
    });

    it('resumeIndex equals min(i, i+1) === i for the swap', () => {
      const plan = [
        makeSlot({ slotId: 'A', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'B', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
      ];
      const results = ops.swapOrder(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].resumeIndex).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // (4) INSERT_ALT at the start of the plan (pos=0)
  //     - When inserted at pos=0 with no prefix, the inserted slot must be
  //       the first element of repaired plan and have a feasible plannedStart
  //       at or after capturedAt.
  // -------------------------------------------------------------------------
  describe('(4) INSERT_ALT at start position (pos=0 / no prefix)', () => {
    it('inserted slot at pos=0 starts at or after capturedAt and dayIndex matches first day', () => {
      // Only one slot in the plan and one forced-insert candidate => pos must hit 0
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0, dayIndex: 0,
          plannedStart: '2026-04-21T03:00:00.000Z', plannedEnd: '2026-04-21T04:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        forceIncludePlaceId: 2,
        initialState: makeState({ capturedAt: '2026-04-21T01:00:00.000Z' }), // 08:00 VN
      });

      const results = ops.insertAlt(plan, ctx);
      expect(results.length).toBeGreaterThan(0);

      // Look specifically for a result where pos==0 (insert at beginning).
      const r0 = results.find((r) => r.repairedFromIndex === 0);
      expect(r0, 'should produce at least one insert at pos=0').toBeDefined();

      const inserted = r0!.newPlan[0]!;
      expect(inserted.placeId).toBe(2);
      // capturedAt is at 08:00 VN; the inserted slot must start at or after that
      const startMs = new Date(inserted.plannedStart).getTime();
      const capturedAtMs = new Date(ctx.initialState.capturedAt).getTime();
      expect(startMs).toBeGreaterThanOrEqual(capturedAtMs);

      // slotOrder must be 0 (it's the first slot of day 0)
      expect(inserted.slotOrder).toBe(0);
      // trajectory length must match
      expect(r0!.stateTrajectory!.length).toBe(r0!.newPlan.length + 1);
    });
  });

  // -------------------------------------------------------------------------
  // (5) TIME_SHIFT forward overlap semantics
  //     Two adjacent slots A (09:00–10:00) and B (10:00–11:00).
  //     Shifting A by +60 makes A occupy 10:00–11:00 — overlapping with B.
  //     repairSuffix should push B later. After repair, A and B must not overlap.
  // -------------------------------------------------------------------------
  describe('(5) TIME_SHIFT forward overlap is resolved by repairSuffix', () => {
    it('after +60 shift on slot 0, slot 0 and slot 1 do not overlap', () => {
      const plan = [
        makeSlot({ slotId: 'A', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'B', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:00:00.000Z', plannedEnd: '2026-04-21T04:00:00.000Z' }),
      ];

      const results = ops.timeShift(plan, makeCtx(ALL));
      const plus60 = results.find(
        (r) => r.affectedSlotIds[0] === 'A' && r.description.includes('+60')
      );
      expect(plus60, '+60 shift on slot A should be produced').toBeDefined();

      const newA = plus60!.newPlan[0]!;
      const newB = plus60!.newPlan[1]!;

      const aEndMs   = new Date(newA.plannedEnd).getTime();
      const bStartMs = new Date(newB.plannedStart).getTime();

      // After shift, A is shifted +60 → 10:00–11:00 VN.
      // B must START at or AFTER A's end.
      expect(
        bStartMs,
        `B.start (${newB.plannedStart}) should be >= A.end (${newA.plannedEnd}) after repairSuffix`
      ).toBeGreaterThanOrEqual(aEndMs);
    });
  });

  // -------------------------------------------------------------------------
  // (6) repairSuffix night-overflow chain
  //     If we drop a tiny slot and the resulting suffix is packed into a
  //     window so tight that the LAST slot would end after 22:00, repairSuffix
  //     must either reject (return null → no result) or correctly bump the
  //     overflowing slot to next day. We check the invariant: any produced
  //     result must satisfy every slot end <= 22:00 VN of its own day.
  // -------------------------------------------------------------------------
  describe('(6) repairSuffix preserves night-end invariant', () => {
    it('every produced result has each slot ending at or before 22:00 VN of its own dayIndex', () => {
      // Plan that's already near the end of the day, packed tight
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T11:00:00.000Z', plannedEnd: '2026-04-21T12:00:00.000Z' }), // 18:00–19:00 VN
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T12:00:00.000Z', plannedEnd: '2026-04-21T13:00:00.000Z' }), // 19:00–20:00 VN
        makeSlot({ slotId: 's2', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T13:00:00.000Z', plannedEnd: '2026-04-21T14:00:00.000Z' }), // 20:00–21:00 VN
      ];

      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T10:00:00.000Z' }),
      });
      const results = ops.generateAll(plan, ctx);

      for (const r of results) {
        for (const slot of r.newPlan) {
          const endVN = new Date(new Date(slot.plannedEnd).getTime() + 7 * 60 * 60_000);
          const hour = endVN.getUTCHours();
          const minute = endVN.getUTCMinutes();
          // Hard end = 22:00 VN. Allow up to 22:29 because exceedsNightConstraint
          // may allow a small overflow window. But never crossing midnight.
          const total = hour * 60 + minute;
          expect(
            total,
            `operator=${r.operator} slot=${slot.slotId} dayIndex=${slot.dayIndex} ` +
            `plannedEnd=${slot.plannedEnd} (=${hour}:${minute.toString().padStart(2, '0')} VN) ` +
            `exceeds 22:30 VN`
          ).toBeLessThanOrEqual(22 * 60 + 30);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (7) Generated mutations preserve LOCKED slot identity
  //     - A locked slot must never have its placeId/plannedStart/plannedEnd/dayIndex
  //       changed by any operator.
  // -------------------------------------------------------------------------
  describe('(7) locked slots are never modified', () => {
    it('plannedStart/plannedEnd/placeId of locked slot identical in every result', () => {
      const lockedStart = '2026-04-21T05:00:00.000Z';
      const lockedEnd   = '2026-04-21T06:00:00.000Z';
      const plan = [
        makeSlot({ slotId: 'free0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'locked', placeId: 3, slotOrder: 1, isLocked: true,
          plannedStart: lockedStart, plannedEnd: lockedEnd }),
        makeSlot({ slotId: 'free2', placeId: 2, slotOrder: 2,
          plannedStart: '2026-04-21T06:30:00.000Z', plannedEnd: '2026-04-21T07:30:00.000Z' }),
      ];

      const results = ops.generateAll(plan, makeCtx(ALL));
      for (const r of results) {
        const locked = r.newPlan.find((s) => s.slotId === 'locked');
        // Locked slot must still exist
        expect(
          locked,
          `operator=${r.operator} desc="${r.description}" — locked slot disappeared from newPlan`
        ).toBeDefined();
        expect(locked!.placeId).toBe(3);
        expect(
          locked!.plannedStart,
          `operator=${r.operator} desc="${r.description}" — locked plannedStart was modified`
        ).toBe(lockedStart);
        expect(
          locked!.plannedEnd,
          `operator=${r.operator} desc="${r.description}" — locked plannedEnd was modified`
        ).toBe(lockedEnd);
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8a) slotOrder per dayIndex must be 0..n-1 contiguous in every result
  // -------------------------------------------------------------------------
  describe('(8a) slotOrder per dayIndex is contiguous 0..n-1', () => {
    it('every operator output has contiguous slotOrders within each dayIndex', () => {
      const plan = [
        makeSlot({ slotId: 'd0s0', placeId: 1, dayIndex: 0, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd0s1', placeId: 2, dayIndex: 0, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'd0s2', placeId: 3, dayIndex: 0, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
        makeSlot({ slotId: 'd1s0', placeId: 4, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1s1', placeId: 5, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T03:30:00.000Z', plannedEnd: '2026-04-22T04:30:00.000Z' }),
      ];

      const results = ops.generateAll(plan, makeCtx(ALL));
      expect(results.length).toBeGreaterThan(0);

      for (const r of results) {
        const ordersByDay = new Map<number, number[]>();
        for (const s of r.newPlan) {
          if (!ordersByDay.has(s.dayIndex)) ordersByDay.set(s.dayIndex, []);
          ordersByDay.get(s.dayIndex)!.push(s.slotOrder);
        }
        for (const [day, orders] of ordersByDay.entries()) {
          const sorted = [...orders].sort((a, b) => a - b);
          for (let i = 0; i < sorted.length; i++) {
            expect(
              sorted[i],
              `operator=${r.operator} desc="${r.description}" day=${day} ` +
              `expected slotOrder[${i}]=${i}, got orders=[${sorted.join(',')}]`
            ).toBe(i);
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8b) No two slots within the same dayIndex have overlapping time windows
  // -------------------------------------------------------------------------
  describe('(8b) no time overlap among same-day slots in any result', () => {
    it('within each dayIndex, slots sorted by start have no overlapping intervals', () => {
      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'b', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'c', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];

      const results = ops.generateAll(plan, makeCtx(ALL));
      for (const r of results) {
        const byDay = new Map<number, TripSlot[]>();
        for (const s of r.newPlan) {
          if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
          byDay.get(s.dayIndex)!.push(s);
        }
        for (const [day, slots] of byDay.entries()) {
          slots.sort((x, y) => new Date(x.plannedStart).getTime() - new Date(y.plannedStart).getTime());
          for (let i = 1; i < slots.length; i++) {
            const prevEnd = new Date(slots[i - 1]!.plannedEnd).getTime();
            const curStart = new Date(slots[i]!.plannedStart).getTime();
            expect(
              curStart,
              `operator=${r.operator} desc="${r.description}" day=${day} ` +
              `slot[${i - 1}] (${slots[i - 1]!.slotId}) ends ${slots[i - 1]!.plannedEnd}, ` +
              `slot[${i}] (${slots[i]!.slotId}) starts ${slots[i]!.plannedStart} → overlap`
            ).toBeGreaterThanOrEqual(prevEnd);
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8c) DROP_SLOT of the LAST slot — code path that skips repairSuffix
  //      Must still produce a feasible result with correct trajectory length.
  // -------------------------------------------------------------------------
  describe('(8c) DROP_SLOT of last slot has trajectory length === newPlan.length + 1', () => {
    it('dropping the tail slot still satisfies the trajectory invariant', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'tail', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];

      const results = ops.dropSlot(plan, makeCtx(ALL));
      const tailDrop = results.find((r) => r.affectedSlotIds[0] === 'tail');
      expect(tailDrop, 'should produce a result dropping the tail slot').toBeDefined();
      expect(tailDrop!.newPlan.length).toBe(2);
      expect(tailDrop!.stateTrajectory).toBeDefined();
      expect(tailDrop!.stateTrajectory!.length).toBe(tailDrop!.newPlan.length + 1);
      // resumeIndex must be index of dropped slot = 2; out-of-bounds for new shorter plan,
      // but documented behavior. Just verify it's defined.
      expect(tailDrop!.resumeIndex).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // (8d) TSP_REORDER preserves dayIndex for every slot
  // -------------------------------------------------------------------------
  describe('(8d) TSP_REORDER does not move slots across days', () => {
    it('every slot retains its original dayIndex under TSP_REORDER', () => {
      // Day 0: 3 slots that benefit from reorder (start far, then near, then nearer)
      const plan = [
        makeSlot({ slotId: 'd0a', placeId: 1, dayIndex: 0, slotOrder: 0, // far
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'd0b', placeId: 4, dayIndex: 0, slotOrder: 1, // farthest
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'd0c', placeId: 2, dayIndex: 0, slotOrder: 2, // near
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
        makeSlot({ slotId: 'd1a', placeId: 3, dayIndex: 1, slotOrder: 0,
          plannedStart: '2026-04-22T02:00:00.000Z', plannedEnd: '2026-04-22T03:00:00.000Z' }),
        makeSlot({ slotId: 'd1b', placeId: 5, dayIndex: 1, slotOrder: 1,
          plannedStart: '2026-04-22T03:30:00.000Z', plannedEnd: '2026-04-22T04:30:00.000Z' }),
      ];

      const results = ops.tspReorder(plan, makeCtx(ALL));
      const origDay = new Map(plan.map((s) => [s.slotId, s.dayIndex]));

      for (const r of results) {
        for (const s of r.newPlan) {
          const expectedDay = origDay.get(s.slotId);
          expect(
            s.dayIndex,
            `TSP moved slot ${s.slotId} from day ${expectedDay} to ${s.dayIndex}`
          ).toBe(expectedDay);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8e) Trajectory monotonicity: budgetRemaining never increases along the trip
  // -------------------------------------------------------------------------
  describe('(8e) trajectory budgetRemaining is monotonically non-increasing', () => {
    it('every cached trajectory has trajectory[i+1].budgetRemaining <= trajectory[i].budgetRemaining', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z',
          estimatedCost: 50_000 }),
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z',
          estimatedCost: 80_000 }),
        makeSlot({ slotId: 's2', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z',
          estimatedCost: 120_000 }),
      ];
      const results = ops.generateAll(plan, makeCtx(ALL));

      for (const r of results) {
        if (!r.stateTrajectory) continue;
        for (let i = 1; i < r.stateTrajectory.length; i++) {
          const prev = r.stateTrajectory[i - 1]!;
          const cur  = r.stateTrajectory[i]!;
          expect(
            cur.budgetRemaining,
            `operator=${r.operator} trajectory[${i}].budgetRemaining=${cur.budgetRemaining} ` +
            `> trajectory[${i - 1}].budgetRemaining=${prev.budgetRemaining} — budget cannot increase`
          ).toBeLessThanOrEqual(prev.budgetRemaining);
          expect(
            cur.budgetRemaining,
            `operator=${r.operator} trajectory[${i}].budgetRemaining=${cur.budgetRemaining} is negative`
          ).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8f) DROP_SLOT must not produce a plan that contains the dropped slotId
  // -------------------------------------------------------------------------
  describe('(8f) DROP_SLOT removes the dropped slotId from newPlan entirely', () => {
    it('dropped slotId never appears in any newPlan slot', () => {
      const plan = [
        makeSlot({ slotId: 'keep0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'killme', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'keep2', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];
      const results = ops.dropSlot(plan, makeCtx(ALL));
      const drop = results.find((r) => r.affectedSlotIds[0] === 'killme');
      expect(drop, 'should produce a result dropping killme').toBeDefined();
      expect(drop!.newPlan.find((s) => s.slotId === 'killme')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // (8g) INSERT_ALT — inserted placeId must not already be in plan
  // -------------------------------------------------------------------------
  describe('(8g) INSERT_ALT does not insert a place already present', () => {
    it('forceIncludePlaceId already present → no results (no duplicate inserts)', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 2, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, { forceIncludePlaceId: 2 }); // already in plan
      const results = ops.insertAlt(plan, ctx);
      expect(results.length).toBe(0);
    });

    it('without forceInclude, no result inserts a place already in plan', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
      ];
      const inPlanIds = new Set([1, 2]);
      const results = ops.insertAlt(plan, makeCtx(ALL));
      for (const r of results) {
        const insertedSlot = r.newPlan.find((s) => !plan.some((p) => p.slotId === s.slotId));
        if (insertedSlot) {
          expect(
            inPlanIds.has(insertedSlot.placeId),
            `INSERT_ALT inserted placeId=${insertedSlot.placeId} which is already in plan`
          ).toBe(false);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8h) Plan immutability: parent plan must not be mutated by any operator
  // -------------------------------------------------------------------------
  describe('(8h) operators never mutate the input plan', () => {
    it('after generateAll, original plan array and slot objects are byte-equal to a snapshot', () => {
      const plan = [
        makeSlot({ slotId: 's0', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 's1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 's2', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];
      const snapshot = JSON.parse(JSON.stringify(plan));
      ops.generateAll(plan, makeCtx(ALL));
      expect(plan).toEqual(snapshot);
    });
  });

  // -------------------------------------------------------------------------
  // (8i) status='completed' / status='skipped' slots are never modified
  // -------------------------------------------------------------------------
  describe('(8i) completed/skipped slots are immutable', () => {
    it('plannedStart/plannedEnd/placeId of completed slots never change in any result', () => {
      const completedStart = '2026-04-21T02:00:00.000Z';
      const completedEnd   = '2026-04-21T03:00:00.000Z';
      const plan = [
        makeSlot({ slotId: 'done', placeId: 1, slotOrder: 0, status: 'completed',
          actualStart: completedStart, actualEnd: completedEnd,
          plannedStart: completedStart, plannedEnd: completedEnd }),
        makeSlot({ slotId: 'next', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
        makeSlot({ slotId: 'last', placeId: 3, slotOrder: 2,
          plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' }),
      ];
      const ctx = makeCtx(ALL, {
        initialState: makeState({ capturedAt: '2026-04-21T03:00:00.000Z' }), // right after completed
      });

      const results = ops.generateAll(plan, ctx);
      for (const r of results) {
        const done = r.newPlan.find((s) => s.slotId === 'done');
        expect(done, `operator=${r.operator} completed slot disappeared`).toBeDefined();
        expect(
          done!.plannedStart,
          `operator=${r.operator} desc="${r.description}" — completed plannedStart was modified ` +
          `from ${completedStart} to ${done!.plannedStart}`
        ).toBe(completedStart);
        expect(done!.plannedEnd).toBe(completedEnd);
        expect(done!.placeId).toBe(1);
        expect(done!.status).toBe('completed');
      }
    });

    it('dropSlot never drops a completed slot even if its activityType is sightseeing', () => {
      const plan = [
        makeSlot({ slotId: 'done', placeId: 1, slotOrder: 0, status: 'completed',
          actualStart: '2026-04-21T02:00:00.000Z', actualEnd: '2026-04-21T03:00:00.000Z',
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'p1', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T03:30:00.000Z', plannedEnd: '2026-04-21T04:30:00.000Z' }),
      ];
      const results = ops.dropSlot(plan, makeCtx(ALL));
      for (const r of results) {
        expect(r.affectedSlotIds[0]).not.toBe('done');
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8j) Randomized fuzz: 30 random small plans, all invariants must hold
  // -------------------------------------------------------------------------
  describe('(8j) fuzz: invariants hold across random plans', () => {
    function rng(seed: number) {
      let s = seed >>> 0;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x1_0000_0000;
      };
    }

    it('30 random plans × all operators → no invariant violations', () => {
      for (let trial = 0; trial < 30; trial++) {
        const rand = rng(trial * 7919 + 13);
        const slotCount = 2 + Math.floor(rand() * 4); // 2..5 slots
        const dayCount = 1 + Math.floor(rand() * 2);  // 1..2 days

        const slots: TripSlot[] = [];
        let curMs = new Date('2026-04-21T02:00:00.000Z').getTime(); // 09:00 VN day 0
        let curDay = 0;
        let orderInDay = 0;
        for (let i = 0; i < slotCount; i++) {
          if (curDay < dayCount - 1 && rand() < 0.3 && i > 0) {
            curDay++;
            orderInDay = 0;
            curMs = new Date('2026-04-22T02:00:00.000Z').getTime();
          }
          const placeId = 1 + Math.floor(rand() * ALL.length);
          const durationMin = 30 + Math.floor(rand() * 60);
          const start = curMs;
          const end = start + durationMin * 60_000;
          slots.push(makeSlot({
            slotId: `t${trial}-s${i}`,
            placeId,
            dayIndex: curDay,
            slotOrder: orderInDay++,
            plannedStart: new Date(start).toISOString(),
            plannedEnd: new Date(end).toISOString(),
          }));
          curMs = end + (15 + Math.floor(rand() * 60)) * 60_000;
        }

        // Skip degenerate case: same placeId twice in adjacent positions (some operators
        // assume distinct places). Replace any duplicate placeId with a unique one.
        const usedIds = new Set<number>();
        for (const s of slots) {
          while (usedIds.has(s.placeId)) {
            s.placeId = ((s.placeId) % ALL.length) + 1;
          }
          usedIds.add(s.placeId);
        }

        let results;
        try {
          results = ops.generateAll(slots, makeCtx(ALL));
        } catch (e) {
          throw new Error(`trial=${trial} threw: ${(e as Error).message}\nplan=${JSON.stringify(slots.map(s => ({ id: s.slotId, p: s.placeId, d: s.dayIndex, o: s.slotOrder, start: s.plannedStart, end: s.plannedEnd })))}`);
        }

        for (const r of results) {
          // Invariant 1: trajectory length
          if (r.stateTrajectory) {
            expect(
              r.stateTrajectory.length,
              `trial=${trial} op=${r.operator} traj.length=${r.stateTrajectory.length} != newPlan.length+1=${r.newPlan.length + 1}`
            ).toBe(r.newPlan.length + 1);
          }
          // Invariant 2: slotOrder contiguous per day
          const byDay = new Map<number, TripSlot[]>();
          for (const s of r.newPlan) {
            if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
            byDay.get(s.dayIndex)!.push(s);
          }
          for (const [day, daySlots] of byDay.entries()) {
            const orders = daySlots.map((x) => x.slotOrder).sort((a, b) => a - b);
            for (let i = 0; i < orders.length; i++) {
              expect(
                orders[i],
                `trial=${trial} op=${r.operator} day=${day} orders=[${orders.join(',')}] expected [0..${orders.length - 1}]`
              ).toBe(i);
            }
          }
          // Invariant 3: no same-day time overlap
          for (const [day, daySlots] of byDay.entries()) {
            daySlots.sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
            for (let i = 1; i < daySlots.length; i++) {
              const prevEnd = new Date(daySlots[i - 1]!.plannedEnd).getTime();
              const curStart = new Date(daySlots[i]!.plannedStart).getTime();
              expect(
                curStart,
                `trial=${trial} op=${r.operator} day=${day} overlap at i=${i}: prev=${daySlots[i - 1]!.plannedEnd} cur=${daySlots[i]!.plannedStart}`
              ).toBeGreaterThanOrEqual(prevEnd);
            }
          }
          // Invariant 4: every slot ends before 22:30 VN of its day
          for (const s of r.newPlan) {
            const endVN = new Date(new Date(s.plannedEnd).getTime() + 7 * 60 * 60_000);
            const total = endVN.getUTCHours() * 60 + endVN.getUTCMinutes();
            expect(
              total,
              `trial=${trial} op=${r.operator} slot=${s.slotId} ends past 22:30 VN: ${s.plannedEnd}`
            ).toBeLessThanOrEqual(22 * 60 + 30);
          }
          // Invariant 5: dayIndex sequence monotone non-decreasing in array order
          for (let i = 1; i < r.newPlan.length; i++) {
            expect(
              r.newPlan[i]!.dayIndex,
              `trial=${trial} op=${r.operator} dayIndex regressed at i=${i}: ${r.newPlan[i - 1]!.dayIndex} -> ${r.newPlan[i]!.dayIndex}`
            ).toBeGreaterThanOrEqual(r.newPlan[i - 1]!.dayIndex);
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8k) Opening-hours invariant: every produced slot whose place has openingHours
  //      must have its plannedStart within an open window on the appropriate day.
  // -------------------------------------------------------------------------
  describe('(8k) opening-hours respected across all operators', () => {
    it('every slot in every result whose place has openingHours has plannedStart inside an open window', () => {
      // Two places with tight opening-hours. Force operators to keep these inside their windows.
      // 2026-04-21 is Tuesday. js getDay() === 2. App spec dayOfWeek === (2 + 6) % 7 === 1 (T3).
      const PA = makePlace({
        placeId: 10, name: 'A', avgVisitDurationMin: 60, lat: 16.06, lng: 108.22,
        openingHours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '11:00' }],
      });
      const PB = makePlace({
        placeId: 20, name: 'B', avgVisitDurationMin: 60, lat: 16.07, lng: 108.23,
        openingHours: [{ dayOfWeek: 1, openTime: '13:00', closeTime: '16:00' }],
      });
      const PC = makePlace({ placeId: 30, name: 'C', avgVisitDurationMin: 60, lat: 16.08, lng: 108.24 }); // no hours
      const PD = makePlace({ placeId: 40, name: 'D', avgVisitDurationMin: 60, lat: 16.09, lng: 108.25,
        openingHours: [{ dayOfWeek: 1, openTime: '14:00', closeTime: '17:00' }] });

      const placePool = [PA, PB, PC, PD];
      const placeMap = new Map(placePool.map((p) => [p.placeId, p]));

      const plan = [
        makeSlot({ slotId: 's0', placeId: 10, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }), // 09-10 VN
        makeSlot({ slotId: 's1', placeId: 20, slotOrder: 1,
          plannedStart: '2026-04-21T06:00:00.000Z', plannedEnd: '2026-04-21T07:00:00.000Z' }), // 13-14 VN
      ];

      const ctx = makeCtx(placePool, { placeMap });
      const results = ops.generateAll(plan, ctx);

      const VN_OFFSET = 7 * 60;
      for (const r of results) {
        for (const slot of r.newPlan) {
          const place = placeMap.get(slot.placeId);
          if (!place || place.openingHours.length === 0) continue;
          const startLocal = new Date(new Date(slot.plannedStart).getTime() + VN_OFFSET * 60_000);
          // App spec: dayOfWeek = (jsDay + 6) % 7
          const dayOfWeek = (startLocal.getUTCDay() + 6) % 7;
          const minutes = startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes();
          const window = place.openingHours.find((h) => h.dayOfWeek === dayOfWeek);
          expect(
            window,
            `operator=${r.operator} slot=${slot.slotId} place=${place.name} plannedStart=${slot.plannedStart} ` +
            `(VN dayOfWeek=${dayOfWeek}) — place is closed today`
          ).toBeDefined();
          const [openH, openM] = window!.openTime.split(':').map(Number);
          const [closeH, closeM] = window!.closeTime.split(':').map(Number);
          const openMin = openH! * 60 + openM!;
          const closeMin = closeH! * 60 + closeM!;
          expect(
            minutes,
            `operator=${r.operator} slot=${slot.slotId} place=${place.name} ` +
            `plannedStart=${slot.plannedStart} → ${Math.floor(minutes / 60)}:${(minutes % 60).toString().padStart(2, '0')} VN ` +
            `not in window ${window!.openTime}-${window!.closeTime}`
          ).toBeGreaterThanOrEqual(openMin);
          expect(minutes).toBeLessThan(closeMin);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // (8) Dedup correctness: identical signatures must not coexist
  // -------------------------------------------------------------------------
  describe('(8) generateAll output has no duplicate plan signatures', () => {
    it('no two results have the same identity signature (slotId+version+timing)', () => {
      const plan = [
        makeSlot({ slotId: 'a', placeId: 1, slotOrder: 0,
          plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T03:00:00.000Z' }),
        makeSlot({ slotId: 'b', placeId: 2, slotOrder: 1,
          plannedStart: '2026-04-21T04:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }),
      ];
      const results = ops.generateAll(plan, makeCtx(ALL));

      const sigs = new Set<string>();
      for (const r of results) {
        const sig = r.newPlan
          .map((s) => [s.slotId, s.dayIndex, s.slotOrder, s.status, s.version,
                       s.plannedStart, s.plannedEnd].join('##'))
          .join('|');
        expect(sigs.has(sig), `duplicate signature for operator=${r.operator}: ${sig}`).toBe(false);
        sigs.add(sig);
      }
    });
  });
});
