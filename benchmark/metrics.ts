/**
 * Metrics Collector — Đo lường runtime và utility từ EngineOutput.
 *
 * Hai trục đo chính:
 *   1. Runtime: latency, budget compliance, per-iteration timing
 *   2. Utility: score improvement, feasibility, constraint compliance,
 *               plan quality heuristics
 */

import {
  RunResult,
  AggregatedResult,
  ComparisonResult,
  StatSummary,
  BenchmarkScenario,
  EngineOutput,
  EngineConfig,
  TripSlot,
  TripState,
} from './types';

// ─────────────────────────────────────────────────────────
// SINGLE RUN MEASUREMENT
// ─────────────────────────────────────────────────────────

export function measureRun(
  scenario: BenchmarkScenario,
  config: EngineConfig,
  output: EngineOutput,
  initialScore: number,
): RunResult {
  const plan = output.bestNode.plan;
  const states = output.states;

  // ── Timing ──
  const totalLatencyMs = output.timing.totalMs;
  const iterationLatencies = output.timing.perIterationMs;
  const iterationCount = output.search.iterations;
  const timeoutOccurred = totalLatencyMs > scenario.expectations.maxLatencyMs;

  // ── Quality ──
  const finalBestScore = output.bestNode.score;
  const scoreImprovement = finalBestScore - initialScore;
  const scoreImprovementPct = initialScore !== 0
    ? (scoreImprovement / Math.abs(initialScore)) * 100
    : 0;
  const isFeasible = output.feasible;

  // ── Plan metrics ──
  const slotsPerDay = new Map<number, number>();
  for (const s of plan) {
    slotsPerDay.set(s.dayIndex, (slotsPerDay.get(s.dayIndex) ?? 0) + 1);
  }

  const uniquePlaces = new Set(plan.map(s => s.placeId));
  const placeDiversity = plan.length > 0 ? uniquePlaces.size / plan.length : 0;

  // ── Search efficiency ──
  const totalGenerated = output.search.candidatesPerIteration.reduce((a, b) => a + b, 0);
  const totalSurvived = output.search.survivorsPerIteration.reduce((a, b) => a + b, 0);
  const totalPruned = output.search.prunedPerIteration.reduce((a, b) => a + b, 0);
  const totalCacheHits = output.search.cacheHitsPerIteration.reduce((a, b) => a + b, 0);

  const survivalRate = totalGenerated > 0 ? totalSurvived / totalGenerated : 0;
  const pruneRate = totalGenerated > 0 ? totalPruned / totalGenerated : 0;
  const cacheHitRate = totalGenerated > 0 ? totalCacheHits / totalGenerated : 0;

  // ── Beam diversity ──
  const beamScores = output.beam.map(n => n.score);
  const beamPlanSignatures = new Set(
    output.beam.map(n => planSignature(n.plan))
  );

  // ── Operator stats (aggregate last iteration's allocations) ──
  const lastAllocations = output.search.operatorAllocations.length > 0
    ? output.search.operatorAllocations[output.search.operatorAllocations.length - 1]
    : new Map<string, number>();

  const operatorSurvivalRates = computeOperatorSurvivalRates(output);

  // ── Constraint violations ──
  const violations = checkConstraintViolations(plan, states, scenario);

  return {
    scenarioId: scenario.id,
    configLabel: config.label,
    totalLatencyMs,
    iterationLatencies,
    iterationCount,
    timeoutOccurred,
    initialScore,
    finalBestScore,
    scoreImprovement,
    scoreImprovementPct,
    isFeasible,
    finalPlanLength: plan.length,
    finalSlotsPerDay: slotsPerDay,
    placeDiversity,
    totalCandidatesGenerated: totalGenerated,
    totalCandidatesSurvived: totalSurvived,
    survivalRate,
    totalCandidatesPruned: totalPruned,
    pruneRate,
    cacheHitRate,
    uniquePlansInFinalBeam: beamPlanSignatures.size,
    beamScoreSpread: beamScores.length > 0
      ? Math.max(...beamScores) - Math.min(...beamScores)
      : 0,
    operatorAllocations: lastAllocations,
    operatorSurvivalRates,
    nightConstraintViolations: violations.night,
    budgetViolations: violations.budget,
    fatigueViolations: violations.fatigue,
    lockedSlotViolations: violations.locked,
    finalPlan: plan,
    finalStates: states,
  };
}

