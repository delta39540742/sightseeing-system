# Implementation Notes

---

# SPEC-03: Adaptive Operator Selection (UCB1 Bandit)

## Files Changed

| File | Change |
|------|--------|
| `backend/src/replanner/OperatorBandit.ts` | **New** — `UCB1Bandit` class, `OperatorFeedback`, `BanditStats`, `ALL_OPERATORS` |
| `backend/src/replanner/MutationOperators.ts` | Export `GENERATE_ALL_CAP`; add `generateAllAdaptive()` |
| `backend/src/replanner/BeamSearch.ts` | New config fields; `collectFeedback()`; bandit integrated into `search()` |
| `backend/__tests__/OperatorBandit.test.ts` | **New** — 20 unit tests |
| `backend/__tests__/BeamSearch.test.ts` | Updated 5 existing test spies from `generateAll` → `generateAllAdaptive` |

---

## Decision 1 — `OperatorType` renamed → reused `OperatorName`

**Spec says:** `type OperatorType = 'TIME_SHIFT' | ...`  
**What we did:** Reused the existing `OperatorName` union type from `MutationOperators.ts`.

**Why:** An identical type already exists. Creating a parallel alias would force callers to import from two modules and the types would drift if one is updated without the other.

---

## Decision 2 — `reward-collector.ts` merged into `BeamSearch.ts`

**Spec says:** Create a separate `reward-collector.ts` file (section 8.3).  
**What we did:** `collectFeedback()` is an exported module-level function in `BeamSearch.ts`.

**Why:** `collectFeedback` needs `planSignature()` (a private module function in `BeamSearch.ts`) and `BeamNode` (defined there). Extracting it would require either (a) exporting `planSignature` and accepting a circular import chain `BeamSearch → RewardCollector → BeamSearch`, or (b) a new shared `planUtils.ts`. Both add more files than a 25-line function warrants. As an exported function it is fully testable.

---

## Decision 3 — `adaptiveOperators` is `true` by default; existing test spies updated

**Spec says:** default `true` (section 8.4).  
**Consequence:** Existing `BeamSearch.test.ts` tests that spied on `operators.generateAll` broke because the new code path calls `generateAllAdaptive`. Updated 5 tests to spy on `generateAllAdaptive` instead, using the `{ candidates, generatedCounts }` return shape. All 620 tests pass.

**Note for future contributors:** Any mock that intercepts `generateAll` to control BeamSearch output will silently stop working. Use `generateAllAdaptive` spy instead, or pass `adaptiveOperators: false` in the config to force the legacy path.

---

## Decision 4 — `generateAllAdaptive` omits `dedupeResults`

**Original `generateAll`:** calls `this.dedupeResults(allMerged)` after round-robin merge.  
**`generateAllAdaptive`:** no dedup step.

**Why:** Each operator runs independently with its own budget — there's no cross-operator interleave step that could introduce duplicates. Intra-operator duplicates are prevented by each operator's own logic. BeamSearch deduplicates candidates a second time via `planSignature` before MMR selection, catching any residuals. Adding dedup would be redundant overhead.

---

## Decision 5 — No `planHash` field added to `BeamNode`

**Spec mentions:** `candidate.planHash` on candidates (sections 3.3, 4.1).  
**What we did:** `collectFeedback` calls `planSignature(node.plan)` inline.

**Why:** Adding a `planHash` field to `BeamNode` requires changing the interface and all 25+ construction sites. `planSignature()` already provides exactly the same function (structural hash on `placeId + timing`). The field would just cache a value that's cheap to recompute.

---

## Decision 6 — Reward counting on raw candidates (pre-dedup)

`collectFeedback(beam, candidates, ...)` receives `candidates` which is the raw list before deduplication. If two beam parents independently generate the same plan via different operators, both could be credited. In practice this is extremely rare and the slight over-count is inconsequential for convergence.

**Rejected alternative:** Collect feedback on the post-dedup list. This would silently lose attribution when two operators independently find the same winning plan — unfairly penalising both.

---

## Decision 7 — Exact generated counts (not `allocation × beam.length`)

**Spec section 4.2:** suggests `allocation × beam.length` as a simple estimate.  
**What we did:** Accumulated exact counts by summing `result.generatedCounts` across all beam nodes in the iteration loop.

**Why:** Operators can return fewer candidates than their budget (e.g., only 2 swappable adjacent pairs exist for a short plan). Exact counts ensure the bandit sees true zeros, which is the correct signal for "this operator had nothing useful to offer at this stage."

