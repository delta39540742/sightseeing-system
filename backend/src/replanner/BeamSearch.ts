import type { TripSlot, TripState, ObjectiveWeights } from '@app/types';
import type { StateEvolver, ReplanContext, WeatherSnapshot } from './StateEvolver';
import type { MutationOperators, MutationResult } from './MutationOperators';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Tuning knobs for a single beam-search run.
 */
export interface BeamSearchConfig {
  /** Number of candidates kept after each prune step. */
  beamWidth: number;
  /** Hard cap on the number of expand-prune cycles. */
  maxIterations: number;
  /**
   * Relative improvement threshold for early stopping.
   * A value of 0.01 means "stop if the best score improved by less than 1 %".
   */
  improvementThreshold: number;
  /** Wall-clock budget in milliseconds; the search returns best-so-far on timeout. */
  latencyBudgetMs: number;
}

const DEFAULT_CONFIG: BeamSearchConfig = {
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
  latencyBudgetMs: 4500,
};

// ---------------------------------------------------------------------------
// BeamNode
// ---------------------------------------------------------------------------

/**
 * A single node in the beam: a candidate plan together with its complete
 * state trajectory, objective score, and the sequence of mutations that
 * produced it from the root.
 */
export interface BeamNode {
  /** Ordered list of slots (the candidate plan). */
  plan: TripSlot[];
  /** State trajectory: `stateTrajectory[i]` is the state *before* `plan[i]`. */
  stateTrajectory: TripState[];
  /** Objective score (higher = better). */
  score: number;
  /** Ordered list of mutations applied from the root to reach this node. */
  mutationHistory: MutationResult[];
  /** The parent node in the search tree (null for the root). */
  parent: BeamNode | null;
}

// ---------------------------------------------------------------------------
// BeamSearchContext
// ---------------------------------------------------------------------------

/**
 * Extended context for a beam-search run.
 * Carries the additional fields that {@link BeamSearch} (and {@link ObjectiveScorer})
 * need on top of the base {@link ReplanContext}.
 */
export interface BeamSearchContext extends ReplanContext {
  /**
   * The plan to search from (the current remaining slots for today).
   * Used as the root node's plan.
   */
  remainingSlots: TripSlot[];
  /** Weights for the six-term objective function. */
  weights: ObjectiveWeights;
  /**
   * Weather forecast indexed by **slot position** in the plan (not by slotId).
   * Missing entries mean "no weather effect" for that position.
   */
  weatherForecast?: WeatherSnapshot[];
}

// ---------------------------------------------------------------------------
// Module-level pure helpers
// ---------------------------------------------------------------------------

/**
 * Dot product of two numeric arrays of equal length.
 * Missing entries in `b` are treated as 0.
 */
function dot(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
}

/**
 * Encodes a place's tags as a 10-dimensional one-hot vector.
 * Dimension i (0-based) ↔ tagId i+1 (range 1–10).
 */
function tagVectorOf(
  place: { tags: ReadonlyArray<{ tagId: number }> },
): number[] {
  const v = new Array<number>(10).fill(0);
  for (const tag of place.tags) {
    if (tag.tagId >= 1 && tag.tagId <= 10) v[tag.tagId - 1] = 1;
  }
  return v;
}

// ---------------------------------------------------------------------------
// ObjectiveScorer
// ---------------------------------------------------------------------------

/**
 * Computes a scalar objective score for a candidate plan given its state
 * trajectory and user/context information.
 *
 * ### Scoring terms (six-component weighted sum)
 * ```
 * F = w_interest * Σ dot(prefVec, tagVec(place_i))
 *   + w_pace     * paceFit(plan, user.pace)
 *   + w_distance * Σ –travelTime(state_i → place_i) / 60
 *   + w_budget   * Σ –max(0, –budgetRemaining_after_i) × 0.001
 *   + w_weather  * Σ weatherFit(weatherForecast_i, place_i.indoorOutdoor)
 *   + w_risk     * Σ –fatigue_after_i
 * ```
 *
 * All sums iterate over slot indices `i = 0 … plan.length-1`.
 */
export class ObjectiveScorer {
  /**
   * @param evolver Used for Haversine travel-time estimation.
   */
  constructor(private readonly evolver: StateEvolver) {}