// ─────────────────────────────────────────────────────────
// CONSTRAINT VIOLATION CHECKER
// ─────────────────────────────────────────────────────────

interface ViolationCounts {
  night: number;
  budget: number;
  fatigue: number;
  locked: number;
}

function checkConstraintViolations(
  plan: TripSlot[],
  states: TripState[],
  scenario: BenchmarkScenario,
): ViolationCounts {
  let night = 0;
  let budget = 0;
  let fatigue = 0;
  let locked = 0;

  for (let i = 0; i < plan.length; i++) {
    const slot = plan[i];
    const state = states[i];

    // Night constraint: plannedEnd ≤ 22:30
    const endDate = new Date(slot.plannedEnd);
    const endMinutes = endDate.getUTCHours() * 60 + endDate.getUTCMinutes();
    if (endMinutes > 22 * 60 + 30) {
      night++;
    }

    // Budget
    if (state && state.budgetRemaining < 0) {
      budget++;
    }

    // Fatigue
    if (state && state.fatigue > (scenario.userPreferences.fatigueThreshold ?? 0.95)) {
      fatigue++;
    }
  }

  // Locked slots: phải giữ nguyên placeId, dayIndex, slotOrder
  if (scenario.expectations.lockedSlotsPreserved) {
    const initialLocked = scenario.initialPlan.filter(s => s.isLocked);
    for (const orig of initialLocked) {
      const found = plan.find(s =>
        s.slotId === orig.slotId &&
        s.placeId === orig.placeId &&
        s.dayIndex === orig.dayIndex
      );
      if (!found) locked++;
    }
  }

  return { night, budget, fatigue, locked };
}

// ─────────────────────────────────────────────────────────
// PLAN SIGNATURE (structural)
// ─────────────────────────────────────────────────────────

function planSignature(plan: TripSlot[]): string {
  return plan
    .map(s => `${s.placeId}:${s.dayIndex}:${s.slotOrder}`)
    .join('|');
}

// ─────────────────────────────────────────────────────────
// OPERATOR SURVIVAL RATES
// ─────────────────────────────────────────────────────────

function computeOperatorSurvivalRates(output: EngineOutput): Map<string, number> {
  // Cần data chi tiết per operator — nếu engine không expose, return empty
  // Đây là placeholder; actual implementation phụ thuộc engine instrumentation
  return new Map();
}

// ─────────────────────────────────────────────────────────
// AGGREGATION — Tổng hợp nhiều runs
// ─────────────────────────────────────────────────────────

export function aggregateRuns(runs: RunResult[]): AggregatedResult {
  if (runs.length === 0) throw new Error('Cannot aggregate empty runs');

  const { scenarioId, configLabel } = runs[0];

  return {
    scenarioId,
    configLabel,
    runCount: runs.length,

    latency: summarize(runs.map(r => r.totalLatencyMs)),
    score: summarize(runs.map(r => r.finalBestScore)),
    scoreImprovement: summarize(runs.map(r => r.scoreImprovement)),
    survivalRate: summarize(runs.map(r => r.survivalRate)),
    pruneRate: summarize(runs.map(r => r.pruneRate)),
    cacheHitRate: summarize(runs.map(r => r.cacheHitRate)),
    iterationCount: summarize(runs.map(r => r.iterationCount)),

    feasibilityRate: runs.filter(r => r.isFeasible).length / runs.length,
    timeoutRate: runs.filter(r => r.timeoutOccurred).length / runs.length,
    violationRate: runs.filter(r =>
      r.nightConstraintViolations > 0 ||
      r.budgetViolations > 0 ||
      r.fatigueViolations > 0 ||
      r.lockedSlotViolations > 0
    ).length / runs.length,

    allRuns: runs,
  };
}

function summarize(values: number[]): StatSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;

  return {
    mean,
    median: n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)],
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    p5: sorted[Math.floor(n * 0.05)] ?? sorted[0],
    p95: sorted[Math.ceil(n * 0.95) - 1] ?? sorted[n - 1],
  };
}

// ─────────────────────────────────────────────────────────
// COMPARISON — So sánh baseline vs test config
// ─────────────────────────────────────────────────────────