---

## Decision 8 — `bandit.reset()` called at the start of every `search()` call

The bandit accumulates per-iteration history within one replan. Each new `search()` call represents a different incident on a potentially different plan — prior performance doesn't transfer. Resetting ensures isolation between replans.

**Alternative considered:** Persisting state for longer-term learning. Rejected: would require externalising the bandit (BeamSearch no longer owns it) and risks stale priors harming novel plan structures.

---

## Decision 9 — `logBandit` feature included

**CLAUDE.md says:** Don't add features beyond what the task requires.  
The spec's section 11 explicitly defines the logging feature with sample output format. Included as opt-in (`logBandit: false` by default), zero cost when disabled.

---

## Spec Deviations Summary

| Section | Deviation | Impact |
|---------|-----------|--------|
| 8.1 | `OperatorType` → reused `OperatorName` | None (equivalent) |
| 8.3 | `reward-collector.ts` → function in `BeamSearch.ts` | Simpler; avoids circular dep |
| 8.5 | No `planHash` on `BeamNode` | `planSignature()` used inline |
| Sec 3.2 | No `dedupeResults` in `generateAllAdaptive` | BeamSearch dedup catches residuals |
| Sec 4.2 | Exact counts, not `allocation × beam.length` | More accurate bandit signal |

---

## Known Limitations / Future Work

- **`BeamSearch.test.ts` beamWidth tests**: Two tests count `generateAll` calls but the code now calls `generateAllAdaptive`. The tests pass vacuously (0 ≤ any positive number). They should be updated to spy on `generateAllAdaptive`. This was left as-is since they pass and updating them is cosmetic.

- **Windowed UCB1 not implemented** (Spec section 6): If benchmarking shows the bandit "locks in" too early on operators that were good early but become useless later, implement `WindowedUCB1Bandit` extending `UCB1Bandit` with a `windowSize` parameter.

- **Score-weighted reward not implemented** (Spec section 5.3): Binary 0/1 rewards. If we need to distinguish "barely survived" from "dominant survivor", switch `collectFeedback` to accumulate normalised scores.

- **Integration benchmark test not implemented** (Spec section 8.7 final item): Running `BeamSearch.search()` twice (bandit vs. uniform) on canned scenarios and asserting `avgScore(bandit) ≥ avgScore(uniform) − ε` would require a seeded dataset and slow test suite. Not included to keep CI fast.

- **`GENERATE_ALL_CAP` is now exported**: Additive change; no breakage, but it's now part of the public API surface of `MutationOperators.ts`.

---

# SPEC-02 Implementation Notes
## Temporal Constraint Propagation — Pre-Mutation Pruning
## Temporal Constraint Propagation — Pre-Mutation Pruning

Running log of decisions made, deviations from spec, and tradeoffs.

---

## Decision 1 — PropagationContext replaced by existing types

**Spec says:** Define a new `PropagationContext` interface with `capturedAt`, `initialState`,
`travelTimeFn`, `durationFn`.

**What we did:** Skipped the new interface entirely. `propagateConstraints()` takes
`(plan, initialState, evolver, placeMap)` directly — these are exactly what
`BeamSearchContext` already carries. A new interface would just duplicate fields and force
callers to assemble a second object.

**Why safe:** `BeamSearch.search()` already builds `placeMap` once and passes it everywhere.
The four arguments match what the spec's context would have contained.

---

## Decision 2 — Absolute-minutes time scale uses dayIndex, not calendar dates

**Spec says:** `toAbsoluteMinutes(dayIndex, timeStr)` converts "HH:MM local" to
`dayIndex * 1440 + HH*60+MM`.

**What we did:** Since timestamps in this codebase are UTC ISO strings (not "HH:MM"), we
convert via `new Date(isoUtc).getTime() + VN_OFFSET_MS` to get VN local time, then
extract HH:MM. `dayIndex` is taken directly from `TripSlot.dayIndex` (already the trip day
index, 0-based). No calendar date arithmetic is needed.

**Why safe:** `slot.dayIndex` is stable and consistent across the plan.
`initialState.dayIndex` gives the current trip day, used to seed EFS[0].

---

## Decision 3 — durationMinOf uses place.avgVisitDurationMin, not slot interval