  /**
   * Scores the given plan and its pre-computed state trajectory.
   *
   * @param plan     Ordered list of {@link TripSlot}s.
   * @param states   Trajectory returned by {@link StateEvolver.computeTrajectory}
   *                 (length = plan.length + 1; `states[0]` is the initial state).
   * @param weights  {@link ObjectiveWeights} for the six terms.
   * @param ctx      Full {@link BeamSearchContext} (candidatePool, user, weatherForecast).
   * @returns        Scalar score; higher = better plan.
   */
  score(
    plan: TripSlot[],
    states: TripState[],
    weights: ObjectiveWeights,
    ctx: BeamSearchContext,
  ): number {
    let interest = 0;
    let distance = 0;
    let budget = 0;
    let weather = 0;
    let risk = 0;

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = ctx.candidatePool.find((p) => p.placeId === slot.placeId);
      if (!place) continue;

      const stateAfter = states[i + 1];
      if (!stateAfter) continue;

      // 1. Interest: dot product of user preference vector and place tag vector
      interest += dot(ctx.user.preferenceVector, tagVectorOf(place));

      // 2. Distance: penalty proportional to travel time in hours
      const prevState = states[i]!;
      distance -= this.travelTimeMin(prevState, place) / 60;

      // 3. Budget: penalty for exceeding budget (should be rare if allFeasible ran)
      if (stateAfter.budgetRemaining < 0) {
        budget -= Math.abs(stateAfter.budgetRemaining) * 0.001;
      }

      // 4. Weather: reward indoor when raining, penalise outdoor when raining
      const rainMmPerH = ctx.weatherForecast?.[i]?.rainMmPerH ?? 0;
      if (rainMmPerH >= 5) {
        if (place.indoorOutdoor === 'indoor') weather += 1;
        else if (place.indoorOutdoor === 'outdoor') weather -= 1;
      }

      // 5. Risk: penalise accumulated fatigue
      risk -= stateAfter.fatigue;
    }

    // 6. Pace: how well slots/day matches user's preferred pace
    const paceFit = this.computePaceFit(plan, ctx.user.pace);

