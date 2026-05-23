/**
 * Validators — Kiểm tra tính chính xác (correctness) của plan output.
 *
 * Khác với metrics (đo lường chất lượng), validators kiểm tra INVARIANTS
 * mà MỌI output PHẢI thỏa mãn, bất kể config hay scenario.
 *
 * Bất kỳ violation nào → engine có bug.
 */

import { TripSlot, TripState, BenchmarkScenario, EngineOutput } from './types';

// ─────────────────────────────────────────────────────────
// VIOLATION TYPES
// ─────────────────────────────────────────────────────────

export interface Violation {
  category: ViolationCategory;
  severity: 'critical' | 'warning';
  message: string;
  slotIndex?: number;
  slotId?: string;
  details?: Record<string, unknown>;
}

export type ViolationCategory =
  | 'temporal_order'       // slots không theo thứ tự thời gian
  | 'day_consistency'      // dayIndex vs plannedStart mismatch
  | 'slot_order'           // slotOrder không liên tục trong ngày
  | 'night_overflow'       // plannedEnd > 22:30
  | 'time_overlap'         // 2 slots overlap trong cùng ngày
  | 'travel_impossible'    // không đủ thời gian travel giữa 2 slots
  | 'locked_modified'      // locked slot bị thay đổi
  | 'budget_negative'      // budget < 0
  | 'fatigue_exceeded'     // fatigue > threshold
  | 'state_inconsistency'  // state[i] không consistent với slot[i]
  | 'duplicate_slotId'     // 2 slots cùng slotId
  | 'missing_fields'       // required fields missing hoặc invalid
  | 'forbidden_place'      // place bị cấm xuất hiện
  | 'spec01_mismatch'      // incremental vs full trajectory khác nhau
  | 'spec02_false_prune'   // pruned candidate thực ra feasible
  | 'spec03_budget_sum';   // bandit allocation ≠ GENERATE_ALL_CAP

export interface ValidationReport {
  scenarioId: string;
  configLabel: string;
  passed: boolean;
  violations: Violation[];
  criticalCount: number;
  warningCount: number;
}

// ─────────────────────────────────────────────────────────
// MAIN VALIDATOR
// ─────────────────────────────────────────────────────────

export function validateOutput(
  scenario: BenchmarkScenario,
  configLabel: string,
  output: EngineOutput,
): ValidationReport {
  const violations: Violation[] = [];
  const plan = output.bestNode.plan;
  const states = output.states;

  // Run tất cả checks
  violations.push(
    ...checkStructuralIntegrity(plan),
    ...checkTemporalOrder(plan),
    ...checkSlotOrderContinuity(plan),
    ...checkNightConstraint(plan),
    ...checkTimeOverlaps(plan),
    ...checkTravelFeasibility(plan),
    ...checkLockedSlots(plan, scenario),
    ...checkBudgetFeasibility(states, scenario),
    ...checkFatigueFeasibility(states, scenario),
    ...checkStateConsistency(plan, states),
    ...checkForbiddenPlaces(plan, scenario),
  );

  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;

  return {
    scenarioId: scenario.id,
    configLabel,
    passed: criticalCount === 0,
    violations,
    criticalCount,
    warningCount,
  };
}

// ─────────────────────────────────────────────────────────
// INDIVIDUAL CHECKS
// ─────────────────────────────────────────────────────────