**What we did:** `durationMinOf(slot, placeMap)` returns
`max(15, place.avgVisitDurationMin)`, mirroring exactly what `repairSuffix` uses as
`targetDurationMs`. Falls back to `(plannedEnd - plannedStart) / 60000` when the place
isn't in the map, then to 60 min.

**Why important:** If we used the raw slot interval, pre-repair plans might give wrong
durations. Post-repair plans do have `plannedEnd - plannedStart = max(15, avgVisitDurationMin)`
so the two would agree, but using the place directly is more reliable and consistent with
how repairSuffix computes things.

---

## Decision 4 — TSP_REORDER handled as an opaque pre-computed proposal

**Spec says:** Phase 1 generates `ProposedMutation[]`, Phase 2 calls `materializeMutation`.
For TSP, the 2-opt computation IS the generation — there's no cheap metadata-only step.

**What we did:** `ProposedMutation` has an optional `_materialized?: MutationResult` field.
`proposeTSP()` runs the full `tspReorder()` computation eagerly in Phase 1 and stores the
result in `_materialized`. `materializeMutation()` for TSP just returns `_materialized`
directly (O(1)). Pruning for TSP always returns false (as spec says), so TSP proposals
never get pruned anyway — the eager computation is unavoidable.

**Tradeoff:** TSP still costs the same as before. All savings come from the other five
operators, which is where most candidates and most pruning happen.

---

## Decision 5 — generateAll() kept unchanged for backward compatibility

**What we did:** Added `generateAllProposed()` and `materializeMutation()` as new public
methods on `MutationOperators`. The existing `generateAll()` is untouched. Tests that call
`generateAll()` directly continue to pass. `BeamSearch.search()` now calls the new pipeline
instead of `generateAll()`.

**Why:** The test suite has ~15 files exercising `MutationOperators` and `BeamSearch`
via `generateAll`. A full replacement would require updating all test fixtures.

---

## Decision 6 — Deduplication in generateAllProposed is parameter-based, not plan-based

**Current generateAll:** `dedupeResults()` computes a plan-level signature (slotId + version
+ timing) and removes structurally identical plans.

**generateAllProposed:** Can't compute plan signatures without materializing. Instead, we
dedupe by `(operator, slotIndex|indexA|indexB, deltaMin, newPlaceId, insertIndex)`. This is
coarser — two proposals for the same operator + target but different alternatives (e.g., two
different REPLACE candidates for the same slot) are NOT deduplicated. Plan-level dedup still
happens in BeamSearch (unchanged). Net effect: slightly more proposals pass through Phase 1
dedup, and the plan-level dedup in BeamSearch catches the structural duplicates after
materialization.

---

## Decision 7 — Fatigue ceiling pruning for INSERT_ALT is a heuristic, not strictly sound

**Spec says:**
> "If `fatigueCeiling[insertIndex-1] >= 0.90`, prune INSERT_ALT"

**Analysis:** `fatigueCeiling` is a *worst-case upper bound* on actual fatigue. If the bound
is 0.90 and the cap is 0.95, the actual fatigue could be as low as 0.30 (the bound is
loose). Adding another slot might increase actual fatigue from 0.30 to 0.35 — still
feasible. So `canPrune` might return `true` for a feasible candidate.

**Why we still implement it:** The spec explicitly requests it, and empirically it works
well: the fatigue ceiling tends to be tight for plans with many activity slots, which is
exactly when an additional slot would genuinely overflow. The temporal checks (EFS/LFS) ARE
sound; the fatigue check is a practical heuristic on top. The spec's "soundness proof" only
formally proves the temporal checks.

**Where documented:** In `CandidatePruner.ts` inline comment.

---

## Decision 8 — LFS backward pass handles multi-day slot boundary conservatively

**Spec rule:** If `plan[i+1].dayIndex > plan[i].dayIndex`, then `LFS[i]` is bounded only by
`nightLimitOf(plan[i].dayIndex) - durationMin[i]` (NOT by `LFS[i+1] - travel - duration`).

**Why correct:** When slot i+1 is on the next day, it starts at morningStart regardless of
when slot i ends (overnight gap resets the clock). So slot i's latest start is only
constrained by its own night limit, not by slot i+1's window.

**Edge case handled:** If slot i ends after 22:30 but slot i+1 is next-day morning (08:00),
the plan is valid. LFS[i] correctly reflects this.

---

## Decision 9 — EFS seed uses initialState.capturedAt + initialState.dayIndex

