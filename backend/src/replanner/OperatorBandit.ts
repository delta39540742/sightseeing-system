import type { OperatorName } from './MutationOperators';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const ALL_OPERATORS: OperatorName[] = [
  'TIME_SHIFT',
  'SWAP_ORDER',
  'REPLACE_PLACE',
  'DROP_SLOT',
  'INSERT_ALT',
  'TSP_REORDER',
];

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface OperatorFeedback {
  operator: OperatorName;
  /** Actual candidates taken from this operator this iteration (post-slice, pre-feasibility). */
  candidatesGenerated: number;
  /** How many of those candidates landed in the new beam after MMR selection. */
  candidatesSurvived: number;
}

export interface BanditStats {
  perOperator: Map<OperatorName, {
    totalAllocated: number;
    totalRewarded: number;
    avgReward: number;
    ucbScore: number;
  }>;
  totalRounds: number;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

interface ArmState {
  totalReward: number;
  totalPulls: number;
}

// ---------------------------------------------------------------------------
// UCB1Bandit
// ---------------------------------------------------------------------------

/**
 * UCB1 multi-armed bandit for adaptive operator slot allocation.
 *
 * Each "arm" is one of the 6 mutation operators.  After each beam-search
 * iteration the caller reports how many candidates each operator generated
 * and how many survived into the new beam.  `allocate()` then hands out the
 * next iteration's budget proportional to each arm's UCB1 score:
 *
 *   UCB1(op) = mean_reward(op) + c * sqrt(ln(T) / n(op))
 *
 * Deterministic — no RNG.  Setting explorationConstant = Infinity degenerates
 * to uniform allocation, which is equivalent to the previous round-robin.
 */
export class UCB1Bandit {
  private readonly arms: Map<OperatorName, ArmState>;
  private totalPulls = 0;
  private readonly explorationConstant: number;
  private readonly minAllocation: number;
  private readonly operators: OperatorName[];

  constructor(config: {
    operators?: OperatorName[];
    explorationConstant?: number;
    minAllocation?: number;
  } = {}) {
    this.operators = config.operators ?? [...ALL_OPERATORS];
    this.explorationConstant = config.explorationConstant ?? Math.SQRT2;
    this.minAllocation = config.minAllocation ?? 1;
    this.arms = new Map();
    for (const op of this.operators) {
      this.arms.set(op, { totalReward: 0, totalPulls: 0 });
    }
  }

  /**
   * Return slot counts for each operator that sum to `totalBudget`.
   *
   * Falls back to uniform when:
   * - explorationConstant is Infinity (A/B testing hook)
   * - fewer than 2 complete rounds of data have accumulated
   */
  allocate(totalBudget: number): Map<OperatorName, number> {
    const K = this.operators.length;

    if (!isFinite(this.explorationConstant) || this.totalPulls < K * 2) {
      return this.uniformAllocate(totalBudget);
    }

    const reserved = K * this.minAllocation;
    const flexible = Math.max(0, totalBudget - reserved);

    // Compute UCB score for every arm
    const ucbScores = new Map<OperatorName, number>();
    for (const op of this.operators) {
      const arm = this.arms.get(op)!;
      const avgReward = arm.totalPulls > 0 ? arm.totalReward / arm.totalPulls : 0;
      const bonus = this.explorationConstant *
        Math.sqrt(Math.log(this.totalPulls) / Math.max(1, arm.totalPulls));
      ucbScores.set(op, avgReward + bonus);
    }

    const totalUCB = [...ucbScores.values()].reduce((a, b) => a + b, 0);
    if (totalUCB <= 0) return this.uniformAllocate(totalBudget);

    // Sort descending so rounding correction is applied to the highest-UCB arm
    const sortedOps = this.operators
      .map(op => ({ op, ucb: ucbScores.get(op)! }))
      .sort((a, b) => b.ucb - a.ucb);

    const allocation = new Map<OperatorName, number>();
    let allocated = 0;
    for (const { op, ucb } of sortedOps) {
      const flexSlots = Math.round((ucb / totalUCB) * flexible);
      const total = this.minAllocation + flexSlots;
      allocation.set(op, total);
      allocated += total;
    }

    // Correct rounding drift by adjusting the top-UCB operator
    const diff = totalBudget - allocated;
    if (diff !== 0) {
      const topOp = sortedOps[0]!.op;
      allocation.set(topOp, allocation.get(topOp)! + diff);
    }

    this.clampAllocations(allocation, totalBudget);
    return allocation;
  }

  /** Incorporate feedback from one beam-search iteration. */
  update(feedbacks: OperatorFeedback[]): void {
    for (const fb of feedbacks) {
      const arm = this.arms.get(fb.operator);
      if (!arm) continue;
      arm.totalPulls += fb.candidatesGenerated;
      arm.totalReward += fb.candidatesSurvived;
      this.totalPulls += fb.candidatesGenerated;
    }
  }

  /** Reset all arm statistics — call at the start of each new replan. */
  reset(): void {
    this.totalPulls = 0;
    for (const op of this.operators) {
      this.arms.set(op, { totalReward: 0, totalPulls: 0 });
    }
  }

  getStats(): BanditStats {
    const perOperator = new Map<OperatorName, {
      totalAllocated: number;
      totalRewarded: number;
      avgReward: number;
      ucbScore: number;
    }>();

    for (const op of this.operators) {
      const arm = this.arms.get(op)!;
      const avgReward = arm.totalPulls > 0 ? arm.totalReward / arm.totalPulls : 0;
      const ucbScore = (this.totalPulls > 0 && arm.totalPulls > 0)
        ? avgReward + this.explorationConstant *
          Math.sqrt(Math.log(this.totalPulls) / arm.totalPulls)
        : Infinity;
      perOperator.set(op, {
        totalAllocated: arm.totalPulls,
        totalRewarded: arm.totalReward,
        avgReward,
        ucbScore,
      });
    }

    return { perOperator, totalRounds: this.totalPulls };
  }

  private uniformAllocate(budget: number): Map<OperatorName, number> {
    const alloc = new Map<OperatorName, number>();
    const K = this.operators.length;
    const base = Math.floor(budget / K);
    let remainder = budget - base * K;
    for (const op of this.operators) {
      alloc.set(op, base + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder--;
    }
    return alloc;
  }

  // Guarantee no operator drops below minAllocation and total ≤ budget.
  private clampAllocations(alloc: Map<OperatorName, number>, budget: number): void {
    let total = 0;
    for (const [op, n] of alloc) {
      const clamped = Math.max(this.minAllocation, n);
      alloc.set(op, clamped);
      total += clamped;
    }
    while (total > budget) {
      let maxOp: OperatorName | null = null;
      let maxN = 0;
      for (const [op, n] of alloc) {
        if (n > this.minAllocation && n > maxN) {
          maxN = n;
          maxOp = op;
        }
      }
      if (!maxOp) break;
      alloc.set(maxOp, alloc.get(maxOp)! - 1);
      total--;
    }
  }
}