/** 1. Structural integrity — required fields, no duplicates */
function checkStructuralIntegrity(plan: TripSlot[]): Violation[] {
  const violations: Violation[] = [];

  // Duplicate slotIds
  const seenIds = new Set<string>();
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i];

    if (seenIds.has(s.slotId)) {
      violations.push({
        category: 'duplicate_slotId',
        severity: 'critical',
        message: `Duplicate slotId "${s.slotId}" tại index ${i}`,
        slotIndex: i,
        slotId: s.slotId,
      });
    }
    seenIds.add(s.slotId);

    // Missing fields
    if (!s.plannedStart || !s.plannedEnd) {
      violations.push({
        category: 'missing_fields',
        severity: 'critical',
        message: `Slot ${i} ("${s.slotId}") thiếu plannedStart hoặc plannedEnd`,
        slotIndex: i,
        slotId: s.slotId,
      });
    }

    if (s.dayIndex < 0 || !Number.isInteger(s.dayIndex)) {
      violations.push({
        category: 'missing_fields',
        severity: 'critical',
        message: `Slot ${i} dayIndex invalid: ${s.dayIndex}`,
        slotIndex: i,
        slotId: s.slotId,
      });
    }

    if (s.slotOrder < 0 || !Number.isInteger(s.slotOrder)) {
      violations.push({
        category: 'missing_fields',
        severity: 'critical',
        message: `Slot ${i} slotOrder invalid: ${s.slotOrder}`,
        slotIndex: i,
        slotId: s.slotId,
      });
    }

    // plannedStart < plannedEnd
    if (s.plannedStart && s.plannedEnd) {
      const start = new Date(s.plannedStart).getTime();
      const end = new Date(s.plannedEnd).getTime();
      if (end <= start) {
        violations.push({
          category: 'missing_fields',
          severity: 'critical',
          message: `Slot ${i} plannedEnd ≤ plannedStart`,
          slotIndex: i,
          slotId: s.slotId,
          details: { plannedStart: s.plannedStart, plannedEnd: s.plannedEnd },
        });
      }
    }
  }

  return violations;
}

/** 2. Temporal order — slots phải theo thứ tự dayIndex → slotOrder */
function checkTemporalOrder(plan: TripSlot[]): Violation[] {
  const violations: Violation[] = [];

  for (let i = 1; i < plan.length; i++) {
    const prev = plan[i - 1];
    const curr = plan[i];

    // dayIndex phải non-decreasing
    if (curr.dayIndex < prev.dayIndex) {
      violations.push({
        category: 'temporal_order',
        severity: 'critical',
        message: `Slot ${i} dayIndex=${curr.dayIndex} < slot ${i - 1} dayIndex=${prev.dayIndex}`,
        slotIndex: i,
        slotId: curr.slotId,
      });
    }

    // Trong cùng ngày, slotOrder phải tăng
    if (curr.dayIndex === prev.dayIndex && curr.slotOrder <= prev.slotOrder) {
      violations.push({
        category: 'temporal_order',
        severity: 'critical',
        message: `Cùng dayIndex=${curr.dayIndex}: slotOrder ${curr.slotOrder} ≤ ${prev.slotOrder}`,
        slotIndex: i,
        slotId: curr.slotId,
      });
    }

    // plannedStart phải non-decreasing
    if (curr.plannedStart && prev.plannedEnd) {
      const currStart = new Date(curr.plannedStart).getTime();
      const prevEnd = new Date(prev.plannedEnd).getTime();

      // Trong cùng ngày, currStart phải ≥ prevEnd
      if (curr.dayIndex === prev.dayIndex && currStart < prevEnd) {
        violations.push({
          category: 'time_overlap',
          severity: 'critical',
          message: `Slot ${i} starts (${curr.plannedStart}) trước slot ${i - 1} ends (${prev.plannedEnd})`,
          slotIndex: i,
          slotId: curr.slotId,
          details: { prevEnd: prev.plannedEnd, currStart: curr.plannedStart },
        });
      }
    }
  }

  return violations;
}

/** 3. SlotOrder continuity — mỗi ngày phải có slotOrder 0, 1, 2, ... */
function checkSlotOrderContinuity(plan: TripSlot[]): Violation[] {
  const violations: Violation[] = [];
  const daySlots = new Map<number, TripSlot[]>();

  for (const s of plan) {
    if (!daySlots.has(s.dayIndex)) daySlots.set(s.dayIndex, []);
    daySlots.get(s.dayIndex)!.push(s);
  }

  for (const [dayIndex, slots] of daySlots) {
    const sorted = [...slots].sort((a, b) => a.slotOrder - b.slotOrder);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].slotOrder !== i) {
        violations.push({
          category: 'slot_order',
          severity: 'warning',
          message: `Day ${dayIndex}: slotOrder gap — expected ${i}, got ${sorted[i].slotOrder}`,
          slotId: sorted[i].slotId,
          details: { dayIndex, expected: i, actual: sorted[i].slotOrder },
        });
        break; // report 1 per day
      }
    }
  }

  return violations;
}