    return (
      weights.wInterest * interest +
      weights.wPace     * paceFit  +
      weights.wDistance * distance +
      weights.wBudget   * budget   +
      weights.wWeather  * weather  +
      weights.wRisk     * risk
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Estimates travel time from `state.currentLat/Lng` to `place.lat/lng`
   * by delegating to {@link StateEvolver.estimateTravelTime}.
   * Returns 0 if the state has no coordinates.
   */
  private travelTimeMin(
    state: TripState,
    place: { lat: number; lng: number },
  ): number {
    if (state.currentLat == null || state.currentLng == null) return 0;
    return this.evolver.estimateTravelTime(
      state.currentLat,
      state.currentLng,
      place.lat,
      place.lng,
    );
  }

  /**
   * Computes a pace-fit score in the range roughly [−0.5, 1].
   *
   * Mapping: `pace = 0` → target 3 slots/day; `pace = 1` → target 7 slots/day.
   * `paceFit = 1 – |avgSlotsPerDay – target| / 4`
   *
   * An empty plan returns 1 (no pace mismatch to penalise).
   */
  private computePaceFit(plan: TripSlot[], preferredPace: number): number {
    if (plan.length === 0) return 1;

    // Count slots per day index
    const dayMap = new Map<number, number>();
    for (const s of plan) {
      dayMap.set(s.dayIndex, (dayMap.get(s.dayIndex) ?? 0) + 1);
    }
    const avgSlotsPerDay =
      [...dayMap.values()].reduce((a, b) => a + b, 0) / dayMap.size;

    const targetSlotsPerDay = 3 + preferredPace * 4; // [3, 7]
    const diff = Math.abs(avgSlotsPerDay - targetSlotsPerDay);
    return 1 - diff / 4;
  }
}

// ---------------------------------------------------------------------------
// BeamSearch
// ---------------------------------------------------------------------------

/**
 * Beam-search optimizer for trip replanning.
 *
 * ### Algorithm
 * 1. Initialise the beam with a single root node (the original plan).
 * 2. Each iteration:
 *    a. **Expand** — apply all five mutation operators to every node in the beam.
 *    b. **Filter** — discard candidates with any infeasible state.
 *    c. **Score** — compute the objective score for each surviving candidate.
 *    d. **Prune** — keep the top `beamWidth` candidates.
 * 3. Stop when:
 *    - no candidates are generated (local optimum), OR
 *    - relative improvement < `improvementThreshold` (convergence), OR
 *    - wall-clock time exceeds `latencyBudgetMs` (timeout), OR
 *    - `maxIterations` has been reached.
 * 4. Return the globally best node seen across all iterations.
 *
 * ### Guarantees
 * - The returned node's plan is **always feasible** (all states pass `isFeasible`).
 * - The returned score is never worse than the root score.
 */
export class BeamSearch {
  constructor(
    private readonly evolver: StateEvolver,
    private readonly operators: MutationOperators,
    private readonly scorer: ObjectiveScorer,
    private readonly config: BeamSearchConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Runs the beam search and returns the best plan found.
   *
   * @param ctx {@link BeamSearchContext} containing the initial plan, weights,
   *            candidate pool, weather, and user preferences.
   * @returns   The {@link BeamNode} with the highest objective score found.
   */
  search(ctx: BeamSearchContext): BeamNode {
    const startTime = Date.now();

    // ------------------------------------------------------------------
    // Initialise beam with the root (original plan)
    // ------------------------------------------------------------------
    const rootPlan = ctx.remainingSlots;
    const rootStates = this.evolver.computeTrajectory(
      rootPlan,
      ctx.initialState,
      ctx,
    );
    const rootScore = this.scorer.score(
      rootPlan,
      rootStates,
      ctx.weights,
      ctx,
    );

    const rootNode: BeamNode = {
      plan: rootPlan,
      stateTrajectory: rootStates,
      score: rootScore,
      mutationHistory: [],
      parent: null,
    };

    let beam: BeamNode[] = [rootNode];
    let bestNode = rootNode;
    let prevBestScore = rootScore;

    // ------------------------------------------------------------------
    // Main expand → filter → score → prune loop
    // ------------------------------------------------------------------
    for (let iter = 0; iter < this.config.maxIterations; iter++) {
      // Latency guard: check at the top of each iteration
      if (Date.now() - startTime > this.config.latencyBudgetMs) {
        console.warn(
          `BeamSearch: latency budget exceeded at iteration ${iter}; returning best-so-far`,
        );
        return bestNode;
      }

      // Expand: generate mutation candidates from every node in the beam
      const candidates: BeamNode[] = [];

      for (const node of beam) {
        const mutations = this.operators.generateAll(node.plan, ctx);

        for (const m of mutations) {
          // Recompute trajectory from the fixed initial state
          let states: TripState[];
          try {
            states = this.evolver.computeTrajectory(
              m.newPlan,
              ctx.initialState,
              ctx,
            );
          } catch {
            continue; // unknown placeId or other error → skip candidate
          }

          // Belt-and-suspenders feasibility check
          if (!states.every((s) => this.evolver.isFeasible(s))) continue;

          const score = this.scorer.score(
            m.newPlan,
            states,
            ctx.weights,
            ctx,
          );

          candidates.push({
            plan: m.newPlan,
            stateTrajectory: states,
            score,
            mutationHistory: [...node.mutationHistory, m],
            parent: node,
          });
        }
      }

      // No candidates → local optimum, stop
      if (candidates.length === 0) break;

      // Prune: keep top-beamWidth by score (descending)
      candidates.sort((a, b) => b.score - a.score);
      beam = candidates.slice(0, this.config.beamWidth);

      // Track global best
      if (beam[0]!.score > bestNode.score) {
        bestNode = beam[0]!;
      }

      // Early stop: check relative improvement (skip first iteration)
      if (iter > 0) {
        // Guard against division by zero when prevBestScore is near 0
        const denom =
          Math.abs(prevBestScore) > Number.EPSILON
            ? Math.abs(prevBestScore)
            : Number.EPSILON;
        const improvement = (beam[0]!.score - prevBestScore) / denom;
        if (improvement < this.config.improvementThreshold) break;
      }

      prevBestScore = beam[0]!.score;
    }

    return bestNode;
  }
}

export default BeamSearch;