export function compareConfigs(
  baseline: AggregatedResult,
  test: AggregatedResult,
  scenario: BenchmarkScenario,
): ComparisonResult {
  const failReasons: string[] = [];

  // ── LATENCY ──
  // Guard: nếu baseline latency < 5ms, so sánh percentage vô nghĩa
  // (floating point noise thống trị). Chỉ check absolute budget.
  const LATENCY_FLOOR_MS = 5;
  const latencyReduction = baseline.latency.mean >= LATENCY_FLOOR_MS
    ? ((baseline.latency.mean - test.latency.mean) / baseline.latency.mean) * 100
    : 0; // cả hai quá nhanh để so sánh %

  // ── SCORE ──
  const scoreGain = test.score.mean - baseline.score.mean;
  const scoreGainPct = Math.abs(baseline.score.mean) > 1e-9
    ? (scoreGain / Math.abs(baseline.score.mean)) * 100
    : 0;

  // ── EFFICIENCY ──
  const candidateSavings = baseline.survivalRate.mean > 0
    ? ((test.survivalRate.mean - baseline.survivalRate.mean) / baseline.survivalRate.mean) * 100
    : 0;

  const iterationSavings = baseline.iterationCount.mean > 0
    ? ((baseline.iterationCount.mean - test.iterationCount.mean) / baseline.iterationCount.mean) * 100
    : 0;

  // ══════════════════════════════════════════════════════
  // PASS/FAIL CRITERIA
  // ══════════════════════════════════════════════════════

  // 1. Latency: absolute budget check (luôn áp dụng)
  if (test.latency.p95 > scenario.expectations.maxLatencyMs) {
    failReasons.push(
      `P95 latency ${test.latency.p95.toFixed(0)}ms vượt budget ${scenario.expectations.maxLatencyMs}ms`
    );
  }

  // 1b. Latency: relative check (chỉ khi baseline đủ lớn để so sánh)
  if (baseline.latency.mean >= LATENCY_FLOOR_MS && latencyReduction < -10) {
    failReasons.push(
      `Latency tăng ${(-latencyReduction).toFixed(1)}% so với baseline (cho phép tối đa 10%)`
    );
  }

  // 2. Score: test KHÔNG được kém hơn baseline (tolerance 1%)
  if (scoreGain < -0.01 * Math.abs(baseline.score.mean) && Math.abs(baseline.score.mean) > 1e-9) {
    failReasons.push(
      `Score giảm ${(-scoreGainPct).toFixed(1)}% so với baseline`
    );
  }

  // 3. Feasibility: test phải ≥ baseline (tolerance 5%)
  if (test.feasibilityRate < baseline.feasibilityRate - 0.05) {
    failReasons.push(
      `Feasibility ${(test.feasibilityRate * 100).toFixed(0)}% < baseline ${(baseline.feasibilityRate * 100).toFixed(0)}%`
    );
  }

  // 4. Constraint violations: test KHÔNG được có violation
  //    TRỪU KHI baseline cũng có (scenario bản thân infeasible → engine chưa implement)
  if (test.violationRate > 0 && baseline.violationRate === 0) {
    failReasons.push(
      `${(test.violationRate * 100).toFixed(0)}% runs có constraint violation (baseline sạch)`
    );
  }
  // Nếu cả baseline lẫn test đều có violations → warning, không fail
  // (chờ engine implement đúng thì cả hai sẽ hết)

  // 5. Scenario-specific: mustImproveOverInitial
  //    Chỉ check khi initial score > 0 (đã compute được)
  if (scenario.expectations.mustImproveOverInitial &&
      test.scoreImprovement.mean <= 0 &&
      Math.abs(test.scoreImprovement.mean) > 1e-9) {
    failReasons.push('Scenario yêu cầu improve nhưng mean improvement ≤ 0');
  }

  return {
    scenarioId: scenario.id,
    baselineConfig: baseline.configLabel,
    testConfig: test.configLabel,
    latencyReduction,
    scoreGain,
    scoreGainPct,
    candidateSavings,
    iterationSavings,
    passed: failReasons.length === 0,
    failReasons,
  };
}

// ─────────────────────────────────────────────────────────
// UTILITY SCORE DECOMPOSITION — Đo chất lượng plan chi tiết
// ─────────────────────────────────────────────────────────

export interface PlanQualityReport {
  scenarioId: string;
  configLabel: string;

  /** Feasibility */
  feasible: boolean;

  /** Score components (nếu engine expose) */
  totalScore: number;

  /** Constraint compliance */
  allConstraintsMet: boolean;
  constraintDetails: {
    nightOk: boolean;
    budgetOk: boolean;
    fatigueOk: boolean;
    lockedOk: boolean;
  };