/** 4. Night constraint — plannedEnd ≤ 22:30 */
function checkNightConstraint(plan: TripSlot[]): Violation[] {
  const violations: Violation[] = [];
  const NIGHT_LIMIT_MIN = 22 * 60 + 30;

  for (let i = 0; i < plan.length; i++) {
    const s = plan[i];
    if (!s.plannedEnd) continue;

    const endDate = new Date(s.plannedEnd);
    const endMinutes = endDate.getUTCHours() * 60 + endDate.getUTCMinutes();

    if (endMinutes > NIGHT_LIMIT_MIN) {
      violations.push({
        category: 'night_overflow',
        severity: 'critical',
        message: `Slot ${i} ("${s.slotId}") ends at ${formatMinutes(endMinutes)} > 22:30`,
        slotIndex: i,
        slotId: s.slotId,
        details: { plannedEnd: s.plannedEnd, endMinutes },
      });
    }
  }

  return violations;
}

/** 5. Time overlaps */
function checkTimeOverlaps(plan: TripSlot[]): Violation[] {
  // Already partially covered by temporal order check
  // This is a more thorough pairwise check within each day
  const violations: Violation[] = [];
  const daySlots = new Map<number, Array<{ index: number; slot: TripSlot }>>();

  for (let i = 0; i < plan.length; i++) {
    const s = plan[i];
    if (!daySlots.has(s.dayIndex)) daySlots.set(s.dayIndex, []);
    daySlots.get(s.dayIndex)!.push({ index: i, slot: s });
  }

  for (const [, slots] of daySlots) {
    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const sa = slots[a].slot;
        const sb = slots[b].slot;
        if (!sa.plannedStart || !sa.plannedEnd || !sb.plannedStart || !sb.plannedEnd) continue;

        const aStart = new Date(sa.plannedStart).getTime();
        const aEnd = new Date(sa.plannedEnd).getTime();
        const bStart = new Date(sb.plannedStart).getTime();
        const bEnd = new Date(sb.plannedEnd).getTime();

        // Overlap iff aStart < bEnd && bStart < aEnd
        if (aStart < bEnd && bStart < aEnd) {
          violations.push({
            category: 'time_overlap',
            severity: 'critical',
            message: `Slots overlap: [${slots[a].index}] ${sa.slotId} and [${slots[b].index}] ${sb.slotId}`,
            slotIndex: slots[b].index,
            slotId: sb.slotId,
          });
        }
      }
    }
  }

  return violations;
}

/** 6. Travel feasibility — enough time between consecutive slots for travel */
function checkTravelFeasibility(plan: TripSlot[]): Violation[] {
  const violations: Violation[] = [];

  for (let i = 1; i < plan.length; i++) {
    const prev = plan[i - 1];
    const curr = plan[i];

    // Chỉ check trong cùng ngày (cross-day có morning gap)
    if (curr.dayIndex !== prev.dayIndex) continue;
    if (!prev.plannedEnd || !curr.plannedStart) continue;

    const gapMs = new Date(curr.plannedStart).getTime() - new Date(prev.plannedEnd).getTime();
    const gapMin = gapMs / 60000;

    // Minimum travel time = 5 phút (cùng khu vực)
    if (gapMin < 3) {
      violations.push({
        category: 'travel_impossible',
        severity: 'warning',
        message: `Gap giữa slot ${i - 1}→${i} chỉ ${gapMin.toFixed(1)} phút (< 3 phút minimum)`,
        slotIndex: i,
        slotId: curr.slotId,
        details: { gapMinutes: gapMin },
      });
    }
  }

  return violations;
}

/** 7. Locked slots — phải giữ nguyên placeId và dayIndex */
function checkLockedSlots(plan: TripSlot[], scenario: BenchmarkScenario): Violation[] {
  const violations: Violation[] = [];

  const lockedOriginals = scenario.initialPlan.filter(s => s.isLocked);

  for (const orig of lockedOriginals) {
    const found = plan.find(s => s.slotId === orig.slotId);

    if (!found) {
      violations.push({
        category: 'locked_modified',
        severity: 'critical',
        message: `Locked slot "${orig.slotId}" (placeId=${orig.placeId}) bị xóa khỏi plan`,
        slotId: orig.slotId,
      });
      continue;
    }

    if (found.placeId !== orig.placeId) {
      violations.push({
        category: 'locked_modified',
        severity: 'critical',
        message: `Locked slot "${orig.slotId}" placeId đổi từ ${orig.placeId} → ${found.placeId}`,
        slotId: orig.slotId,
        details: { originalPlaceId: orig.placeId, newPlaceId: found.placeId },
      });
    }

    if (found.dayIndex !== orig.dayIndex) {
      violations.push({
        category: 'locked_modified',
        severity: 'critical',
        message: `Locked slot "${orig.slotId}" dayIndex đổi từ ${orig.dayIndex} → ${found.dayIndex}`,
        slotId: orig.slotId,
        details: { originalDayIndex: orig.dayIndex, newDayIndex: found.dayIndex },
      });
    }
  }

  return violations;
}

