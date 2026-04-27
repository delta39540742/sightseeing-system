import { randomUUID } from 'crypto';
import type { TripSlot, Place } from '@app/types';
import type { StateEvolver, ReplanContext } from './StateEvolver';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The five neighborhood operators available to the replanner. */
export type OperatorName =
  | 'TIME_SHIFT'    // OP-1: shift slot time ±30 / ±60 min
  | 'SWAP_ORDER'    // OP-2: swap two adjacent slots within the same day
  | 'REPLACE_PLACE' // OP-3: replace a POI with a tag-compatible alternative
  | 'DROP_SLOT'     // OP-4: remove a non-meal slot entirely
  | 'INSERT_ALT';   // OP-5: insert a new POI from the candidate pool

/**
 * The result of applying one mutation operator to a plan.
 *
 * Scoring is NOT performed here — that is the responsibility of
 * {@link BeamSearch}, which scores each candidate after expansion.
 */
export interface MutationResult {
  /** New plan (deep-cloned array; original plan is never mutated). */
  newPlan: TripSlot[];
  /** Which operator produced this result. */
  operator: OperatorName;
  /** slotIds affected by the mutation (for causal trace annotation). */
  affectedSlotIds: string[];
  /** Human-readable description in Vietnamese (for CausalTraceBuilder). */
  description: string;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Minute offsets tried by TIME_SHIFT. */
const TIME_SHIFT_DELTAS_MIN = [-60, -30, 30, 60] as const;

/** Max replacement candidates evaluated per slot in REPLACE_PLACE. */
const MAX_REPLACE_CANDIDATES = 3;

/** Max new places considered by INSERT_ALT when no forceIncludePlaceId. */
const MAX_INSERT_CANDIDATES = 5;

/** Hard cap on total results returned by generateAll (latency control). */
const GENERATE_ALL_CAP = 30;

/**
 * Vietnam standard offset in milliseconds (GMT+7).
 * Used to convert UTC timestamps to local time when checking opening hours.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// MutationOperators
// ---------------------------------------------------------------------------

/**
 * Five neighborhood-mutation operators for beam-search replanning.
 *
 * ### Invariants
 * - Every operator returns **copies** of the input plan (no in-place mutation).
 * - Every result satisfies the hard constraints visible at generation time.
 *   Infeasible candidates (budget, time, fatigue) are filtered via
 *   {@link allFeasible}, which runs a full state trajectory simulation.
 *   Scheduling violations are filtered via {@link withinOpeningHours}.
 * - {@link generateAll} caps the combined output at {@link GENERATE_ALL_CAP}
 *   entries to bound latency.
 */
export class MutationOperators {
  constructor(private readonly evolver: StateEvolver) {}

  // -------------------------------------------------------------------------
  // OP-1 TIME_SHIFT
  // -------------------------------------------------------------------------

