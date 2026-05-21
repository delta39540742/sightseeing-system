/**
 * BeamSearch.experiment.test.ts
 *
 * Thu thập data định lượng chứng minh hiệu quả Beam Search:
 *   EXP-1  Grid 2D beamWidth × latencyBudgetMs → heat map chính (90 điểm)
 *   EXP-2  Beam width sweep → so sánh chất lượng (greedy vs. beam)
 *   EXP-3  Latency budget adherence → chứng minh kiểm soát thời gian
 *   EXP-4  Weight sensitivity → chứng minh tính nhất quán của multi-objective scoring
 *   EXP-5  Scale test → chứng minh budget giữ vững với plan lớn
 *
 * Sau khi chạy, lấy CSV:
 *   npm run test -- __tests__/BeamSearch.experiment.test.ts 2>&1 | grep "^DATA-" > data.csv
 */

import { describe, it, expect } from 'vitest';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchConfig,
  type BeamSearchContext,
} from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import type {
  TripSlot,
  TripState,
  Place,
  UserPreference,
  ObjectiveWeights,
  PlaceTag,
} from '@app/types';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function mkTag(id: number): PlaceTag {
  return { tagId: id, name: `tag${id}`, displayName: `Tag ${id}` };
}

function mkPlace(id: number, name: string, tags: PlaceTag[], latOffset: number): Place {
  return {
    placeId: id,
    name,
    description: null,
    lat: 16.060 + latOffset,
    lng: 108.220 + latOffset * 0.5,
    minPrice: 0,
    maxPrice: null,
    priceType: 'free',
    avgVisitDurationMin: 60,
    parkingAvailable: false,
    wheelchairAccess: false,
    publicTransport: false,
    terrainEasiness: 0.8,
    roadAccessScore: null,
    spaciousness1km: null,
    popularityScore: null,
    indoorOutdoor: 'indoor',
    isLandmark: false,
    landmarkClassId: null,
    address: null,
    images: [],
    tags,
    openingHours: [],
  };
}

// ─── Candidate pool ───────────────────────────────────────────────────────────
// User preference vector: tagId=1 (index 0) and tagId=5 (index 4)
// interest per slot = dot(prefVec, tagVec) = tagVec[0] + tagVec[4]
//   Irrel*: interest=0 | Weak*: interest=1 | Med*: interest=2
const PREF_VEC: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const ALL_PLACES: Place[] = [
  mkPlace(201, 'P-Irrel-A', [mkTag(2), mkTag(3)],             0.000), // interest=0
  mkPlace(202, 'P-Irrel-B', [mkTag(4), mkTag(6)],             0.002), // interest=0
  mkPlace(203, 'P-Irrel-C', [mkTag(3), mkTag(7)],             0.004), // interest=0
  mkPlace(204, 'P-Weak-A',  [mkTag(1)],                       0.006), // interest=1  ← initial plan
  mkPlace(205, 'P-Weak-B',  [mkTag(5)],                       0.008), // interest=1
  mkPlace(206, 'P-Weak-C',  [mkTag(1), mkTag(3)],             0.010), // interest=1
  mkPlace(207, 'P-Med-A',   [mkTag(1), mkTag(5)],             0.012), // interest=2
  mkPlace(208, 'P-Med-B',   [mkTag(1), mkTag(2), mkTag(5)],   0.014), // interest=2
  mkPlace(209, 'P-Med-C',   [mkTag(1), mkTag(5), mkTag(7)],   0.016), // interest=2
  mkPlace(210, 'P-Med-D',   [mkTag(1), mkTag(4), mkTag(5)],   0.018), // interest=2
];

// P-Weak-A (placeId=204) is the initial plan place: interest=1, shares tagId=1 with
// P-Med-* places, so REPLACE_PLACE (tag-compatible) can find P-Med-* as alternatives.
const INITIAL_PLACE_ID = 204;

// ─── Weights ──────────────────────────────────────────────────────────────────

const W_INTEREST: ObjectiveWeights = {
  wInterest: 1, wPace: 0, wDistance: 0, wBudget: 0,
  wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0, wProximity: 0,
};