/** 8. Budget feasibility */
function checkBudgetFeasibility(states: TripState[], scenario: BenchmarkScenario): Violation[] {
  const violations: Violation[] = [];

  for (let i = 0; i < states.length; i++) {
    if (states[i].budgetRemaining < -0.01) { // tolerance for float
      violations.push({
        category: 'budget_negative',
        severity: 'critical',
        message: `State[${i}] budgetRemaining = ${states[i].budgetRemaining.toFixed(0)} < 0`,
        slotIndex: i,
        details: { budgetRemaining: states[i].budgetRemaining },
      });
      break; // report chỉ lần đầu
    }
  }

  return violations;
}

/** 9. Fatigue feasibility */
function checkFatigueFeasibility(states: TripState[], scenario: BenchmarkScenario): Violation[] {
  const violations: Violation[] = [];
  const threshold = scenario.userPreferences.fatigueThreshold ?? 0.95;

  for (let i = 0; i < states.length; i++) {
    if (states[i].fatigue > threshold + 0.001) { // tolerance
      violations.push({
        category: 'fatigue_exceeded',
        severity: 'critical',
        message: `State[${i}] fatigue = ${states[i].fatigue.toFixed(3)} > threshold ${threshold}`,
        slotIndex: i,
        details: { fatigue: states[i].fatigue, threshold },
      });
      break;
    }
  }

  return violations;
}

/** 10. State consistency — states.length === plan.length + 1
 *  (states[0] = initial state, states[i+1] = state after visiting plan[i])
 */
function checkStateConsistency(plan: TripSlot[], states: TripState[]): Violation[] {
  const violations: Violation[] = [];
  const expected = plan.length + 1;

  if (states.length !== expected) {
    violations.push({
      category: 'state_inconsistency',
      severity: 'critical',
      message: `states.length (${states.length}) ≠ plan.length + 1 (${expected})`,
    });
  }

  return violations;
}

