/**
 * SPEC-02: Candidate Pruner
 *
 * Defines the ProposedMutation interface (Phase 1 output of generateAllProposed)
 * and the canPrune() dispatcher that uses FeasibilityWindows to reject candidates
 * before the expensive repairSuffix + computeTrajectory path.
 *
 * Soundness guarantee per operator:
 *   TIME_SHIFT(+δ): sound — if EFS+δ > LFS, suffix definitely overflows.
 *   INSERT_ALT (temporal): sound — if slack < newSlotDuration, suffix overflows.
 *   INSERT_ALT (budget): sound — budgetFloor goes negative.
 *   INSERT_ALT (fatigue ≥ 0.90): heuristic only — fatigueCeiling is pessimistic.
 *   SWAP_ORDER: sound — if the duration-drift pushes last slot past its LFS.
 *   REPLACE_PLACE: sound — if durationDrift > slack, suffix overflows.
 *   DROP_SLOT, TSP_REORDER: never pruned (DROP relaxes constraints; TSP can't be bounded cheaply).
 *   TIME_SHIFT(−δ): heuristic — prunes shifts that would place a slot before morning start.
 */

import type { TripSlot } from '@app/types';
import type { OperatorName, MutationResult } from './MutationOperators';
import type { FeasibilityWindow } from './ConstraintPropagation';
import { morningStartOf } from './ConstraintPropagation';

// ---------------------------------------------------------------------------
// ProposedMutation
// ---------------------------------------------------------------------------

/**
 * Lightweight metadata for a mutation candidate — produced by generateAllProposed()
 * before any expensive computation. CandidatePruner filters these; survivors go to
 * materializeMutation() which runs repairSuffix + computeTrajectory.
 *
 * [Decision 4]: TSP_REORDER cannot be proposed cheaply (2-opt IS the computation),
 * so TSP proposals carry a pre-computed _materialized field that materializeMutation
 * returns directly.
 *
 * [Decision 6]: Deduplication in generateAllProposed is parameter-based (operator +
 * primary targets), not plan-signature-based (which requires full materialization).
 */
export interface ProposedMutation {
  /** Which operator this proposal comes from. */
  operator: OperatorName;

  // ---- TIME_SHIFT ----
  /** Index of the slot being shifted. */
  slotIndex?: number;
  /** Delta in minutes: −60, −30, +30, +60. */
  deltaMin?: number;

  // ---- SWAP_ORDER ----
  /** Index of first slot in the swap pair (always < indexB). */
  indexA?: number;
  /** Index of second slot in the swap pair. */
  indexB?: number;

  // ---- REPLACE_PLACE / INSERT_ALT ----
  /** PlaceId of the new place (for REPLACE or INSERT). */
  newPlaceId?: number;
  /**
   * Estimated visit duration of the new place in minutes.
   * Used by CandidatePruner to check temporal feasibility before materializing.
   */
  newSlotDuration?: number;
  /**
   * Estimated cost of the new place.
   * Used by CandidatePruner for budget pruning.
   */
  newSlotCost?: number;

  // ---- INSERT_ALT ----
  /** Position at which the new slot will be inserted (0-indexed). */
  insertIndex?: number;

  // ---- TSP_REORDER (pre-computed opaque result) ----
  /**
   * Pre-computed MutationResult for TSP_REORDER.
   * materializeMutation returns this directly — no further work needed.
   * Exists because 2-opt cannot be split into a cheap "propose" step.
   */
  _materialized?: MutationResult;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Slot duration in minutes from planned timestamps.
 *
 * [Decision 10]: We use the slot's planned interval rather than placeMap lookup because
 * the pruner doesn't receive a placeMap. After repairSuffix, intervals equal
 * max(15, avgVisitDurationMin), consistent with what ConstraintPropagation uses.
 */
function slotDurationMin(slot: TripSlot): number {
  const startMs = new Date(slot.plannedStart).getTime();
  const endMs = new Date(slot.plannedEnd).getTime();
  if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs) {
    return (endMs - startMs) / 60_000;
  }
  return 60; // fallback
}

