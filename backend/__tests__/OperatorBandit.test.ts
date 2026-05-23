import { describe, it, expect, beforeEach } from 'vitest';
import { UCB1Bandit, ALL_OPERATORS, type OperatorFeedback } from '../src/replanner/OperatorBandit';
import { collectFeedback, type BeamNode } from '../src/replanner/BeamSearch';
import type { OperatorName } from '../src/replanner/MutationOperators';
import type { TripSlot } from '@app/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeedback(
  op: OperatorName,
  generated: number,
  survived: number,
): OperatorFeedback {
  return { operator: op, candidatesGenerated: generated, candidatesSurvived: survived };
}

function makeSlot(placeId: number, dayIndex = 0, slotOrder = 0): TripSlot {
  return {
    slotId: `s${placeId}-${slotOrder}`,
    tripId: 'trip-1',
    dayIndex,
    slotOrder,
    version: 1,
    placeId,
    plannedStart: `2026-05-01T0${7 + slotOrder}:00:00Z`,
    plannedEnd: `2026-05-01T0${8 + slotOrder}:00:00Z`,
    actualStart: null,
    actualEnd: null,
    estimatedCost: 0,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
  };
}

function makeNode(plan: TripSlot[], lastOp?: OperatorName): BeamNode {
  return {
    plan,
    stateTrajectory: [],
    score: 0,
    mutationHistory: lastOp
      ? [{ operator: lastOp, newPlan: plan, affectedSlotIds: [], description: '' }]
      : [],
    parent: null,
  };
}

// Seed a bandit with multiple rounds so adaptive mode kicks in.
function seedBandit(
  bandit: UCB1Bandit,
  feedbacks: OperatorFeedback[],
  rounds: number,
): void {
  for (let i = 0; i < rounds; i++) {
    bandit.update(feedbacks);
  }
}

// ---------------------------------------------------------------------------
// UCB1Bandit — allocate
// ---------------------------------------------------------------------------