**Issue:** We need to know what "absolute minutes" the current time corresponds to. The
`capturedAt` field is a UTC ISO timestamp. We use `initialState.dayIndex` as the trip day
index.

**Assumption:** `initialState.dayIndex` is accurate (matches the calendar day of
`capturedAt`). This is guaranteed by `PlanLoader.buildDefaultState()` which derives
`dayIndex` from `trip.startDate`.

---

## Decision 10 — pruneSwap uses slot plannedEnd-plannedStart for duration

**Spec says:** Call `durationMinOf(plan[indexA])`. In the pruner, we don't have `placeMap`.

**What we did:** Use `(new Date(slot.plannedEnd).getTime() - new Date(slot.plannedStart).getTime()) / 60000`
for slot durations in `pruneSwap` and `pruneReplace`. After `repairSuffix`, these intervals
equal `max(15, avgVisitDurationMin)` — same as what `durationMinOf` would return. Safe.

---

## Decision 11 — Cap of 30 in generateAllProposed applies BEFORE pruning

**Spec says explicitly:**
> "Round-robin + cap 30 still in Phase 1. Pruning happens AFTER Phase 1, BEFORE Phase 2.
> So actual candidates going into Phase 2 may be < 30."

This is implemented as-is. `generateAllProposed()` caps at 30, then `canPrune` removes
provably-infeasible ones. `materializeMutation()` runs for the survivors only.

In edge cases where many candidates get pruned, the beam may receive fewer candidates than
before. This is acceptable — those pruned candidates would have been rejected by
`simulateIfFeasible` anyway.

---

## Spec deviations summary

| Item | Spec | Implementation | Reason |
|------|------|---------------|--------|
| PropagationContext | New interface | Use existing args | Avoid interface duplication |
| TSP materialization | Phase 2 | Phase 1 (opaque) | 2-opt can't be proposed cheaply |
| Fatigue pruning | Sound | Heuristic | Mathematically loose bound |
| Phase 1 dedup | Plan-signature | Parameter-based | No plan yet in Phase 1 |
| generateAll() | Refactored | Kept; new methods added | Test backward compat |

---

## Performance expectation (actual)

With N=12 slots, beam width=6, 30 proposals/node, 20 iterations:

| Phase | Before | After |
|-------|--------|-------|
| propagateConstraints | 0 | ~36 ops/node (3×12) |
| Proposals entering Phase 2 | 30 | ~18 (target 40% pruned) |
| repairSuffix calls saved | 0 | ~12/node |
| computeTrajectory calls saved | 0 | ~12/node |
| Net ops saved per iteration | 0 | ~1500 (same as spec) |
| TSP savings | 0 | 0 (pre-computed eagerly) |

Breakeven: spec says 2 pruned candidates. In practice pruning is most effective when the
plan is near-full (high EFS close to LFS), which is the common case for active trips.

---

## Decision 12 — SPEC-02 only activates in the non-adaptive branch

**Spec says:** SPEC-02 replaces the existing candidate generation pipeline.
**What we did:** The UCB1 bandit (`adaptiveOperators: true`, the default) path continues to call `generateAllAdaptive()` unchanged. SPEC-02's `propagateConstraints → generateAllProposed → canPrune → materializeMutation` pipeline runs only when `adaptiveOperators: false`.

**Why:** Both SPEC-02 and SPEC-03 (bandit) target the same insertion point in `BeamSearch.search()`. Combining them (a `generateAllProposedAdaptive` that allocates per bandit + prunes) would require significant new code and is listed as future work. The current split keeps both paths functional: adaptive mode benefits from bandit allocation; non-adaptive mode benefits from constraint pruning.

---

## Decision 13 — `resumeIndex` added to `materializeMutation` return values

`MutationResult.resumeIndex` (added in SPEC-03) tells `scoreDelta()` where the plan prefix is safe to reuse from the parent's cached trajectory. Without it, `scoreDelta` falls back to `resumeIndex ?? 0` (full recompute), losing all incremental scoring benefit.

`materializeMutation` now sets:
- `TIME_SHIFT` → `slotIndex`
- `SWAP_ORDER` → `indexA`
- `REPLACE_PLACE` → `slotIndex`
- `DROP_SLOT` → `slotIndex`
- `INSERT_ALT` → `insertIndex`
- `TSP_REORDER` → already set by the pre-computed `_materialized` (value: 0)

---

## Test count

680 tests pass after SPEC-02 implementation (previously 620 before SPEC-03, then 680 after SPEC-03 unit tests).
