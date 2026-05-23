/**
 * SPEC-02: Temporal Constraint Propagation
 *
 * Precomputes feasibility windows [EFS, LFS] for every slot in a plan.
 * These windows are consumed by CandidatePruner to reject mutation candidates
 * before the expensive repairSuffix + computeTrajectory path.
 *
 * Cost: O(3N) per beam node per iteration.
 * Breakeven: 2 pruned candidates (saves 2×2N repair+evolve ops, costs 3N propagation ops).
 */

import type { TripSlot, TripState, Place } from '@app/types';
import type { StateEvolver } from './StateEvolver';

// ---------------------------------------------------------------------------
// Constants — must match MutationOperators to stay consistent
// ---------------------------------------------------------------------------

/** Vietnam UTC offset in milliseconds (GMT+7). */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Minimum slot duration used by repairSuffix. */
const MIN_SLOT_DURATION_MIN = 15;

/**
 * Night limit in minutes-from-midnight (VN local).
 * 22:30 = 22*60+30 = 1350.
 * Matches the DAY_END_HOUR=22 + maxOverflowMinutes default (30) in MutationOperators.
 */
const NIGHT_LIMIT_LOCAL_MIN = 22 * 60 + 30;

/** Morning start in minutes-from-midnight (VN local). 08:00 = 480. */
const MORNING_START_LOCAL_MIN = 8 * 60;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Feasibility window for a single slot in the current plan.
 * Computed once per beam node; reused across all candidate pruning checks.
 */
export interface FeasibilityWindow {
  /**
   * Earliest Feasible Start: soonest this slot can begin, in absolute minutes
   * (dayIndex × 1440 + VN local HH:MM). Computed via forward pass from capturedAt.
   */
  efs: number;
  /**
   * Latest Feasible Start: latest this slot can begin such that the entire suffix
   * still fits before the night limit. Computed via backward pass from nightLimitOf(lastDay).
   */
  lfs: number;
  /**
   * LFS − EFS. Negative → plan is already infeasible at this slot.
   * Zero → slot is pinned (no flexibility).
   */
  slack: number;
  /**
   * Lower bound on budget remaining after visiting this slot.
   * Uses slot.estimatedCost accumulated forward from initialState.budgetRemaining.
   */
  budgetFloor: number;
  /**
   * Upper bound on fatigue after visiting this slot.
   * Uses worst-case terrain load (1.0) and double travel load per the spec.
   * Heuristic: actual fatigue ≤ fatigueCeiling.
   */
  fatigueCeiling: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a UTC ISO timestamp to absolute minutes in the trip's logical time scale:
 *   dayIndex × 1440 + VN_local_HH × 60 + VN_local_MM
 *
 * [Decision 2]: We work in absolute minutes anchored to trip dayIndex rather than
 * calendar dates. dayIndex=0 is "day 1 of the trip", not a specific calendar date.
 */
function isoToAbsoluteMinutes(dayIndex: number, isoUtc: string): number {
  const localMs = new Date(isoUtc).getTime() + VN_OFFSET_MS;
  const localDate = new Date(localMs);
  const minInDay = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  return dayIndex * 1440 + minInDay;
}

/**
 * Night limit of a trip day in absolute minutes.
 * 22:30 VN local on dayIndex D = D × 1440 + 1350.
 */
export function nightLimitOf(dayIndex: number): number {
  return dayIndex * 1440 + NIGHT_LIMIT_LOCAL_MIN;
}

/**
 * Morning start of a trip day in absolute minutes.
 * 08:00 VN local on dayIndex D = D × 1440 + 480.
 */
export function morningStartOf(dayIndex: number): number {
  return dayIndex * 1440 + MORNING_START_LOCAL_MIN;
}

/**
 * Duration of a slot in minutes.
 * Prefers place.avgVisitDurationMin (matching repairSuffix's targetDurationMs),
 * falls back to the slot's planned interval, then to 60 min.
 *
 * [Decision 3]: Using avgVisitDurationMin rather than the slot interval ensures
 * consistency with repairSuffix, which always uses max(15, avgVisitDurationMin).
 */
export function durationMinOf(slot: TripSlot, placeMap: Map<number, Place>): number {
  const place = placeMap.get(slot.placeId);
  if (place) return Math.max(MIN_SLOT_DURATION_MIN, place.avgVisitDurationMin);
  const startMs = new Date(slot.plannedStart).getTime();
  const endMs = new Date(slot.plannedEnd).getTime();
  if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
    return (endMs - startMs) / 60_000;
  }
  return 60;
}