const W_BALANCED: ObjectiveWeights = {
  wInterest: 1, wPace: 0.5, wDistance: 0.5, wBudget: 0,
  wWeather: 0, wRisk: 0.3, wStability: 0, wPotentialBias: 0, wProximity: 0,
};

const W_DISTANCE: ObjectiveWeights = {
  wInterest: 0, wPace: 0, wDistance: 2.0, wBudget: 0,
  wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0, wProximity: 0,
};

// ─── makeSlots ───────────────────────────────────────────────────────────────

function makeSlots(count: number, seedLabel: string): TripSlot[] {
  return Array.from({ length: count }, (_, i) => {
    // Spread across days when count > 8 (8 slots × 2h = 16h per day is safe)
    const dayIndex = Math.floor(i / 8);
    const posInDay = i % 8;
    const baseHourUTC = 1 + posInDay * 2; // 08:00–23:00 VN

    return {
      slotId: `${seedLabel}-s${i}`,
      tripId: 'trip-exp',
      dayIndex,
      slotOrder: posInDay,
      version: 1,
      placeId: INITIAL_PLACE_ID,
      plannedStart: new Date(Date.UTC(2026, 3, 21 + dayIndex, baseHourUTC, 0, 0)).toISOString(),
      plannedEnd:   new Date(Date.UTC(2026, 3, 21 + dayIndex, baseHourUTC + 1, 0, 0)).toISOString(),
      actualStart: null,
      actualEnd: null,
      estimatedCost: 50_000,
      activityType: 'sightseeing' as const,
      rationale: null,
      status: 'planned' as const,
    };
  });
}