/** 11. Forbidden places */
function checkForbiddenPlaces(plan: TripSlot[], scenario: BenchmarkScenario): Violation[] {
  const violations: Violation[] = [];
  const forbidden = scenario.expectations.forbiddenPlaceIds ?? [];

  for (let i = 0; i < plan.length; i++) {
    if (forbidden.includes(plan[i].placeId)) {
      violations.push({
        category: 'forbidden_place',
        severity: 'warning',
        message: `Slot ${i} chứa forbidden placeId=${plan[i].placeId}`,
        slotIndex: i,
        slotId: plan[i].slotId,
      });
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────
// SPEC-SPECIFIC VALIDATORS
// ─────────────────────────────────────────────────────────

/**
 * SPEC-01 Validator: So sánh incremental vs full trajectory.
 *
 * Gọi hàm này SAU khi engine chạy xong. Cần engine expose cả 2 paths.
 */
export interface Spec01ValidationInput {
  plan: TripSlot[];
  /** States tính bằng incremental path */
  incrementalStates: TripState[];
  /** States tính bằng full path */
  fullStates: TripState[];
  /** Score bằng delta path */
  deltaScore: number;
  /** Score bằng full path */
  fullScore: number;
}

export function validateSpec01(input: Spec01ValidationInput): Violation[] {
  const violations: Violation[] = [];
  const TOLERANCE = 1e-9;

  // States phải match
  if (input.incrementalStates.length !== input.fullStates.length) {
    violations.push({
      category: 'spec01_mismatch',
      severity: 'critical',
      message: `Incremental states length (${input.incrementalStates.length}) ≠ full (${input.fullStates.length})`,
    });
    return violations;
  }

  for (let i = 0; i < input.fullStates.length; i++) {
    const inc = input.incrementalStates[i];
    const full = input.fullStates[i];

    const diffs: string[] = [];
    if (Math.abs(inc.timeRemainingMin - full.timeRemainingMin) > TOLERANCE)
      diffs.push(`timeRemaining: ${inc.timeRemainingMin} vs ${full.timeRemainingMin}`);
    if (Math.abs(inc.budgetRemaining - full.budgetRemaining) > TOLERANCE)
      diffs.push(`budget: ${inc.budgetRemaining} vs ${full.budgetRemaining}`);
    if (Math.abs(inc.fatigue - full.fatigue) > TOLERANCE)
      diffs.push(`fatigue: ${inc.fatigue} vs ${full.fatigue}`);

    if (diffs.length > 0) {
      violations.push({
        category: 'spec01_mismatch',
        severity: 'critical',
        message: `State[${i}] incremental ≠ full: ${diffs.join(', ')}`,
        slotIndex: i,
      });
    }
  }

  // Score phải match
  if (Math.abs(input.deltaScore - input.fullScore) > TOLERANCE) {
    violations.push({
      category: 'spec01_mismatch',
      severity: 'critical',
      message: `Delta score (${input.deltaScore}) ≠ full score (${input.fullScore})`,
      details: { deltaScore: input.deltaScore, fullScore: input.fullScore },
    });
  }

  return violations;
}

/**
 * SPEC-02 Validator: Kiểm tra pruned candidates thực sự infeasible.
 *
 * Lấy 1 sample pruned candidates, chạy full trajectory để verify.
 */
export interface Spec02ValidationInput {
  /** Candidates bị prune (sample, không cần tất cả) */
  prunedCandidates: Array<{
    plan: TripSlot[];
    pruneReason: string;
  }>;
  /** Function chạy full trajectory + feasibility */
  checkFeasibility: (plan: TripSlot[]) => boolean;
}

export function validateSpec02(input: Spec02ValidationInput): Violation[] {
  const violations: Violation[] = [];

  for (let i = 0; i < input.prunedCandidates.length; i++) {
    const candidate = input.prunedCandidates[i];
    const actuallyFeasible = input.checkFeasibility(candidate.plan);

    if (actuallyFeasible) {
      violations.push({
        category: 'spec02_false_prune',
        severity: 'critical',
        message: `Pruned candidate ${i} is actually FEASIBLE — false prune! Reason: ${candidate.pruneReason}`,
        details: {
          pruneReason: candidate.pruneReason,
          planLength: candidate.plan.length,
        },
      });
    }
  }

  return violations;
}

/**
 * SPEC-03 Validator: Bandit allocation sum = GENERATE_ALL_CAP
 */
export function validateSpec03(
  allocations: Map<string, number>[],
  expectedCap: number = 30,
): Violation[] {
  const violations: Violation[] = [];

  for (let iter = 0; iter < allocations.length; iter++) {
    const alloc = allocations[iter];
    const sum = [...alloc.values()].reduce((a, b) => a + b, 0);

    if (sum !== expectedCap) {
      violations.push({
        category: 'spec03_budget_sum',
        severity: 'critical',
        message: `Iteration ${iter}: allocation sum = ${sum} ≠ expected ${expectedCap}`,
        details: { allocation: Object.fromEntries(alloc), sum, expected: expectedCap },
      });
    }

    // MinAllocation check
    for (const [op, n] of alloc) {
      if (n < 0) {
        violations.push({
          category: 'spec03_budget_sum',
          severity: 'critical',
          message: `Iteration ${iter}: operator ${op} has negative allocation ${n}`,
        });
      }
    }
  }

  return violations;
}

// ─────────────────────────────────────────────────────────
// FULL VALIDATION REPORT
// ─────────────────────────────────────────────────────────

export function printValidationReport(report: ValidationReport): void {
  const icon = report.passed ? '✅' : '❌';
  console.log(`\n${icon} Validation: ${report.scenarioId} / ${report.configLabel}`);
  console.log(`   Critical: ${report.criticalCount} | Warnings: ${report.warningCount}`);

  if (report.violations.length > 0) {
    for (const v of report.violations) {
      const severity = v.severity === 'critical' ? '🔴' : '🟡';
      console.log(`   ${severity} [${v.category}] ${v.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