/** Haversine travel time (minutes) between two consecutive slots, using StateEvolver. */
function travelBetweenSlots(
  prev: TripSlot,
  curr: TripSlot,
  placeMap: Map<number, Place>,
  evolver: StateEvolver,
): number {
  const prevPlace = placeMap.get(prev.placeId);
  const currPlace = placeMap.get(curr.placeId);
  if (!prevPlace || !currPlace) return 0;
  return evolver.estimateTravelTime(prevPlace.lat, prevPlace.lng, currPlace.lat, currPlace.lng);
}

// ---------------------------------------------------------------------------
// Forward pass: Earliest Feasible Start
// ---------------------------------------------------------------------------

/**
 * Computes EFS[i] for each slot — the earliest absolute minute slot i can start,
 * given all slots before it complete first (including travel).
 *
 * Seed: EFS[0] = max(capturedAtAbsMin, morningStartOf(plan[0].dayIndex))
 * Recurrence: EFS[i] = EFS[i-1] + duration[i-1] + travel[i-1 → i]
 *             If plan[i].dayIndex > plan[i-1].dayIndex: clamp to morningStartOf(plan[i].dayIndex)
 */
export function computeEFS(
  plan: TripSlot[],
  initialState: TripState,
  evolver: StateEvolver,
  placeMap: Map<number, Place>,
): number[] {
  const n = plan.length;
  if (n === 0) return [];

  const efs = new Array<number>(n);

  // [Decision 9]: capturedAt + dayIndex gives absolute minutes of "now" in trip time.
  const capturedAtAbsMin = isoToAbsoluteMinutes(initialState.dayIndex, initialState.capturedAt);
  efs[0] = Math.max(capturedAtAbsMin, morningStartOf(plan[0]!.dayIndex));

  for (let i = 1; i < n; i++) {
    const prev = plan[i - 1]!;
    const curr = plan[i]!;

    const prevDuration = durationMinOf(prev, placeMap);
    const travelMin = travelBetweenSlots(prev, curr, placeMap, evolver);

    let earliest = efs[i - 1]! + prevDuration + travelMin;

    // Day boundary: next-day slot can't start before morning, even if predecessor ends early.
    if (curr.dayIndex > prev.dayIndex) {
      earliest = Math.max(earliest, morningStartOf(curr.dayIndex));
    }

    efs[i] = earliest;
  }

  return efs;
}

// ---------------------------------------------------------------------------
// Backward pass: Latest Feasible Start
// ---------------------------------------------------------------------------

/**
 * Computes LFS[i] for each slot — the latest absolute minute slot i can start
 * such that every subsequent slot still finishes before its day's night limit.
 *
 * Seed: LFS[n-1] = nightLimitOf(lastSlot.dayIndex) - duration[n-1]
 * Recurrence: LFS[i] = LFS[i+1] - travel[i → i+1] - duration[i]
 *             Always clamped to: min(result, nightLimitOf(plan[i].dayIndex) - duration[i])
 *
 * [Decision 8]: When plan[i+1].dayIndex > plan[i].dayIndex, the overnight gap resets the
 * clock, so LFS[i] is bounded only by its own day's night limit (not LFS[i+1]).
 */
export function computeLFS(
  plan: TripSlot[],
  evolver: StateEvolver,
  placeMap: Map<number, Place>,
): number[] {
  const n = plan.length;
  if (n === 0) return [];

  const lfs = new Array<number>(n);

  const lastSlot = plan[n - 1]!;
  const lastDuration = durationMinOf(lastSlot, placeMap);
  lfs[n - 1] = nightLimitOf(lastSlot.dayIndex) - lastDuration;

  for (let i = n - 2; i >= 0; i--) {
    const curr = plan[i]!;
    const next = plan[i + 1]!;

    const currDuration = durationMinOf(curr, placeMap);
    const travelMin = travelBetweenSlots(curr, next, placeMap, evolver);

    let latest: number;
    if (next.dayIndex > curr.dayIndex) {
      // Overnight gap: curr is only bounded by its own day's night limit.
      latest = nightLimitOf(curr.dayIndex) - currDuration;
    } else {
      latest = lfs[i + 1]! - travelMin - currDuration;
      // Can never start later than the night limit allows.
      latest = Math.min(latest, nightLimitOf(curr.dayIndex) - currDuration);
    }

    lfs[i] = latest;
  }

  return lfs;
}