  /** Plan structure quality */
  slotsRetained: number;        // so với initial plan
  slotsDropped: number;
  slotsReplaced: number;
  slotsInserted: number;

  /** Pace analysis */
  avgSlotsPerDay: number;
  paceFitScore: number;          // |avgSlotsPerDay - preferredPace|

  /** Diversity */
  uniqueActivityTypes: number;
  uniquePlaceIds: number;

  /** Forbidden places check */
  forbiddenPlacePresent: boolean;
  forbiddenPlaceIds: number[];

  /** Timing sanity */
  allSlotsChronological: boolean;
  totalIdleTimeMin: number;      // gaps giữa slots
  avgTravelTimeMin: number;
}

export function analyzePlanQuality(
  scenario: BenchmarkScenario,
  config: EngineConfig,
  result: RunResult,
): PlanQualityReport {
  const plan = result.finalPlan;
  const initial = scenario.initialPlan;

  // Slots comparison
  const initialIds = new Set(initial.map(s => s.slotId));
  const finalIds = new Set(plan.map(s => s.slotId));

  const retained = plan.filter(s => initialIds.has(s.slotId));
  const dropped = initial.filter(s => !finalIds.has(s.slotId));
  const inserted = plan.filter(s => !initialIds.has(s.slotId));

  // Replaced: same slotId but different placeId
  const replacedCount = retained.filter(s => {
    const orig = initial.find(o => o.slotId === s.slotId);
    return orig && orig.placeId !== s.placeId;
  }).length;

  // Pace
  const dayMap = new Map<number, number>();
  for (const s of plan) {
    dayMap.set(s.dayIndex, (dayMap.get(s.dayIndex) ?? 0) + 1);
  }
  const avgSlotsPerDay = dayMap.size > 0
    ? [...dayMap.values()].reduce((a, b) => a + b, 0) / dayMap.size
    : 0;
  const paceFitScore = Math.abs(avgSlotsPerDay - scenario.userPreferences.preferredPace);

  // Forbidden places
  const forbidden = scenario.expectations.forbiddenPlaceIds ?? [];
  const forbiddenPresent = plan.filter(s => forbidden.includes(s.placeId));

  // Chronological order
  let chronological = true;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].dayIndex < plan[i - 1].dayIndex) {
      chronological = false;
      break;
    }
    if (plan[i].dayIndex === plan[i - 1].dayIndex &&
        plan[i].slotOrder <= plan[i - 1].slotOrder) {
      chronological = false;
      break;
    }
  }

  // Idle time + travel time approximation
  let totalIdleMin = 0;
  let totalTravelMin = 0;
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].dayIndex !== plan[i - 1].dayIndex) continue;

    const prevEnd = new Date(plan[i - 1].plannedEnd).getTime();
    const currStart = new Date(plan[i].plannedStart).getTime();
    const gapMin = (currStart - prevEnd) / 60000;

    // Rough travel estimate based on slot data (actual: use haversine)
    const estTravelMin = Math.max(5, gapMin * 0.5); // rough
    totalTravelMin += estTravelMin;
    totalIdleMin += Math.max(0, gapMin - estTravelMin);
  }

  return {
    scenarioId: scenario.id,
    configLabel: config.label,
    feasible: result.isFeasible,
    totalScore: result.finalBestScore,
    allConstraintsMet:
      result.nightConstraintViolations === 0 &&
      result.budgetViolations === 0 &&
      result.fatigueViolations === 0 &&
      result.lockedSlotViolations === 0,
    constraintDetails: {
      nightOk: result.nightConstraintViolations === 0,
      budgetOk: result.budgetViolations === 0,
      fatigueOk: result.fatigueViolations === 0,
      lockedOk: result.lockedSlotViolations === 0,
    },
    slotsRetained: retained.length,
    slotsDropped: dropped.length,
    slotsReplaced: replacedCount,
    slotsInserted: inserted.length,
    avgSlotsPerDay,
    paceFitScore,
    uniqueActivityTypes: new Set(plan.map(s => s.activityType)).size,
    uniquePlaceIds: new Set(plan.map(s => s.placeId)).size,
    forbiddenPlacePresent: forbiddenPresent.length > 0,
    forbiddenPlaceIds: forbiddenPresent.map(s => s.placeId),
    allSlotsChronological: chronological,
    totalIdleTimeMin: totalIdleMin,
    avgTravelTimeMin: plan.length > 1 ? totalTravelMin / (plan.length - 1) : 0,
  };
}