function makeUser(): UserPreference {
  return {
    userId: 'user-exp',
    primaryPurpose: 'van_hoa',
    preferredTagIds: [],
    pace: 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: [],
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 10_000_000,
    groupType: 'solo',
    mobilityRestrictions: [],
    preferenceVector: PREF_VEC,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeInitialState(): TripState {
  const wp = ALL_PLACES.find(p => p.placeId === INITIAL_PLACE_ID)!;
  return {
    tripId: 'trip-exp',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 1440,   // 24 h — no time pressure
    budgetRemaining: 10_000_000, // generous
    fatigue: 0.1,
    currentLat: wp.lat,
    currentLng: wp.lng,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T00:30:00.000Z',
    source: 'simulated',
  };
}

// Seeds differ only in slot count: 1→5 slots, 2→4 slots, 3→3 slots
function makeFixture(
  seed: 1 | 2 | 3,
  weights: ObjectiveWeights = W_INTEREST,
): BeamSearchContext {
  const slotCount = seed === 1 ? 5 : seed === 2 ? 4 : 3;
  return {
    candidatePool: ALL_PLACES,
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeInitialState(),
    remainingSlots: makeSlots(slotCount, `s${seed}`),
    weights,
  };
}

// Fixture with arbitrary slot count (for EXP-3 and EXP-5)
function makeFixtureN(slotCount: number, seedTag: string, weights: ObjectiveWeights = W_INTEREST): BeamSearchContext {
  return {
    candidatePool: ALL_PLACES,
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeInitialState(),
    remainingSlots: makeSlots(slotCount, seedTag),
    weights,
  };
}

// Compute score of the initial plan (no mutations applied)
function computeInitialScore(
  evolver: StateEvolver,
  scorer: ObjectiveScorer,
  ctx: BeamSearchContext,
): number {
  const traj = evolver.computeTrajectory(ctx.remainingSlots, ctx.initialState, ctx);
  return scorer.score(ctx.remainingSlots, traj, ctx.weights, ctx);
}

// Run one search and return metrics
function runOnce(
  ctx: BeamSearchContext,
  config: BeamSearchConfig,
): { finalScore: number; initialScore: number; scoreGain: number; actualMs: number; bestDepth: number } {
  const evolver   = new StateEvolver();
  const operators = new MutationOperators(evolver);
  const scorer    = new ObjectiveScorer(evolver);

  const initialScore = computeInitialScore(evolver, scorer, ctx);
  const t0 = Date.now();
  const result = new BeamSearch(evolver, operators, scorer, config).search(ctx);
  const actualMs = Date.now() - t0;

  return {
    finalScore:   result.score,
    initialScore,
    scoreGain:    result.score - initialScore,
    actualMs,
    bestDepth:    result.mutationHistory.length,
  };
}

// ─── EXP-1: Grid 2D beamWidth × latencyBudgetMs ──────────────────────────────

describe('EXP-1: Grid beamWidth × budgetMs [HEAT MAP DATA]', () => {
  const BEAM_WIDTHS = [1, 2, 4, 6, 8, 10] as const;
  const BUDGETS_MS  = [200, 500, 1000, 2000, 4000] as const;
  const SEEDS       = [1, 2, 3] as const;

  // 6 × 5 × 3 = 90 data points total
  it('generates 90-point grid (6 bw × 5 budget × 3 seeds)', { timeout: 240_000 }, () => {
    console.log(
      'DATA-EXP1:beamWidth,budgetMs,seed,slotCount,' +
      'initialScore,finalScore,scoreGain,actualMs,bestDepth'
    );

    const rows: Array<{ bw: number; budget: number; gain: number; ms: number }> = [];

    for (const bw of BEAM_WIDTHS) {
      for (const budget of BUDGETS_MS) {
        for (const seed of SEEDS) {
          const ctx = makeFixture(seed);
          const cfg: BeamSearchConfig = {
            beamWidth: bw,
            maxIterations: 9999,
            improvementThreshold: 0.0001,
            latencyBudgetMs: budget,
          };

          const r = runOnce(ctx, cfg);

          console.log(
            `DATA-EXP1:${bw},${budget},${seed},${ctx.remainingSlots.length},` +
            `${r.initialScore.toFixed(4)},${r.finalScore.toFixed(4)},` +
            `${r.scoreGain.toFixed(4)},${r.actualMs},${r.bestDepth}`
          );

          rows.push({ bw, budget, gain: r.scoreGain, ms: r.actualMs });

          // Core guarantee: time is never exceeded
          expect(r.actualMs).toBeLessThanOrEqual(budget + 300);
          // Score never degrades vs. root
          expect(r.finalScore).toBeGreaterThanOrEqual(r.initialScore - 0.001);
        }
      }
    }

    // Aggregate check: high bw+budget cell outperforms lowest
    const cellLow  = rows.filter(r => r.bw === 1  && r.budget === 200);
    const cellHigh = rows.filter(r => r.bw === 10 && r.budget === 4000);
    const avgGainLow  = cellLow.reduce((s, r) => s + r.gain, 0) / cellLow.length;
    const avgGainHigh = cellHigh.reduce((s, r) => s + r.gain, 0) / cellHigh.length;

    console.log(
      `\n[EXP-1 Summary] avg scoreGain bw=1/200ms=${avgGainLow.toFixed(3)}` +
      `  bw=10/4000ms=${avgGainHigh.toFixed(3)}`
    );
    expect(avgGainHigh).toBeGreaterThanOrEqual(avgGainLow);
  });
});

// ─── EXP-2: beamWidth sweep (greedy vs. beam) ────────────────────────────────

describe('EXP-2: beamWidth Sweep — Greedy vs. Beam quality', () => {
  const BEAM_WIDTHS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
  const SEEDS       = [1, 2, 3] as const;
  const BUDGET_MS   = 5000; // generous, removes time as confound

  // 8 × 3 = 24 data points
  it('generates 24-point sweep (8 bw × 3 seeds)', { timeout: 180_000 }, () => {
    console.log('DATA-EXP2:beamWidth,seed,slotCount,initialScore,finalScore,scoreGain,actualMs,bestDepth');

    const byBw = new Map<number, number[]>(); // bw → [scoreGain per seed]

    for (const bw of BEAM_WIDTHS) {
      byBw.set(bw, []);
      for (const seed of SEEDS) {
        const ctx = makeFixture(seed);
        const cfg: BeamSearchConfig = {
          beamWidth: bw,
          maxIterations: 50,
          improvementThreshold: 0.0001,
          latencyBudgetMs: BUDGET_MS,
        };

        const r = runOnce(ctx, cfg);
        byBw.get(bw)!.push(r.scoreGain);

        console.log(
          `DATA-EXP2:${bw},${seed},${ctx.remainingSlots.length},` +
          `${r.initialScore.toFixed(4)},${r.finalScore.toFixed(4)},` +
          `${r.scoreGain.toFixed(4)},${r.actualMs},${r.bestDepth}`
        );

        expect(r.actualMs).toBeLessThanOrEqual(BUDGET_MS + 300);
        expect(r.finalScore).toBeGreaterThanOrEqual(r.initialScore - 0.001);
      }
    }

    // Summary per beamWidth
    console.log('\n[EXP-2 Summary] avg scoreGain per beamWidth:');
    for (const bw of BEAM_WIDTHS) {
      const gains = byBw.get(bw)!;
      const avg = gains.reduce((s, g) => s + g, 0) / gains.length;
      console.log(`  bw=${bw}: avgGain=${avg.toFixed(3)}`);
    }

    // beamWidth=6 should beat greedy (beamWidth=1)
    const greedyAvg = (byBw.get(1) ?? []).reduce((s, g) => s + g, 0) / (byBw.get(1)?.length ?? 1);
    const beam6Avg  = (byBw.get(6) ?? []).reduce((s, g) => s + g, 0) / (byBw.get(6)?.length ?? 1);
    console.log(`\n[EXP-2 Key Result] greedy avg=${greedyAvg.toFixed(3)}, beam6 avg=${beam6Avg.toFixed(3)}`);
    expect(beam6Avg).toBeGreaterThanOrEqual(greedyAvg);
  });
});

// ─── EXP-3: Latency budget adherence ─────────────────────────────────────────

describe('EXP-3: Latency Budget Adherence — time control across slot counts', () => {
  const BUDGETS_MS  = [300, 600, 1000, 1500, 2000, 3000, 4500, 6000] as const;
  const SLOT_COUNTS = [3, 5, 8] as const;
  const SEEDS       = [1, 2] as const; // 2 seeds per cell → 8 × 3 × 2 = 48 data points

  it('generates 48-point adherence grid (8 budget × 3 slotCount × 2 seeds)', { timeout: 300_000 }, () => {
    console.log('DATA-EXP3:budgetMs,slotCount,seed,actualMs,overtime,scoreGain');

    let maxOvertime = 0;
    let violations = 0;

    for (const budget of BUDGETS_MS) {
      for (const slotCount of SLOT_COUNTS) {
        for (const seed of SEEDS) {
          const ctx = makeFixtureN(slotCount, `exp3-b${budget}-n${slotCount}-s${seed}`);
          const cfg: BeamSearchConfig = {
            beamWidth: 6,
            maxIterations: 9999,
            improvementThreshold: 0.00001, // effectively disabled
            latencyBudgetMs: budget,
          };

          const r = runOnce(ctx, cfg);
          const overtime = r.actualMs - budget;
          maxOvertime = Math.max(maxOvertime, overtime);

          console.log(
            `DATA-EXP3:${budget},${slotCount},${seed},` +
            `${r.actualMs},${overtime},${r.scoreGain.toFixed(4)}`
          );

          // Hard assertion: never exceed budget + 300 ms overhead
          if (r.actualMs > budget + 300) violations++;
          expect(r.actualMs).toBeLessThanOrEqual(budget + 300);
        }
      }
    }

    console.log(`\n[EXP-3 Summary] maxOvertime=${maxOvertime}ms  violations=${violations}/48`);
    expect(violations).toBe(0);
  });
});

// ─── EXP-4: Weight sensitivity ───────────────────────────────────────────────

describe('EXP-4: Weight Sensitivity — multi-objective scoring', () => {
  const CONFIGS = [
    { label: 'INTEREST_ONLY',  weights: W_INTEREST },
    { label: 'DISTANCE_ONLY',  weights: W_DISTANCE },
    { label: 'BALANCED',       weights: W_BALANCED  },
  ] as const;
  const SEEDS = [1, 2, 3] as const;

  // 3 weight configs × 2 beamWidths × 3 seeds = 18 data points
  it('generates 18-point weight sensitivity data', { timeout: 120_000 }, () => {
    console.log('DATA-EXP4:weightConfig,beamWidth,seed,slotCount,initialScore,finalScore,scoreGain,actualMs');

    for (const cfg of CONFIGS) {
      for (const bw of [1, 6] as const) {
        for (const seed of SEEDS) {
          const ctx = makeFixture(seed, cfg.weights);
          const bsCfg: BeamSearchConfig = {
            beamWidth: bw,
            maxIterations: 30,
            improvementThreshold: 0.0001,
            latencyBudgetMs: 4000,
          };

          const r = runOnce(ctx, bsCfg);

          console.log(
            `DATA-EXP4:${cfg.label},${bw},${seed},${ctx.remainingSlots.length},` +
            `${r.initialScore.toFixed(4)},${r.finalScore.toFixed(4)},` +
            `${r.scoreGain.toFixed(4)},${r.actualMs}`
          );

          expect(r.finalScore).toBeGreaterThanOrEqual(r.initialScore - 0.001);
          expect(r.actualMs).toBeLessThanOrEqual(4300);
        }
      }
    }

    // Interest-only with bw=6 should find larger gain than greedy (bw=1)
    // (tested implicitly via EXP-2 — here we just verify no regressions)
  });
});

// ─── EXP-5: Scale test ────────────────────────────────────────────────────────

describe('EXP-5: Scale Test — budget holds across slot counts', () => {
  const SLOT_COUNTS = [3, 5, 8, 10, 12] as const;
  const BUDGET_MS   = 4500;
  const SEEDS       = [1, 2, 3] as const;

  // 5 slot counts × 3 seeds = 15 data points
  it('generates 15-point scale data (5 sizes × 3 seeds)', { timeout: 240_000 }, () => {
    console.log('DATA-EXP5:slotCount,seed,initialScore,finalScore,scoreGain,actualMs,bestDepth');

    const rows: Array<{ slotCount: number; gain: number; ms: number }> = [];

    for (const slotCount of SLOT_COUNTS) {
      for (const seed of SEEDS) {
        const ctx = makeFixtureN(slotCount, `exp5-n${slotCount}-s${seed}`);
        const cfg: BeamSearchConfig = {
          beamWidth: 6,
          maxIterations: 9999,
          improvementThreshold: 0.0001,
          latencyBudgetMs: BUDGET_MS,
        };

        const r = runOnce(ctx, cfg);

        console.log(
          `DATA-EXP5:${slotCount},${seed},` +
          `${r.initialScore.toFixed(4)},${r.finalScore.toFixed(4)},` +
          `${r.scoreGain.toFixed(4)},${r.actualMs},${r.bestDepth}`
        );

        rows.push({ slotCount, gain: r.scoreGain, ms: r.actualMs });

        // Budget holds for ALL slot sizes
        expect(r.actualMs).toBeLessThanOrEqual(BUDGET_MS + 300);
        // Algorithm always improves or maintains quality
        expect(r.finalScore).toBeGreaterThanOrEqual(r.initialScore - 0.001);
      }
    }

    // Summary: show time and gain by slot count
    console.log('\n[EXP-5 Summary] avg actualMs and scoreGain per slotCount:');
    for (const sc of SLOT_COUNTS) {
      const subset = rows.filter(r => r.slotCount === sc);
      const avgMs   = subset.reduce((s, r) => s + r.ms,   0) / subset.length;
      const avgGain = subset.reduce((s, r) => s + r.gain, 0) / subset.length;
      console.log(`  slotCount=${sc}: avgMs=${Math.round(avgMs)}ms  avgGain=${avgGain.toFixed(3)}`);
    }
  });
});