// ---------------------------------------------------------------------------
// Forward pass: Budget floor and fatigue ceiling
// ---------------------------------------------------------------------------

/**
 * Budget floor: exact lower bound on budgetRemaining after visiting each slot.
 * Accumulated as: budgetFloor[i] = budgetFloor[i-1] - slot[i].estimatedCost
 *
 * Fatigue ceiling: pessimistic upper bound, using:
 *   - travelLoad = travelMin / 60  (spec formula; 2× the actual travelLoad = travelMin/120)
 *   - terrainLoad contribution = 0.10 × 1.0  (worst-case terrain, actual ≤ 1.0)
 *   - Recovery IS applied for meal/rest (their recovery is deterministic)
 *
 * [Decision 7]: fatigueCeiling is a heuristic upper bound; it may overestimate actual
 * fatigue significantly for plans with mostly flat terrain and short travel times.
 * The 0.90 INSERT_ALT prune threshold is therefore also a heuristic, not provably sound.
 */
export function computeBudgetAndFatigueBounds(
  plan: TripSlot[],
  initialState: TripState,
  evolver: StateEvolver,
  placeMap: Map<number, Place>,
): { budgetFloor: number[]; fatigueCeiling: number[] } {
  const n = plan.length;
  const budgetFloor = new Array<number>(n);
  const fatigueCeiling = new Array<number>(n);

  let budget = initialState.budgetRemaining;
  let fatigue = initialState.fatigue;

  for (let i = 0; i < n; i++) {
    const slot = plan[i]!;

    // Budget: exact (estimatedCost is deterministic).
    budget -= slot.estimatedCost;
    budgetFloor[i] = budget;

    // Fatigue: worst-case upper bound.
    let travelMin = 0;
    if (i > 0) {
      travelMin = travelBetweenSlots(plan[i - 1]!, slot, placeMap, evolver);
    }
    // Spec formula: travelLoad = travelMin/60 (pessimistic vs actual /120)
    const travelLoad = travelMin / 60;
    // Worst-case terrain = 1.0; actual terrainLoad = (1 - terrainEasiness) * (duration/60)
    const durationMin = durationMinOf(slot, placeMap);
    const terrainLoad = 1.0 * (durationMin / 60);

    let fatigueDelta = 0.05 * travelLoad + 0.10 * terrainLoad;
    // Recovery is deterministic — apply it to tighten the bound.
    if (slot.activityType === 'meal') fatigueDelta -= 0.12;
    if (slot.activityType === 'rest') fatigueDelta -= 0.20;

    fatigue = Math.max(0, Math.min(1, fatigue + fatigueDelta));
    fatigueCeiling[i] = fatigue;
  }

  return { budgetFloor, fatigueCeiling };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes feasibility windows for every slot in the plan.
 * Call once per beam node per iteration — O(3N).
 *
 * @param plan         Current plan (future slots only, i.e. remainingSlots).
 * @param initialState Current TripState (capturedAt, dayIndex, budgetRemaining, fatigue).
 * @param evolver      StateEvolver for travel time estimation.
 * @param placeMap     Pre-built placeId → Place map for O(1) lookups.
 * @returns            Array of FeasibilityWindow, one per slot, in plan order.
 */
export function propagateConstraints(
  plan: TripSlot[],
  initialState: TripState,
  evolver: StateEvolver,
  placeMap: Map<number, Place>,
): FeasibilityWindow[] {
  if (plan.length === 0) return [];

  const efs = computeEFS(plan, initialState, evolver, placeMap);
  const lfs = computeLFS(plan, evolver, placeMap);
  const { budgetFloor, fatigueCeiling } = computeBudgetAndFatigueBounds(
    plan, initialState, evolver, placeMap,
  );

  return plan.map((_, i) => ({
    efs: efs[i]!,
    lfs: lfs[i]!,
    slack: lfs[i]! - efs[i]!,
    budgetFloor: budgetFloor[i]!,
    fatigueCeiling: fatigueCeiling[i]!,
  }));
}
