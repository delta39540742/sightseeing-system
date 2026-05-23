import type { TripSlot, TripState } from '@app/types';

// ---------------------------------------------------------------------------
// Per-slot score breakdown (raw unweighted values)
// ---------------------------------------------------------------------------

/**
 * Decomposed score contributions for a single slot.
 * All values are RAW (unweighted) so they can be reused with different weight
 * vectors and weighted at summation time.
 *
 * Sign convention matches the contribution direction in ObjectiveScorer:
 *   interest, potentialBias, proximity  → positive = good
 *   distance, budget, risk              → negative or zero (penalties)
 *   weather                             → can be positive (indoor in rain) or negative
 */
export interface SlotScoreBreakdown {
  interest: number;
  distance: number;
  budget: number;
  weather: number;
  risk: number;
  potentialBias: number;
  proximity: number;
}

// ---------------------------------------------------------------------------
// Plan-level score breakdown (incrementally updatable)
// ---------------------------------------------------------------------------

export interface PlanScoreBreakdown {
  pace: number;
  /** Sum of all pairwise synergy scores. */
  synergy: number;
  /** synergyPairs[i] = synergy between slot i and slot i+1. length = plan.length - 1 */
  synergyPairs: number[];
  // NOTE: stability is NOT cached here because it depends on mutation history,
  // which grows with each beam iteration and cannot be shared between nodes.
}

// ---------------------------------------------------------------------------
// TrajectoryCache
// ---------------------------------------------------------------------------

/**
 * Per-node cache that enables incremental trajectory simulation and scoring.
 *
 * Convention for states (matches computeTrajectory output):
 *   states[0]   = initialState (before any slot is visited)
 *   states[i+1] = state AFTER visiting plan[i]
 *   length      = plan.length + 1
 */
export interface TrajectoryCache {
  states: TripState[];
  /** Per-slot raw score contributions, parallel to plan[]. */
  slotScores: SlotScoreBreakdown[];
  planScores: PlanScoreBreakdown;
  /**
   * Cheap structural fingerprint of the plan at cache-write time.
   * Used to detect stale caches; NOT a cryptographic hash.
   */
  planHash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cheap structural fingerprint: placeId + dayIndex + slotOrder + plannedStart + plannedEnd.
 * Two plans with the same fingerprint are structurally identical.
 */
export function computePlanHash(plan: TripSlot[]): string {
  return plan
    .map(
      (s) =>
        `${s.placeId}:${s.dayIndex}:${s.slotOrder}:${s.plannedStart}:${s.plannedEnd}`,
    )
    .join('|');
}

/** Zero-value breakdown used as a sentinel when a slot's place cannot be resolved. */
export const ZERO_SLOT_SCORE: SlotScoreBreakdown = Object.freeze({
  interest: 0,
  distance: 0,
  budget: 0,
  weather: 0,
  risk: 0,
  potentialBias: 0,
  proximity: 0,
});
