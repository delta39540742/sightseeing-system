import { describe, it, expect, vi } from 'vitest';
import {
  computeEFS,
  computeLFS,
  computeBudgetAndFatigueBounds,
  propagateConstraints,
  nightLimitOf,
  morningStartOf,
  durationMinOf,
} from '../src/replanner/ConstraintPropagation';
import { canPrune } from '../src/replanner/CandidatePruner';
import type { TripSlot, TripState, Place } from '@app/types';
import type { StateEvolver } from '../src/replanner/StateEvolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Build a UTC ISO string for a given VN local time on a fixed date (2026-05-01). */
function vnTime(hhMM: string, dayOffset = 0): string {
  const [hh, mm] = hhMM.split(':').map(Number);
  const utcHh = hh! - 7 + dayOffset * 24;
  return `2026-05-01T${String(utcHh < 0 ? utcHh + 24 : utcHh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
}

/** Absolute minutes for a given dayIndex and VN local HH:MM. */
function absMin(dayIndex: number, hhMM: string): number {
  const [hh, mm] = hhMM.split(':').map(Number);
  return dayIndex * 1440 + hh! * 60 + mm!;
}

function makeSlot(overrides: Partial<TripSlot> & { placeId: number }): TripSlot {
  return {
    slotId: `s${overrides.placeId}-${overrides.slotOrder ?? 0}`,
    tripId: 'trip-1',
    dayIndex: 0,
    slotOrder: overrides.slotOrder ?? 0,
    version: 1,
    plannedStart: vnTime('09:00'),
    plannedEnd: vnTime('10:00'),
    actualStart: null,
    actualEnd: null,
    estimatedCost: 50_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makePlace(placeId: number, avgVisitDurationMin = 60, overrides: Partial<Place> = {}): Place {
  return {
    placeId,
    name: `Place ${placeId}`,
    description: null,
    lat: 16.06 + placeId * 0.01,
    lng: 108.22 + placeId * 0.01,
    minPrice: undefined,
    maxPrice: undefined,
    priceType: 'free',
    avgVisitDurationMin,
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

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-1',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,
    budgetRemaining: 500_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: vnTime('08:00'),
    source: 'simulated',
    ...overrides,
  };
}

/** Stub evolver that returns a fixed travel time between all pairs. */
function makeEvolver(travelMin = 15): StateEvolver {
  return {
    estimateTravelTime: vi.fn(() => travelMin),
  } as unknown as StateEvolver;
}

// ---------------------------------------------------------------------------
// nightLimitOf / morningStartOf
// ---------------------------------------------------------------------------

describe('nightLimitOf / morningStartOf', () => {
  it('returns correct absolute minutes for day 0', () => {
    expect(nightLimitOf(0)).toBe(22 * 60 + 30);   // 1350
    expect(morningStartOf(0)).toBe(8 * 60);         // 480
  });

  it('scales linearly with dayIndex', () => {
    expect(nightLimitOf(2)).toBe(2 * 1440 + 1350);
    expect(morningStartOf(3)).toBe(3 * 1440 + 480);
  });
});

// ---------------------------------------------------------------------------
// durationMinOf
// ---------------------------------------------------------------------------

describe('durationMinOf', () => {
  it('returns max(15, avgVisitDurationMin) when place is in map', () => {
    const slot = makeSlot({ placeId: 1 });
    const placeMap = new Map([[1, makePlace(1, 45)]]);
    expect(durationMinOf(slot, placeMap)).toBe(45);
  });

  it('enforces minimum of 15 minutes', () => {
    const slot = makeSlot({ placeId: 1 });
    const placeMap = new Map([[1, makePlace(1, 5)]]);
    expect(durationMinOf(slot, placeMap)).toBe(15);
  });

  it('falls back to slot interval when place not in map', () => {
    const slot = makeSlot({
      placeId: 99,
      plannedStart: vnTime('09:00'),
      plannedEnd: vnTime('10:30'),
    });
    const placeMap = new Map<number, Place>();
    expect(durationMinOf(slot, placeMap)).toBe(90);
  });

  it('falls back to 60 when place missing and interval invalid', () => {
    const slot = makeSlot({ placeId: 99, plannedStart: 'bad', plannedEnd: 'bad' });
    const placeMap = new Map<number, Place>();
    expect(durationMinOf(slot, placeMap)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// computeEFS
// ---------------------------------------------------------------------------

describe('computeEFS', () => {
  it('returns [] for empty plan', () => {
    expect(computeEFS([], makeState(), makeEvolver(), new Map())).toEqual([]);
  });

  it('seeds EFS[0] at morning start when capturedAt is before morning', () => {
    const state = makeState({ capturedAt: vnTime('06:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, plannedStart: vnTime('08:00') });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const efs = computeEFS([slot], state, makeEvolver(0), placeMap);
    expect(efs[0]).toBe(morningStartOf(0)); // capturedAt before morning → clamp to 08:00
  });

  it('seeds EFS[0] at capturedAt when after morning start', () => {
    const state = makeState({ capturedAt: vnTime('10:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const efs = computeEFS([slot], state, makeEvolver(0), placeMap);
    expect(efs[0]).toBe(absMin(0, '10:00'));
  });

  it('is monotonically non-decreasing', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, plannedStart: vnTime('09:00'), plannedEnd: vnTime('10:00') }),
      makeSlot({ placeId: 2, slotOrder: 1, plannedStart: vnTime('10:30'), plannedEnd: vnTime('11:30') }),
      makeSlot({ placeId: 3, slotOrder: 2, plannedStart: vnTime('12:00'), plannedEnd: vnTime('13:00') }),
    ];
    const placeMap = new Map(slots.map((s, i) => [s.placeId, makePlace(s.placeId, 60)]));
    const efs = computeEFS(slots, state, makeEvolver(15), placeMap);
    for (let i = 1; i < efs.length; i++) {
      expect(efs[i]).toBeGreaterThanOrEqual(efs[i - 1]!);
    }
  });

  it('clamps to morningStart at day boundary', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const day0Slot = makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 0 });
    const day1Slot = makeSlot({ placeId: 2, dayIndex: 1, slotOrder: 0 });
    const placeMap = new Map([
      [1, makePlace(1, 60)],
      [2, makePlace(2, 60)],
    ]);
    const efs = computeEFS([day0Slot, day1Slot], state, makeEvolver(0), placeMap);
    // EFS[1] must be at least morningStart(1) = 1×1440 + 480
    expect(efs[1]).toBeGreaterThanOrEqual(morningStartOf(1));
  });
});

// ---------------------------------------------------------------------------
// computeLFS
// ---------------------------------------------------------------------------

describe('computeLFS', () => {
  it('returns [] for empty plan', () => {
    expect(computeLFS([], makeEvolver(), new Map())).toEqual([]);
  });

  it('seeds LFS[n-1] at night limit minus last duration', () => {
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const lfs = computeLFS([slot], makeEvolver(0), placeMap);
    expect(lfs[0]).toBe(nightLimitOf(0) - 60);
  });

  it('is monotonically non-increasing within same day', () => {
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, dayIndex: 0 }),
      makeSlot({ placeId: 2, slotOrder: 1, dayIndex: 0 }),
      makeSlot({ placeId: 3, slotOrder: 2, dayIndex: 0 }),
    ];
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 60)]));
    const lfs = computeLFS(slots, makeEvolver(10), placeMap);
    for (let i = 0; i < lfs.length - 1; i++) {
      expect(lfs[i]).toBeLessThanOrEqual(lfs[i + 1]!);
    }
  });

  it('handles day boundary: prev slot bounded only by its own night limit', () => {
    const day0Slot = makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 0 });
    const day1Slot = makeSlot({ placeId: 2, dayIndex: 1, slotOrder: 0 });
    const placeMap = new Map([
      [1, makePlace(1, 60)],
      [2, makePlace(2, 60)],
    ]);
    const lfs = computeLFS([day0Slot, day1Slot], makeEvolver(0), placeMap);
    // Day-0 slot: LFS bounded only by day-0 night limit (not by day-1 LFS)
    expect(lfs[0]).toBe(nightLimitOf(0) - 60);
    // Day-1 slot: LFS = nightLimit(1) - 60
    expect(lfs[1]).toBe(nightLimitOf(1) - 60);
  });
});

// ---------------------------------------------------------------------------
// propagateConstraints
// ---------------------------------------------------------------------------

describe('propagateConstraints', () => {
  it('returns [] for empty plan', () => {
    expect(propagateConstraints([], makeState(), makeEvolver(), new Map())).toEqual([]);
  });

  it('slack = LFS - EFS for each window', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, dayIndex: 0 }),
      makeSlot({ placeId: 2, slotOrder: 1, dayIndex: 0 }),
    ];
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 60)]));
    const windows = propagateConstraints(slots, state, makeEvolver(15), placeMap);
    for (const w of windows) {
      expect(w.slack).toBe(w.lfs - w.efs);
    }
  });

  it('slack >= 0 for a feasible plan (slots fit within day)', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, dayIndex: 0, plannedStart: vnTime('09:00'), plannedEnd: vnTime('10:00') }),
      makeSlot({ placeId: 2, slotOrder: 1, dayIndex: 0, plannedStart: vnTime('10:30'), plannedEnd: vnTime('11:30') }),
    ];
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 60)]));
    const windows = propagateConstraints(slots, state, makeEvolver(15), placeMap);
    for (const w of windows) {
      expect(w.slack).toBeGreaterThanOrEqual(0);
    }
  });

  it('budgetFloor decreases monotonically with each slot', () => {
    const state = makeState({ budgetRemaining: 300_000 });
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, estimatedCost: 50_000 }),
      makeSlot({ placeId: 2, slotOrder: 1, estimatedCost: 80_000 }),
      makeSlot({ placeId: 3, slotOrder: 2, estimatedCost: 100_000 }),
    ];
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 60)]));
    const windows = propagateConstraints(slots, state, makeEvolver(0), placeMap);
    expect(windows[0]!.budgetFloor).toBe(250_000);
    expect(windows[1]!.budgetFloor).toBe(170_000);
    expect(windows[2]!.budgetFloor).toBe(70_000);
  });

  it('fatigueCeiling stays in [0, 1]', () => {
    const state = makeState({ fatigue: 0.5 });
    const slots = Array.from({ length: 5 }, (_, i) =>
      makeSlot({ placeId: i + 1, slotOrder: i, dayIndex: 0, estimatedCost: 10_000 }),
    );
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 60)]));
    const windows = propagateConstraints(slots, state, makeEvolver(30), placeMap);
    for (const w of windows) {
      expect(w.fatigueCeiling).toBeGreaterThanOrEqual(0);
      expect(w.fatigueCeiling).toBeLessThanOrEqual(1);
    }
  });

  it('single slot plan: EFS <= LFS', () => {
    const state = makeState({ capturedAt: vnTime('09:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.efs).toBeLessThanOrEqual(windows[0]!.lfs);
  });

  it('tight plan (many long slots) can have negative slack', () => {
    // 20 slots of 90 min each on day 0 — total = 30h, way over the day
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slots = Array.from({ length: 10 }, (_, i) =>
      makeSlot({ placeId: i + 1, slotOrder: i, dayIndex: 0, estimatedCost: 10_000 }),
    );
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 90)]));
    const windows = propagateConstraints(slots, state, makeEvolver(15), placeMap);
    // Last slot(s) should have negative slack — plan is over-full
    const lastW = windows[windows.length - 1]!;
    expect(lastW.slack).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// canPrune — correctness (no false pruning + true pruning)
// ---------------------------------------------------------------------------

describe('canPrune — TIME_SHIFT', () => {
  it('prunes +δ shift when EFS + δ > LFS', () => {
    // Single slot, LFS = nightLimit(0) - 60 = 1290, EFS = absMin(0,'08:00') = 480
    // A +900 min shift would push EFS to 1380 > 1290 → prune
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    expect(canPrune({ operator: 'TIME_SHIFT', slotIndex: 0, deltaMin: 900 }, [slot], windows)).toBe(true);
  });

  it('does NOT prune +δ shift when EFS + δ <= LFS', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    // EFS=480, LFS=1290, shift by 30 → 510 ≤ 1290, must not prune
    expect(canPrune({ operator: 'TIME_SHIFT', slotIndex: 0, deltaMin: 30 }, [slot], windows)).toBe(false);
  });

  it('prunes -δ shift that would go before morning start', () => {
    const state = makeState({ capturedAt: vnTime('08:05'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    // EFS ≈ 485, shift -60 → 425 < 480 (morning start) → prune
    expect(canPrune({ operator: 'TIME_SHIFT', slotIndex: 0, deltaMin: -60 }, [slot], windows)).toBe(true);
  });

  it('does NOT prune -δ shift that stays after morning start', () => {
    const state = makeState({ capturedAt: vnTime('10:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    // EFS = 600, shift -30 → 570 > 480 → no prune
    expect(canPrune({ operator: 'TIME_SHIFT', slotIndex: 0, deltaMin: -30 }, [slot], windows)).toBe(false);
  });
});

describe('canPrune — SWAP_ORDER', () => {
  it('prunes swap when duration drift overflows last-slot LFS', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    // slotA: 60 min, slotB: 120 min → drift = +60. Last slot EFS + 60 must overflow LFS.
    const slotA = makeSlot({
      placeId: 1, slotOrder: 0, dayIndex: 0,
      plannedStart: vnTime('08:00'), plannedEnd: vnTime('09:00'),
    });
    const slotB = makeSlot({
      placeId: 2, slotOrder: 1, dayIndex: 0,
      plannedStart: vnTime('09:15'), plannedEnd: vnTime('11:15'), // 120 min
    });
    // Add many more slots to push EFS close to LFS
    const filler = Array.from({ length: 8 }, (_, i) =>
      makeSlot({
        placeId: i + 3, slotOrder: i + 2, dayIndex: 0,
        plannedStart: vnTime('09:00'), plannedEnd: vnTime('10:00'),
      }),
    );
    const plan = [slotA, slotB, ...filler];
    const placeMap = new Map([
      [1, makePlace(1, 60)],
      [2, makePlace(2, 120)],
      ...filler.map((s) => [s.placeId, makePlace(s.placeId, 60)] as [number, Place]),
    ]);
    const windows = propagateConstraints(plan, state, makeEvolver(5), placeMap);

    // If the last slot's slack < drift (60), prune
    const lastW = windows[windows.length - 1]!;
    const drift = 120 - 60; // = 60
    const shouldPrune = (lastW.efs + drift) > lastW.lfs;
    expect(canPrune({ operator: 'SWAP_ORDER', indexA: 0, indexB: 1 }, plan, windows)).toBe(shouldPrune);
  });

  it('does NOT prune swap when drift <= 0 (shorter slot at A position)', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    // slotA: 120 min (longer), slotB: 60 min (shorter) → drift = -60 → never prune
    const slotA = makeSlot({
      placeId: 1, slotOrder: 0, dayIndex: 0,
      plannedStart: vnTime('08:00'), plannedEnd: vnTime('10:00'),
    });
    const slotB = makeSlot({
      placeId: 2, slotOrder: 1, dayIndex: 0,
      plannedStart: vnTime('10:15'), plannedEnd: vnTime('11:15'),
    });
    const plan = [slotA, slotB];
    const placeMap = new Map([[1, makePlace(1, 120)], [2, makePlace(2, 60)]]);
    const windows = propagateConstraints(plan, state, makeEvolver(15), placeMap);
    expect(canPrune({ operator: 'SWAP_ORDER', indexA: 0, indexB: 1 }, plan, windows)).toBe(false);
  });
});

describe('canPrune — INSERT_ALT', () => {
  it('prunes when temporal slack is too small', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), budgetRemaining: 1_000_000, dayIndex: 0 });
    // Pack slots to fill the day — then try to insert a 120-min slot with < 120 slack
    const slots = Array.from({ length: 6 }, (_, i) =>
      makeSlot({ placeId: i + 1, slotOrder: i, dayIndex: 0, estimatedCost: 30_000 }),
    );
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 120)]));
    const windows = propagateConstraints(slots, state, makeEvolver(10), placeMap);

    // Insert at index 3 with a 300-min slot. If slack[3] < 300, prune.
    const w3 = windows[3]!;
    if (w3.slack < 300) {
      expect(canPrune({
        operator: 'INSERT_ALT', insertIndex: 3, newPlaceId: 99,
        newSlotDuration: 300, newSlotCost: 1_000,
      }, slots, windows)).toBe(true);
    }
  });

  it('prunes when budget would go negative', () => {
    const state = makeState({ budgetRemaining: 100_000, dayIndex: 0 });
    const slots = [
      makeSlot({ placeId: 1, slotOrder: 0, estimatedCost: 80_000 }),
    ];
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints(slots, state, makeEvolver(0), placeMap);

    // After slot 0, budgetFloor = 20_000. Inserting cost 50_000 → goes negative → prune
    expect(canPrune({
      operator: 'INSERT_ALT', insertIndex: 1, newPlaceId: 99,
      newSlotDuration: 30, newSlotCost: 50_000,
    }, slots, windows)).toBe(true);
  });

  it('does NOT prune when slack is sufficient and budget is fine', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), budgetRemaining: 1_000_000, dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, slotOrder: 0, estimatedCost: 50_000, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    // Plenty of slack (EFS=480, LFS=1290, slack=810), budget fine → no prune
    expect(canPrune({
      operator: 'INSERT_ALT', insertIndex: 0, newPlaceId: 99,
      newSlotDuration: 60, newSlotCost: 10_000,
    }, [slot], windows)).toBe(false);
  });
});

describe('canPrune — REPLACE_PLACE', () => {
  it('prunes when new duration is longer and drift exceeds slack', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    // Pack 6 slots of 90 min — last slot will have very little slack
    const slots = Array.from({ length: 6 }, (_, i) =>
      makeSlot({ placeId: i + 1, slotOrder: i, dayIndex: 0, estimatedCost: 10_000 }),
    );
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 90)]));
    const windows = propagateConstraints(slots, state, makeEvolver(15), placeMap);

    // Replace slot 0 (90 min) with a 300 min place. Drift = 210.
    // If windows[0].slack < 210, prune.
    const w0 = windows[0]!;
    const shouldPrune = 210 > w0.slack;
    expect(canPrune({
      operator: 'REPLACE_PLACE', slotIndex: 0, newPlaceId: 99, newSlotDuration: 300,
    }, slots, windows)).toBe(shouldPrune);
  });

  it('does NOT prune when new duration <= old duration', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const slots = Array.from({ length: 4 }, (_, i) =>
      makeSlot({ placeId: i + 1, slotOrder: i, dayIndex: 0, estimatedCost: 10_000 }),
    );
    const placeMap = new Map(slots.map((s) => [s.placeId, makePlace(s.placeId, 90)]));
    const windows = propagateConstraints(slots, state, makeEvolver(10), placeMap);

    // Replace slot 0 (90 min) with 45-min place → shorter → never prune
    expect(canPrune({
      operator: 'REPLACE_PLACE', slotIndex: 0, newPlaceId: 99, newSlotDuration: 45,
    }, slots, windows)).toBe(false);
  });
});

describe('canPrune — DROP_SLOT / TSP_REORDER', () => {
  it('never prunes DROP_SLOT', () => {
    const state = makeState({ dayIndex: 0 });
    const slots = [makeSlot({ placeId: 1 })];
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints(slots, state, makeEvolver(), placeMap);
    expect(canPrune({ operator: 'DROP_SLOT', slotIndex: 0 }, slots, windows)).toBe(false);
  });

  it('never prunes TSP_REORDER', () => {
    const state = makeState({ dayIndex: 0 });
    const slots = [makeSlot({ placeId: 1 })];
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints(slots, state, makeEvolver(), placeMap);
    expect(canPrune({ operator: 'TSP_REORDER' }, slots, windows)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multi-day plan integration test
// ---------------------------------------------------------------------------

describe('Multi-day plan', () => {
  it('handles 2-day plan with correct EFS clamping and LFS isolation', () => {
    const state = makeState({ capturedAt: vnTime('08:00'), dayIndex: 0 });
    const day0a = makeSlot({ placeId: 1, dayIndex: 0, slotOrder: 0 });
    const day0b = makeSlot({ placeId: 2, dayIndex: 0, slotOrder: 1 });
    const day1a = makeSlot({ placeId: 3, dayIndex: 1, slotOrder: 0 });
    const day1b = makeSlot({ placeId: 4, dayIndex: 1, slotOrder: 1 });
    const placeMap = new Map([
      [1, makePlace(1, 60)], [2, makePlace(2, 60)],
      [3, makePlace(3, 60)], [4, makePlace(4, 60)],
    ]);
    const windows = propagateConstraints([day0a, day0b, day1a, day1b], state, makeEvolver(15), placeMap);

    // EFS[2] (first day-1 slot) must be >= morningStart(1)
    expect(windows[2]!.efs).toBeGreaterThanOrEqual(morningStartOf(1));
    // LFS[1] (last day-0 slot) bounded by day 0 night limit
    expect(windows[1]!.lfs).toBeLessThanOrEqual(nightLimitOf(0) - 60);
    // LFS[2] bounded by day 1 night limit
    expect(windows[2]!.lfs).toBeLessThanOrEqual(nightLimitOf(1) - 60);

    // LFS[1] must NOT be influenced by LFS[2] (different days)
    // Specifically it's bounded only by nightLimit(0) - duration[1]
    expect(windows[1]!.lfs).toBe(nightLimitOf(0) - 60);
  });
});

// ---------------------------------------------------------------------------
// Pruning soundness: canPrune=true implies infeasible-to-shift
// ---------------------------------------------------------------------------

describe('Pruning soundness', () => {
  it('TIME_SHIFT prune=true means shifted slot would overflow night limit', () => {
    // Single slot with EFS at night limit - 30: shift +60 would overflow
    const state = makeState({ capturedAt: vnTime('22:00'), dayIndex: 0 });
    const slot = makeSlot({ placeId: 1, dayIndex: 0 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(0), placeMap);

    // EFS = max(capturedAt=22:00=1320, morningStart=480) = 1320
    // LFS = 1350 - 60 = 1290 (night limit - duration)
    // EFS(1320) > LFS(1290) → plan is already infeasible, so slack < 0
    // Any positive shift would push EFS further above LFS
    const result = canPrune({ operator: 'TIME_SHIFT', slotIndex: 0, deltaMin: 30 }, [slot], windows);
    // EFS + 30 = 1350 > LFS = 1290 → pruned
    expect(result).toBe(true);
  });

  it('missing required fields → conservative false (never incorrectly prune)', () => {
    const state = makeState({ dayIndex: 0 });
    const slot = makeSlot({ placeId: 1 });
    const placeMap = new Map([[1, makePlace(1, 60)]]);
    const windows = propagateConstraints([slot], state, makeEvolver(), placeMap);

    // TIME_SHIFT with missing slotIndex → false
    expect(canPrune({ operator: 'TIME_SHIFT' }, [slot], windows)).toBe(false);
    // SWAP_ORDER with missing indexA → false
    expect(canPrune({ operator: 'SWAP_ORDER' }, [slot], windows)).toBe(false);
    // INSERT_ALT with missing insertIndex → false
    expect(canPrune({ operator: 'INSERT_ALT', newPlaceId: 1, newSlotDuration: 60 }, [slot], windows)).toBe(false);
  });
});