/** Returns the last index in the plan where slot.dayIndex === targetDay, or -1. */
function lastSlotIndexInDay(plan: TripSlot[], targetDay: number): number {
  for (let i = plan.length - 1; i >= 0; i--) {
    if (plan[i]!.dayIndex === targetDay) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Per-operator pruning functions
// ---------------------------------------------------------------------------

/**
 * Prune TIME_SHIFT(+δ): sound.
 *   EFS[i] is the optimistic (earliest possible) start of slot i.
 *   Shifting later by δ means the slot can start no earlier than EFS[i]+δ.
 *   If EFS[i]+δ > LFS[i], the suffix definitely overflows the night limit.
 *
 * Prune TIME_SHIFT(−δ): heuristic.
 *   If the shifted position falls before morning start, the slot would be scheduled
 *   before 08:00 VN (repairSuffix does not correct slot i itself, only the suffix).
 */
function pruneTimeShift(
  slotIndex: number,
  deltaMin: number,
  plan: TripSlot[],
  windows: FeasibilityWindow[],
): boolean {
  const w = windows[slotIndex];
  if (!w) return false;

  if (deltaMin > 0) {
    // Sound: if earliest start + shift > latest feasible start, overflow guaranteed.
    return (w.efs + deltaMin) > w.lfs;
  }

  if (deltaMin < 0) {
    // Heuristic: prune if shift would go before morning start.
    const dayIndex = Math.floor(w.efs / 1440);
    const dayMorning = morningStartOf(dayIndex);
    return (w.efs + deltaMin) < dayMorning;
  }

  return false;
}

/**
 * Prune SWAP_ORDER: sound when drift > 0 and last-slot-in-day slack is exceeded.
 *
 * Swapping slots A and B (A before B, same day) changes the duration at position A from
 * dA to dB. If dB > dA (drift > 0), every slot on that day after A is pushed later by
 * at least (dB − dA) minutes. If the last slot in that day already has EFS close to LFS,
 * this drift will overflow.
 */
function pruneSwap(
  indexA: number,
  indexB: number,
  plan: TripSlot[],
  windows: FeasibilityWindow[],
): boolean {
  const slotA = plan[indexA];
  const slotB = plan[indexB];
  if (!slotA || !slotB) return false;

  const dA = slotDurationMin(slotA);
  const dB = slotDurationMin(slotB);
  const drift = dB - dA; // positive means A's position now holds a longer slot

  if (drift <= 0) return false; // swap reduces time → never overflows

  const dayIndex = slotA.dayIndex;
  const lastInDay = lastSlotIndexInDay(plan, dayIndex);
  if (lastInDay < 0) return false;

  const wLast = windows[lastInDay];
  if (!wLast) return false;

  // If the last slot in the day is pushed by drift minutes, does it overflow?
  return (wLast.efs + drift) > wLast.lfs;
}

/**
 * Prune INSERT_ALT:
 *   (a) Temporal — sound: slack at insertIndex < newSlotDuration → suffix overflows.
 *   (b) Budget   — sound: budgetFloor after insert goes negative.
 *   (c) Fatigue  — heuristic: ceiling at insertIndex-1 ≥ 0.90 → likely over cap.
 *
 * [Decision 7]: The fatigue check is documented as heuristic-only.
 */
function pruneInsert(
  insertIndex: number,
  newSlotDuration: number,
  newSlotCost: number,
  plan: TripSlot[],
  windows: FeasibilityWindow[],
): boolean {
  // (a) Temporal: slack at insertion point must accommodate the new slot's duration.
  if (insertIndex < windows.length) {
    const w = windows[insertIndex];
    if (w && w.slack < newSlotDuration) return true;
  }

  // (b) Budget: estimate budget floor after inserting this slot.
  const budgetRef = insertIndex > 0
    ? (windows[insertIndex - 1]?.budgetFloor ?? windows[0]?.budgetFloor ?? 0)
    : (windows[0]?.budgetFloor ?? 0);
  if (budgetRef - newSlotCost < 0) return true;

  // (c) Fatigue (heuristic): if ceiling is already near the cap, adding more is risky.
  if (insertIndex > 0) {
    const wPrev = windows[insertIndex - 1];
    if (wPrev && wPrev.fatigueCeiling >= 0.90) return true;
  }

  return false;
}

/**
 * Prune REPLACE_PLACE: sound when new duration is longer than current.
 *   If newDuration > oldDuration (drift > 0) and drift > slack[slotIndex],
 *   the suffix is guaranteed to overflow.
 *   If newDuration ≤ oldDuration, the replacement can only improve or maintain timing.
 */
function pruneReplace(
  slotIndex: number,
  newDuration: number,
  plan: TripSlot[],
  windows: FeasibilityWindow[],
): boolean {
  const slot = plan[slotIndex];
  if (!slot) return false;

  const oldDuration = slotDurationMin(slot);
  const durationDrift = newDuration - oldDuration;

  if (durationDrift <= 0) return false; // shorter or equal → timing is relaxed

  const w = windows[slotIndex];
  if (!w) return false;

  return durationDrift > w.slack;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when the mutation is CERTAINLY infeasible and can be pruned before
 * repairSuffix + computeTrajectory.
 *
 * Returns false when infeasibility is NOT certain (candidate must be materialized).
 *
 * Sound: if this returns true, the candidate would fail isFeasible() after full
 * simulation — with the heuristic exception documented in [Decision 7].
 *
 * @param mutation  Lightweight proposal from generateAllProposed().
 * @param plan      Parent plan (used to read slot durations and dayIndex).
 * @param windows   FeasibilityWindow[] from propagateConstraints() for this parent.
 */
export function canPrune(
  mutation: ProposedMutation,
  plan: TripSlot[],
  windows: FeasibilityWindow[],
): boolean {
  switch (mutation.operator) {
    case 'TIME_SHIFT':
      if (mutation.slotIndex == null || mutation.deltaMin == null) return false;
      return pruneTimeShift(mutation.slotIndex, mutation.deltaMin, plan, windows);

    case 'SWAP_ORDER':
      if (mutation.indexA == null || mutation.indexB == null) return false;
      return pruneSwap(mutation.indexA, mutation.indexB, plan, windows);

    case 'INSERT_ALT':
      if (mutation.insertIndex == null ||
        mutation.newSlotDuration == null ||
        mutation.newSlotCost == null) return false;
      return pruneInsert(
        mutation.insertIndex,
        mutation.newSlotDuration,
        mutation.newSlotCost,
        plan,
        windows,
      );

    case 'REPLACE_PLACE':
      if (mutation.slotIndex == null || mutation.newSlotDuration == null) return false;
      return pruneReplace(mutation.slotIndex, mutation.newSlotDuration, plan, windows);

    case 'DROP_SLOT':
      return false; // DROP always relaxes constraints — never prune.

    case 'TSP_REORDER':
      return false; // TSP reorders without changing total duration — cannot bound cheaply.

    default:
      return false; // Unknown operator: conservative, don't prune.
  }
}
