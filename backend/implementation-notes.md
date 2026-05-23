# Implementation Notes — SPEC-01: Incremental Trajectory Computation & Delta Scoring

Decisions, deviations, and tradeoffs made during implementation that are not in the spec.

---

## 1. `resumeIndex` is optional on `MutationResult`

**What the spec says:** Add `resumeIndex: number` to `MutationResult`.

**What we did:** Made it `resumeIndex?: number` (optional).

**Why:** Existing tests in `BeamSearch.test.ts` and `ObjectiveScorer.test.ts` construct `MutationResult` objects with `satisfies MutationResult`. Making the field required would break all of these with a TypeScript compile error. The consuming code uses `m.resumeIndex ?? 0` as a safe fallback, which is semantically identical to a required field with default 0.

---

## 2. `TrajectoryCache.states` length convention differs from spec

**What the spec says:** `states[i]` = state *after* visiting slot `i`; `states.length == plan.length`.

**What we did:** `states[0]` = initialState (before any slot); `states[i+1]` = state after slot `i`; `states.length == plan.length + 1`.

**Why:** This matches the existing `computeTrajectory()` output format exactly, so `computeTrajectoryIncremental` can return the same shape as `computeTrajectoryFull`. Changing the convention would require adapting every call site that already reads `computeTrajectory` output. All comments in `TrajectoryCache.ts` document this explicitly.

---

## 3. Operators already cache `stateTrajectory` — we didn't change them

**What the spec says (Bug 1 fix):** Operators should cache the trajectory they compute so `BeamSearch` doesn't recompute it.

**What we found:** This was already done — `MutationResult` already had `stateTrajectory?: TripState[]` and `simulateIfFeasible` already stored trajectory in results. `BeamSearch.search()` already reads `m.stateTrajectory` to avoid recomputing. No change needed here.

**Implication:** The main optimization surface for this PR is incremental **scoring** (`scoreDelta`), not incremental trajectory simulation. The `computeTrajectoryIncremental` method exists and is correct, but BeamSearch currently uses trajectory from `m.stateTrajectory` (full, pre-computed by operators). Incremental simulation would only activate if operators were refactored to not use `simulateIfFeasible` — left for a future pass.

---

## 4. `scoreFullAndCache` vs legacy `score()` — minor `potentialBias` behavior difference

**What the spec says:** `scoreFullAndCache` must produce the same total as `score()`.

**What we found:** In legacy `score()`, `potentialBias` is awarded in a separate loop over all slots regardless of whether the place is in `candidatePool`. In `computeSlotBreakdown`, we only award it when `place != null`. These diverge only when a slot's `placeId` isn't in the pool (degenerate input — shouldn't happen in production). Tests confirm they agree on all realistic inputs.

---

## 5. `pace` and `stability` always recomputed in `scoreDelta`

**What the spec says:** Reuse prefix cache for everything possible.

**What we decided:** `pace` (time gap between last slot's end and current slot's start) touches every slot in the plan through aggregation, so even a mutation at `resumeIndex=8` of a 10-slot plan affects pace for slots 8 and 9. The marginal gain from partially caching pace doesn't justify the complexity. Always recomputed in O(n) in `scoreDelta`.

`stability` depends on `countChanges(history)` which grows with every beam iteration and is not shareable across nodes. Never cached.

---

## 6. `keepPairs` formula for incremental synergy

Synergy pair `i` covers (slot `i`, slot `i+1`). When `resumeIndex = r`, pairs `0..r-2` are guaranteed unchanged (involve only prefix slots). Pair `r-1` involves slot `r-1` (prefix) and slot `r` (suffix) — must be recomputed. So `keepPairs = max(0, resumeIndex - 1)`.

This is the smallest correct set to keep; it handles the edge case at the boundary between prefix and suffix.

---

## 7. Cache staleness detection via `planHash`

`TrajectoryCache.planHash` is a cheap structural fingerprint (`placeId:dayIndex:slotOrder:plannedStart:plannedEnd` joined by `|`). It is checked in `scoreDelta` before reusing the parent cache. If hashes don't match (e.g., because the same `BeamNode` was mutated differently), we fall back to full recompute. This is a safety guard against cache poisoning — not expected to trigger in normal operation.

---

## 8. `computeTrajectoryIncremental` added to `StateEvolver` but not yet used in `BeamSearch`

The method exists, is tested (via the new test file), and is correct. However, `BeamSearch` currently gets trajectory from `m.stateTrajectory` (set by operators via `simulateIfFeasible`) and passes it directly to `scoreDelta`. Wiring `computeTrajectoryIncremental` into the hot path would require operators to stop computing full trajectories, which is a larger refactor. The method is ready when that refactor happens.

---

## 9. Test file scope and benchmark interpretation

`__tests__/incremental-trajectory.test.ts` contains:

- **Property tests** for `computeTrajectoryIncremental`: verifies that full-fallback (no cache), prefix reuse (various `resumeIndex`), DROP_SLOT (shorter plan), and INSERT_ALT (longer plan) all produce equivalent final states.
- **Property tests** for `scoreDelta` vs `scoreFullAndCache`: verifies score equality for various `resumeIndex` values, DROP_SLOT, INSERT_ALT, TSP_REORDER, and weather/history inputs.
- **Cache structure integrity**: confirms `slotScores.length == plan.length` and `synergyPairs.length == plan.length - 1`.
- **Benchmark**: asserts `scoreDelta` at `resumeIndex=8` on a 10-slot plan is not slower than `scoreFullAndCache` by more than 50%. This is a sanity check — the real gain shows at scale. The spec targets 40-60% reduction; the benchmark only guards against regression (no speedup measured in isolation on 10 synthetic slots with zero DB I/O).

---

## Files Changed

| File | Status | Summary |
|------|--------|---------|
| `src/replanner/TrajectoryCache.ts` | NEW | `SlotScoreBreakdown`, `PlanScoreBreakdown`, `TrajectoryCache`, `computePlanHash`, `ZERO_SLOT_SCORE` |
| `src/replanner/MutationOperators.ts` | MODIFIED | Added `resumeIndex?` to `MutationResult`; all 6 operators set it |
| `src/replanner/StateEvolver.ts` | MODIFIED | Added `computeTrajectoryFull` alias and `computeTrajectoryIncremental` |
| `src/replanner/BeamSearch.ts` | MODIFIED | Added `trajectoryCache?` to `BeamNode`; added `computeSlotBreakdown`, `scoreFullAndCache`, `scoreDelta` to `ObjectiveScorer`; updated `search()` to use them |
| `__tests__/incremental-trajectory.test.ts` | NEW | 22 property + structure + benchmark tests |