  /**
   * Shifts slot `i` earlier or later by 30 or 60 minutes and cascades the
   * same shift to all subsequent slots in the plan.
   *
   * Only produces a result when the shifted slot still falls within the
   * place's opening hours. Useful when a fatigue spike occurs early and a
   * meal/rest slot needs to be pulled forward for recovery.
   *
   * @param plan Ordered list of {@link TripSlot}s for the current day.
   * @param ctx  {@link ReplanContext} providing the candidate pool (for opening hours).
   * @returns    List of valid {@link MutationResult}s (may be empty).
   */
  timeShift(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length; i++) {
      const anchor = plan[i]!;
      for (const shiftMin of TIME_SHIFT_DELTAS_MIN) {
        // Build new plan: shift slot i, then cascade chỉ trong cùng ngày để
        // không kéo lệch lịch các ngày sau.
        const newPlan = [...plan];
        const shifted = this.shiftSlot(anchor, shiftMin);

        // Only proceed if the anchor slot's new time is within opening hours
        if (!this.withinOpeningHours(shifted, ctx)) continue;

        newPlan[i] = shifted;
        for (let j = i + 1; j < newPlan.length; j++) {
          if (newPlan[j]!.dayIndex !== anchor.dayIndex) break;
          newPlan[j] = this.shiftSlot(newPlan[j]!, shiftMin);
        }

        results.push({
          newPlan,
          operator: 'TIME_SHIFT',
          affectedSlotIds: [anchor.slotId],
          description: `Dời slot ${i} đi ${shiftMin > 0 ? '+' : ''}${shiftMin} phút`,
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // OP-2 SWAP_ORDER
  // -------------------------------------------------------------------------

  /**
   * Swaps the POI (placeId) of two adjacent slots that share the same
   * `dayIndex`, keeping each slot's time window in place.
   *
   * Cross-day swaps are never attempted. Plans that become infeasible after
   * the swap (budget, time, fatigue) are silently dropped.
   *
   * @param plan Ordered list of {@link TripSlot}s.
   * @param ctx  {@link ReplanContext}.
   * @returns    List of valid {@link MutationResult}s.
   */
  swapOrder(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length - 1; i++) {
      const a = plan[i]!;
      const b = plan[i + 1]!;

      // Guard: only swap within the same day
      if (a.dayIndex !== b.dayIndex) continue;

      // Swap placeIds; time windows stay fixed
      const newPlan = [...plan];
      newPlan[i] = { ...a, placeId: b.placeId };
      newPlan[i + 1] = { ...b, placeId: a.placeId };

      if (!this.allFeasible(newPlan, ctx)) continue;

      results.push({
        newPlan,
        operator: 'SWAP_ORDER',
        affectedSlotIds: [a.slotId, b.slotId],
        description: `Đổi thứ tự slot ${i} và ${i + 1}`,
      });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // OP-3 REPLACE_PLACE
  // -------------------------------------------------------------------------

  /**
   * Replaces the POI at slot `i` with up to {@link MAX_REPLACE_CANDIDATES}
   * alternatives from the candidate pool that share at least one tag with the
   * current POI and are not already present in the plan.
   *
   * This is the primary operator for rain-triggered replanning
   * (outdoor → indoor substitution).
   *
   * @param plan Ordered list of {@link TripSlot}s.
   * @param ctx  {@link ReplanContext} providing the candidate pool.
   * @returns    List of valid {@link MutationResult}s.
   */
  replacePlace(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length; i++) {
      const currentPlace = ctx.candidatePool.find(
        (p) => p.placeId === plan[i]!.placeId,
      );
      if (!currentPlace) continue;

      // Candidates: tag overlap > 0, not already in the plan, limit per slot
      const occupied = new Set(plan.map((s) => s.placeId));
      const candidates = ctx.candidatePool
        .filter(
          (p) =>
            p.placeId !== currentPlace.placeId &&
            this.tagOverlap(p, currentPlace) > 0 &&
            !occupied.has(p.placeId),
        )
        .slice(0, MAX_REPLACE_CANDIDATES);

      for (const alt of candidates) {
        const newPlan = [...plan];
        newPlan[i] = { ...plan[i]!, placeId: alt.placeId };

        if (!this.allFeasible(newPlan, ctx)) continue;

        results.push({
          newPlan,
          operator: 'REPLACE_PLACE',
          affectedSlotIds: [plan[i]!.slotId],
          description: `Thay ${currentPlace.name} bằng ${alt.name}`,
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // OP-4 DROP_SLOT
  // -------------------------------------------------------------------------

  /**
   * Removes one slot from the plan. Meal slots are **never** dropped because
   * the user still needs to eat.
   *
   * No trajectory feasibility check is performed: dropping a slot can only
   * relax time/budget constraints, never tighten them.
   *
   * @param plan Ordered list of {@link TripSlot}s.
   * @param _ctx Unused (kept for API consistency with other operators).
   * @returns    List of {@link MutationResult}s (one per non-meal slot).
   */
  dropSlot(plan: TripSlot[], _ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length; i++) {
      if (plan[i]!.activityType === 'meal') continue;

      const newPlan = plan.filter((_, idx) => idx !== i);
      results.push({
        newPlan,
        operator: 'DROP_SLOT',
        affectedSlotIds: [plan[i]!.slotId],
        description: `Bỏ slot ${i} (${plan[i]!.activityType})`,
      });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // OP-5 INSERT_ALT
  // -------------------------------------------------------------------------

  /**
   * Inserts a new POI (synthesized slot) at every possible position in the
   * plan. If {@link ReplanContext.forceIncludePlaceId} is set, only that
   * POI is tried (landmark-inject mode); otherwise the first
   * {@link MAX_INSERT_CANDIDATES} places from the pool are tried.
   *
   * Plans that become infeasible after insertion are silently dropped.
   *
   * @param plan Ordered list of {@link TripSlot}s.
   * @param ctx  {@link ReplanContext}.
   * @returns    List of valid {@link MutationResult}s.
   */
  insertAlt(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    // Determine which places to try inserting
    let insertable: Place[];
    if (ctx.forceIncludePlaceId !== undefined) {
      const forced = ctx.candidatePool.find(
        (p) => p.placeId === ctx.forceIncludePlaceId,
      );
      insertable = forced ? [forced] : [];
    } else {
      // Exclude places already present in the plan
      const occupied = new Set(plan.map((s) => s.placeId));
      insertable = ctx.candidatePool
        .filter((p) => !occupied.has(p.placeId))
        .slice(0, MAX_INSERT_CANDIDATES);
    }

    for (const place of insertable) {
      for (let pos = 0; pos <= plan.length; pos++) {
        const newSlot = this.synthesizeSlot(place, plan, pos, ctx);
        const newPlan = [
          ...plan.slice(0, pos),
          newSlot,
          ...plan.slice(pos),
        ];

        if (!this.allFeasible(newPlan, ctx)) continue;

        results.push({
          newPlan,
          operator: 'INSERT_ALT',
          affectedSlotIds: [newSlot.slotId],
          description: `Chèn ${place.name} ở vị trí ${pos}`,
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // generateAll
  // -------------------------------------------------------------------------

  /**
   * Runs all five operators and returns up to {@link GENERATE_ALL_CAP}
   * results, prioritising operators in spec order (TIME_SHIFT first, …).
   *
   * @param plan Ordered list of {@link TripSlot}s.
   * @param ctx  {@link ReplanContext}.
   * @returns    Up to 30 {@link MutationResult}s.
   */
  generateAll(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const all = [
      ...this.timeShift(plan, ctx),
      ...this.swapOrder(plan, ctx),
      ...this.replacePlace(plan, ctx),
      ...this.dropSlot(plan, ctx),
      ...this.insertAlt(plan, ctx),
    ];
    return all.slice(0, GENERATE_ALL_CAP);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Returns a new slot with `plannedStart` and `plannedEnd` shifted by
   * `minutes` minutes (positive = later, negative = earlier).
   * All other fields are unchanged.
   */
  private shiftSlot(slot: TripSlot, minutes: number): TripSlot {
    const shiftMs = minutes * 60_000;
    return {
      ...slot,
      plannedStart: new Date(
        new Date(slot.plannedStart).getTime() + shiftMs,
      ).toISOString(),
      plannedEnd: new Date(
        new Date(slot.plannedEnd).getTime() + shiftMs,
      ).toISOString(),
    };
  }

  /**
   * Returns `true` when the slot's local visit window fits within the place's
   * opening hours on that day of the week.
   *
   * Timezone: all comparisons are done in Vietnam local time (UTC+7).
   * Day-of-week convention: 0 = Monday (T2), 6 = Sunday (CN), matching the
   * spec's `PlaceOpeningHour.dayOfWeek` column.
   *
   * If the place has no opening hours registered, it is treated as always
   * open and `true` is returned.
   */
  private withinOpeningHours(slot: TripSlot, ctx: ReplanContext): boolean {
    const place = ctx.candidatePool.find((p) => p.placeId === slot.placeId);
    if (!place || place.openingHours.length === 0) return true;

    // Convert UTC → Vietnam local (UTC+7)
    const startLocalMs = new Date(slot.plannedStart).getTime() + VN_OFFSET_MS;
    const endLocalMs = new Date(slot.plannedEnd).getTime() + VN_OFFSET_MS;
    const startLocal = new Date(startLocalMs);
    const endLocal = new Date(endLocalMs);

    // js getUTCDay(): 0=Sun … 6=Sat  →  spec: 0=Mon … 6=Sun
    const jsDay = startLocal.getUTCDay();
    const dayOfWeek = (jsDay + 6) % 7;

    const hours = place.openingHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (!hours) return false; // closed on this day of the week

    const slotStartMin =
      startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes();
    const slotEndMin =
      endLocal.getUTCHours() * 60 + endLocal.getUTCMinutes();

    const [openH, openM] = hours.openTime.split(':').map(Number) as [
      number,
      number,
    ];
    const [closeH, closeM] = hours.closeTime.split(':').map(Number) as [
      number,
      number,
    ];
    const openMin = openH * 60 + openM;
    const closeMin = closeH * 60 + closeM;

    return slotStartMin >= openMin && slotEndMin <= closeMin;
  }

  /**
   * Simulates the full state trajectory through `plan` starting from
   * `ctx.initialState` and returns `true` only if every intermediate state
   * passes {@link StateEvolver.isFeasible}.
   *
   * Returns `false` on any thrown error (e.g. missing place in pool).
   */
  private allFeasible(plan: TripSlot[], ctx: ReplanContext): boolean {
    try {
      const trajectory = this.evolver.computeTrajectory(
        plan,
        ctx.initialState,
        ctx,
      );
      return trajectory.every((s) => this.evolver.isFeasible(s));
    } catch {
      return false;
    }
  }

  /**
   * Counts the number of tag IDs shared between two places.
   * Returns 0 when either place has no tags.
   */
  private tagOverlap(a: Place, b: Place): number {
    if (!a.tags.length || !b.tags.length) return 0;
    const bIds = new Set(b.tags.map((t) => t.tagId));
    return a.tags.filter((t) => bIds.has(t.tagId)).length;
  }

  /**
   * Synthesizes a new {@link TripSlot} for a given place at insertion
   * position `pos`.
   *
   * **Time window logic:**
   * - `pos > 0`: start immediately after the previous slot ends.
   * - `pos = 0` (insert at head): start at the next slot's start time.
   * - Empty plan: start at `ctx.initialState.capturedAt`.
   *
   * The cost is set to `place.minPrice ?? 0` (conservative estimate).
   * The synthetic `slotId` is a fresh UUID so accept-transaction inserts pass
   * the `slot_id @db.Uuid` constraint.
   */
  private synthesizeSlot(
    place: Place,
    plan: TripSlot[],
    pos: number,
    ctx: ReplanContext,
  ): TripSlot {
    const prev = pos > 0 ? plan[pos - 1] : undefined;
    const next = pos < plan.length ? plan[pos] : undefined;

    let plannedStart: string;
    if (prev) {
      plannedStart = prev.plannedEnd;
    } else if (next) {
      plannedStart = next.plannedStart;
    } else {
      plannedStart = ctx.initialState.capturedAt;
    }

    const durationMs = place.avgVisitDurationMin * 60_000;
    const plannedEnd = new Date(
      new Date(plannedStart).getTime() + durationMs,
    ).toISOString();

    const dayIndex =
      prev?.dayIndex ?? next?.dayIndex ?? ctx.initialState.dayIndex;

    return {
      slotId: randomUUID(),
      tripId: ctx.initialState.tripId,
      dayIndex,
      slotOrder: pos,
      version: 1,
      placeId: place.placeId,
      plannedStart,
      plannedEnd,
      actualStart: null,
      actualEnd: null,
      estimatedCost: place.minPrice ?? 0,
      activityType: 'sightseeing',
      rationale: null,
      status: 'planned',
    };
  }
}