describe('UCB1Bandit.allocate', () => {
  it('returns uniform allocation before 2K pulls', () => {
    const bandit = new UCB1Bandit();
    const alloc = bandit.allocate(30);

    let total = 0;
    for (const [, n] of alloc) total += n;
    expect(total).toBe(30);

    // All 6 operators should get ~5 (30/6), differing at most by 1 due to rounding
    for (const [, n] of alloc) {
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('operator with higher avg reward gets more allocation after seeding', () => {
    const bandit = new UCB1Bandit();

    // REPLACE_PLACE survives frequently, others never survive
    const feedbacks: OperatorFeedback[] = ALL_OPERATORS.map(op => makeFeedback(op, 5, op === 'REPLACE_PLACE' ? 4 : 0));
    seedBandit(bandit, feedbacks, 10);

    const alloc = bandit.allocate(30);
    const replacePlaceAlloc = alloc.get('REPLACE_PLACE')!;
    const timeShiftAlloc = alloc.get('TIME_SHIFT')!;

    expect(replacePlaceAlloc).toBeGreaterThan(timeShiftAlloc);
    expect(replacePlaceAlloc).toBeGreaterThan(5); // above uniform share
  });

  it('sum of allocations equals budget (budget conservation)', () => {
    const bandit = new UCB1Bandit();
    const feedbacks: OperatorFeedback[] = ALL_OPERATORS.map(op => makeFeedback(op, 5, 2));
    seedBandit(bandit, feedbacks, 10);

    for (const budget of [30, 24, 18, 12]) {
      const alloc = bandit.allocate(budget);
      let total = 0;
      for (const [, n] of alloc) total += n;
      expect(total).toBe(budget);
    }
  });

  it('every operator receives at least minAllocation slots', () => {
    const bandit = new UCB1Bandit({ minAllocation: 1 });
    // Make one operator look dominant
    const feedbacks: OperatorFeedback[] = ALL_OPERATORS.map(op =>
      makeFeedback(op, 5, op === 'INSERT_ALT' ? 5 : 0),
    );
    seedBandit(bandit, feedbacks, 15);

    const alloc = bandit.allocate(30);
    for (const [, n] of alloc) {
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  it('is deterministic — same feedbacks produce same allocation', () => {
    const feedbacks: OperatorFeedback[] = ALL_OPERATORS.map(op =>
      makeFeedback(op, 5, op === 'SWAP_ORDER' ? 3 : 1),
    );

    const banditA = new UCB1Bandit();
    seedBandit(banditA, feedbacks, 8);
    const allocA = banditA.allocate(30);

    const banditB = new UCB1Bandit();
    seedBandit(banditB, feedbacks, 8);
    const allocB = banditB.allocate(30);

    for (const op of ALL_OPERATORS) {
      expect(allocA.get(op)).toBe(allocB.get(op));
    }
  });

  it('explorationConstant = Infinity degenerates to uniform allocation', () => {
    const bandit = new UCB1Bandit({ explorationConstant: Infinity });
    const feedbacks: OperatorFeedback[] = ALL_OPERATORS.map(op =>
      makeFeedback(op, 5, op === 'DROP_SLOT' ? 5 : 0),
    );
    seedBandit(bandit, feedbacks, 20);

    const alloc = bandit.allocate(30);
    // Should still be ~5 per operator (uniform)
    for (const [, n] of alloc) {
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('exploration bonus is higher for under-pulled operators', () => {
    const bandit = new UCB1Bandit();
    // Only pull TIME_SHIFT heavily; others stay at bootstrap level
    for (let i = 0; i < 20; i++) {
      bandit.update([makeFeedback('TIME_SHIFT', 10, 1)]);
    }

    const stats = bandit.getStats();
    const timeShiftUCB = stats.perOperator.get('TIME_SHIFT')!.ucbScore;
    const swapOrderUCB = stats.perOperator.get('SWAP_ORDER')!.ucbScore;

    // SWAP_ORDER has been pulled 0 times → ucbScore = Infinity
    expect(swapOrderUCB).toBe(Infinity);
    // TIME_SHIFT has many pulls → finite ucbScore
    expect(isFinite(timeShiftUCB)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UCB1Bandit — update & reset
// ---------------------------------------------------------------------------

describe('UCB1Bandit.update', () => {
  it('accumulates pulls and rewards correctly', () => {
    const bandit = new UCB1Bandit();
    bandit.update([makeFeedback('TIME_SHIFT', 5, 2)]);
    bandit.update([makeFeedback('TIME_SHIFT', 3, 1)]);

    const stats = bandit.getStats();
    const arm = stats.perOperator.get('TIME_SHIFT')!;
    expect(arm.totalAllocated).toBe(8);
    expect(arm.totalRewarded).toBe(3);
    expect(arm.avgReward).toBeCloseTo(3 / 8);
  });

  it('ignores unknown operator names gracefully', () => {
    const bandit = new UCB1Bandit();
    expect(() => {
      bandit.update([{ operator: 'UNKNOWN_OP' as OperatorName, candidatesGenerated: 5, candidatesSurvived: 1 }]);
    }).not.toThrow();
  });
});

describe('UCB1Bandit.reset', () => {
  it('clears all arm state', () => {
    const bandit = new UCB1Bandit();
    const feedbacks = ALL_OPERATORS.map(op => makeFeedback(op, 5, 2));
    seedBandit(bandit, feedbacks, 5);

    bandit.reset();
    const stats = bandit.getStats();
    expect(stats.totalRounds).toBe(0);
    for (const [, arm] of stats.perOperator) {
      expect(arm.totalAllocated).toBe(0);
      expect(arm.totalRewarded).toBe(0);
    }
  });

  it('reverts to uniform allocation after reset', () => {
    const bandit = new UCB1Bandit();
    // Seed so REPLACE_PLACE dominates
    const feedbacks = ALL_OPERATORS.map(op =>
      makeFeedback(op, 5, op === 'REPLACE_PLACE' ? 5 : 0),
    );
    seedBandit(bandit, feedbacks, 15);

    bandit.reset();
    const alloc = bandit.allocate(30);
    // Should be uniform again
    for (const [, n] of alloc) {
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});

// ---------------------------------------------------------------------------
// collectFeedback
// ---------------------------------------------------------------------------

describe('collectFeedback', () => {
  it('credits operator when its candidate survives into the beam', () => {
    const plan = [makeSlot(1), makeSlot(2)];
    const survivor = makeNode(plan, 'REPLACE_PLACE');
    const nonSurvivor = makeNode([makeSlot(3), makeSlot(4)], 'TIME_SHIFT');

    const generatedCounts = new Map<OperatorName, number>([
      ['REPLACE_PLACE', 3],
      ['TIME_SHIFT', 3],
    ]);

    const feedbacks = collectFeedback([survivor], [survivor, nonSurvivor], generatedCounts);

    const rp = feedbacks.find(f => f.operator === 'REPLACE_PLACE')!;
    const ts = feedbacks.find(f => f.operator === 'TIME_SHIFT')!;

    expect(rp.candidatesSurvived).toBe(1);
    expect(ts.candidatesSurvived).toBe(0);
  });

  it('candidate not in beam gets reward 0', () => {
    const beamPlan = [makeSlot(10)];
    const rejectedPlan = [makeSlot(20)];

    const beam = [makeNode(beamPlan, 'TSP_REORDER')];
    const candidates = [makeNode(beamPlan, 'TSP_REORDER'), makeNode(rejectedPlan, 'SWAP_ORDER')];
    const generatedCounts = new Map<OperatorName, number>([
      ['TSP_REORDER', 1],
      ['SWAP_ORDER', 1],
    ]);

    const feedbacks = collectFeedback(beam, candidates, generatedCounts);

    const swap = feedbacks.find(f => f.operator === 'SWAP_ORDER')!;
    expect(swap.candidatesSurvived).toBe(0);
  });

  it('passes through generated counts from the allocation map', () => {
    const plan = [makeSlot(5)];
    const node = makeNode(plan, 'DROP_SLOT');
    const generatedCounts = new Map<OperatorName, number>([
      ['DROP_SLOT', 7],
      ['INSERT_ALT', 4],
    ]);

    const feedbacks = collectFeedback([node], [node], generatedCounts);

    expect(feedbacks.find(f => f.operator === 'DROP_SLOT')!.candidatesGenerated).toBe(7);
    expect(feedbacks.find(f => f.operator === 'INSERT_ALT')!.candidatesGenerated).toBe(4);
  });

  it('empty beam results in zero survival for all operators', () => {
    const plan = [makeSlot(1)];
    const candidate = makeNode(plan, 'TIME_SHIFT');
    const generatedCounts = new Map<OperatorName, number>([['TIME_SHIFT', 5]]);

    const feedbacks = collectFeedback([], [candidate], generatedCounts);

    for (const fb of feedbacks) {
      expect(fb.candidatesSurvived).toBe(0);
    }
  });

  it('covers all 6 operators in output even if not in generatedCounts', () => {
    const feedbacks = collectFeedback([], [], new Map());
    expect(feedbacks).toHaveLength(6);
    const ops = feedbacks.map(f => f.operator);
    for (const op of ALL_OPERATORS) {
      expect(ops).toContain(op);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('UCB1Bandit edge cases', () => {
  it('operator generating 0 candidates records 0 reward', () => {
    const bandit = new UCB1Bandit();
    // TIME_SHIFT generates nothing this round
    bandit.update([makeFeedback('TIME_SHIFT', 0, 0)]);
    const stats = bandit.getStats();
    expect(stats.perOperator.get('TIME_SHIFT')!.totalAllocated).toBe(0);
    expect(stats.perOperator.get('TIME_SHIFT')!.totalRewarded).toBe(0);
  });

  it('all candidates rejected → all rewards = 0 → next round exploration dominates', () => {
    const bandit = new UCB1Bandit();
    // Seed a few rounds with zero survival
    const feedbacks = ALL_OPERATORS.map(op => makeFeedback(op, 5, 0));
    seedBandit(bandit, feedbacks, 5);

    const stats = bandit.getStats();
    for (const [, arm] of stats.perOperator) {
      expect(arm.avgReward).toBe(0);
      // UCB score should be purely exploration bonus (> 0)
      expect(arm.ucbScore).toBeGreaterThan(0);
    }
  });

  it('budget smaller than K * minAllocation degrades gracefully', () => {
    // 6 operators, minAllocation=2, budget=6 → each gets 1 (clamped down)
    // Actually with budget=6 and min=2 we'd need 12 but only have 6 — budget cannot satisfy min
    // The clamp logic should not crash
    const bandit = new UCB1Bandit({ minAllocation: 2 });
    const feedbacks = ALL_OPERATORS.map(op => makeFeedback(op, 5, 2));
    seedBandit(bandit, feedbacks, 10);

    expect(() => bandit.allocate(6)).not.toThrow();
    const alloc = bandit.allocate(6);
    let total = 0;
    for (const [, n] of alloc) total += n;
    // May not hit exactly 6, but must not crash or produce negative values
    for (const [, n] of alloc) {
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('custom operator subset works correctly', () => {
    const subset: OperatorName[] = ['TIME_SHIFT', 'REPLACE_PLACE', 'DROP_SLOT'];
    const bandit = new UCB1Bandit({ operators: subset });

    const alloc = bandit.allocate(15);
    expect(alloc.size).toBe(3);
    expect(alloc.has('TIME_SHIFT')).toBe(true);
    expect(alloc.has('REPLACE_PLACE')).toBe(true);
    expect(alloc.has('DROP_SLOT')).toBe(true);
    expect(alloc.has('SWAP_ORDER')).toBe(false);

    let total = 0;
    for (const [, n] of alloc) total += n;
    expect(total).toBe(15);
  });
});
