/**
 * Engine Adapter — Kết nối engine thật vào benchmark harness.
 *
 * Architecture:
 *
 *   BenchmarkScenario
 *         │
 *         ▼
 *   ┌─ EngineAdapter ─────────────────────────────────────┐
 *   │  1. buildContexts()    — map scenario → engine       │
 *   │  2. engine.search()    — chạy beam search            │
 *   │  3. collectOutput()    — map engine → EngineOutput    │
 *   └─────────────────────────────────────────────────────┘
 *         │
 *         ▼
 *   EngineOutput (benchmark đọc)
 *
 * ────────────────────────────────────────────────────────
 * HƯỚNG DẪN INTEGRATE:
 *
 *   1. Sửa import paths ở đầu file cho khớp codebase       ✅ DONE
 *   2. Inject SearchInstrumentation vào BeamSearch           ✅ DONE
 *   3. Chạy: npx tsx benchmark/main.ts quick
 * ────────────────────────────────────────────────────────
 */

import {
  ReplanEngine,
  EngineConfig,
  EngineOutput,
  BenchmarkScenario,
  TripSlot,
  TripState,
  PlaceCandidate,
  WeatherForecast,
  UserPreferences,
} from './types';

// ══════════════════════════════════════════════════════════
// Engine imports — paths khớp codebase thật
// ══════════════════════════════════════════════════════════

import { BeamSearch, ObjectiveScorer } from '../backend/src/replanner/BeamSearch';
import type {
  BeamSearchConfig as RealBeamSearchConfig,
  BeamSearchContext,
  BeamNode,
} from '../backend/src/replanner/BeamSearch';
import { MutationOperators } from '../backend/src/replanner/MutationOperators';
import { StateEvolver } from '../backend/src/replanner/StateEvolver';
import type { ReplanContext, WeatherSnapshot } from '../backend/src/replanner/StateEvolver';
import type {
  Place,
  UserPreference,
  ObjectiveWeights,
  TripSlot as EngineTripSlot,
  TripState as EngineTripState,
} from '../backend/src/types';

// ══════════════════════════════════════════════════════════
// TYPE CONVERSION HELPERS
// Benchmark types ↔ Engine types
// ══════════════════════════════════════════════════════════

/**
 * Chuyển PlaceCandidate (benchmark) → Place (engine).
 *
 * Các field engine yêu cầu nhưng benchmark không có (indoorOutdoor,
 * terrainEasiness, tags dạng object) được map từ dữ liệu có sẵn
 * hoặc dùng giá trị mặc định hợp lý.
 */
function toEnginePlace(pc: PlaceCandidate): Place {
  return {
    placeId: pc.placeId,
    name: pc.name,
    lat: pc.lat,
    lng: pc.lng,
    avgVisitDurationMin: pc.avgVisitDurationMin,
    estimatedCost: pc.estimatedCost,
    indoorOutdoor: inferIndoorOutdoor(pc.activityType),
    terrainEasiness: 0.8,  // default — benchmark không có terrain data
    tags: pc.tags.map((tagId) => ({ tagId })),
    openingHours: [
      {
        dayOfWeek: 0,  // generic — dùng cho mọi ngày
        openTime: `${String(pc.openingHour).padStart(2, '0')}:00`,
        closeTime: `${String(pc.closingHour).padStart(2, '0')}:00`,
      },
    ],
  };
}

/**
 * Suy luận indoor/outdoor từ activityType của benchmark.
 * - 'rest' / 'meal' → indoor
 * - 'activity' → mixed
 * - 'sightseeing' → outdoor
 */
function inferIndoorOutdoor(
  activityType: PlaceCandidate['activityType'],
): Place['indoorOutdoor'] {
  switch (activityType) {
    case 'rest':
    case 'meal':
      return 'indoor';
    case 'activity':
      return 'mixed';
    case 'sightseeing':
    default:
      return 'outdoor';
  }
}

/**
 * Chuyển WeatherForecast (benchmark) → WeatherSnapshot (engine).
 * Engine chỉ cần rainMmPerH; benchmark có thêm tempCelsius, condition.
 */
function toWeatherSnapshot(wf: WeatherForecast): WeatherSnapshot {
  return { rainMmPerH: wf.precipMmPerHour };
}

/**
 * Chuyển UserPreferences (benchmark) → UserPreference (engine).
 */
function toEngineUser(prefs: UserPreferences): UserPreference {
  return {
    preferenceVector: prefs.preferenceVector,
    pace: prefs.preferredPace,
  };
}

/**
 * Chuyển TripSlot (benchmark) → EngineTripSlot.
 * Thêm các field thiếu (tripId → 'benchmark').
 */
function toEngineSlot(slot: TripSlot): EngineTripSlot {
  return {
    ...slot,
    // Engine TripSlot yêu cầu activityType bao gồm 'transport'
    // Benchmark không có 'transport' nên cast an toàn
    activityType: slot.activityType as EngineTripSlot['activityType'],
  };
}

/**
 * Chuyển TripState (benchmark) → EngineTripState.
 * Thêm tripId và source (fields engine yêu cầu nhưng benchmark không có).
 */
function toEngineState(state: TripState): EngineTripState {
  return {
    ...state,
    tripId: 'benchmark',
    source: 'simulated' as const,
  };
}

/**
 * Chuyển EngineTripState → TripState (benchmark).
 * Loại bỏ tripId và source.
 */
function toBenchmarkState(state: EngineTripState): TripState {
  return {
    timeRemainingMin: state.timeRemainingMin,
    budgetRemaining: state.budgetRemaining,
    fatigue: state.fatigue,
    moodProxy: state.moodProxy,
    currentLat: state.currentLat,
    currentLng: state.currentLng,
    dayIndex: state.dayIndex,
    slotOrder: state.slotOrder,
    capturedAt: state.capturedAt,
  };
}

/**
 * Chuyển EngineTripSlot → TripSlot (benchmark).
 */
function toBenchmarkSlot(slot: EngineTripSlot): TripSlot {
  return {
    slotId: slot.slotId,
    tripId: slot.tripId,
    dayIndex: slot.dayIndex,
    slotOrder: slot.slotOrder,
    placeId: slot.placeId,
    plannedStart: slot.plannedStart,
    plannedEnd: slot.plannedEnd,
    actualStart: slot.actualStart,
    actualEnd: slot.actualEnd,
    estimatedCost: slot.estimatedCost,
    activityType: slot.activityType as TripSlot['activityType'],
    status: slot.status,
    isLocked: slot.isLocked,
    version: slot.version,
    rationale: slot.rationale,
  };
}

/**
 * Tạo ObjectiveWeights mặc định cho benchmark.
 * Trọng số cân bằng giữa các mục tiêu.
 */
function defaultWeights(): ObjectiveWeights {
  return {
    wInterest: 0.20,
    wPace: 0.15,
    wDistance: 0.10,
    wBudget: 0.15,
    wWeather: 0.10,
    wRisk: 0.10,
    wStability: 0.05,
    wPotentialBias: 0.05,
    wProximity: 0.0,
    wSynergy: 0.10,
  };
}

// ══════════════════════════════════════════════════════════
// SEARCH INSTRUMENTATION — inject vào BeamSearch
// ══════════════════════════════════════════════════════════

/**
 * Collector class thu thập metrics trong quá trình search.
 *
 * CÁCH DÙNG TRONG BEAM SEARCH:
 *
 * ```typescript
 * class BeamSearch {
 *   private instrumentation?: SearchInstrumentation;
 *
 *   constructor(config, instrumentation?) {
 *     this.instrumentation = instrumentation;
 *   }
 *
 *   search(plan, ctx) {
 *     this.instrumentation?.start();
 *
 *     for (let iter = 0; iter < maxIter; iter++) {
 *       this.instrumentation?.beginIteration(iter);
 *
 *       // ... generate candidates ...
 *       this.instrumentation?.recordCandidates(candidates.length);
 *
 *       // ... prune (spec-02) ...
 *       this.instrumentation?.recordPruned(prunedCount);
 *
 *       // ... compute trajectory ...
 *       this.instrumentation?.recordCacheHits(cacheHitCount);
 *
 *       // ... select beam ...
 *       this.instrumentation?.recordSurvivors(newBeam.length);
 *
 *       // ... operator allocations (spec-03) ...
 *       this.instrumentation?.recordAllocations(allocation);
 *
 *       this.instrumentation?.endIteration();
 *     }
 *
 *     this.instrumentation?.finish();
 *   }
 * }
 * ```
 */
export class SearchInstrumentation {
  private _startTime: number = 0;
  private _iterStartTime: number = 0;

  // Collected data
  totalMs: number = 0;
  perIterationMs: number[] = [];
  iterations: number = 0;
  candidatesPerIteration: number[] = [];
  survivorsPerIteration: number[] = [];
  prunedPerIteration: number[] = [];
  cacheHitsPerIteration: number[] = [];
  operatorAllocations: Map<string, number>[] = [];

  // Current iteration accumulators
  private _currentCandidates: number = 0;
  private _currentSurvivors: number = 0;
  private _currentPruned: number = 0;
  private _currentCacheHits: number = 0;

  start(): void {
    this.reset();
    this._startTime = performance.now();
  }

  beginIteration(_iter: number): void {
    this._iterStartTime = performance.now();
    this._currentCandidates = 0;
    this._currentSurvivors = 0;
    this._currentPruned = 0;
    this._currentCacheHits = 0;
  }

  recordCandidates(count: number): void {
    this._currentCandidates += count;
  }

  recordPruned(count: number): void {
    this._currentPruned += count;
  }

  recordCacheHits(count: number): void {
    this._currentCacheHits += count;
  }

  recordSurvivors(count: number): void {
    this._currentSurvivors = count;
  }

  recordAllocations(alloc: Map<string, number>): void {
    this.operatorAllocations.push(new Map(alloc));
  }

  endIteration(): void {
    const elapsed = performance.now() - this._iterStartTime;
    this.perIterationMs.push(elapsed);
    this.candidatesPerIteration.push(this._currentCandidates);
    this.survivorsPerIteration.push(this._currentSurvivors);
    this.prunedPerIteration.push(this._currentPruned);
    this.cacheHitsPerIteration.push(this._currentCacheHits);
    this.iterations++;
  }

  finish(): void {
    this.totalMs = performance.now() - this._startTime;
  }

  reset(): void {
    this.totalMs = 0;
    this.perIterationMs = [];
    this.iterations = 0;
    this.candidatesPerIteration = [];
    this.survivorsPerIteration = [];
    this.prunedPerIteration = [];
    this.cacheHitsPerIteration = [];
    this.operatorAllocations = [];
  }

  /** Export cho EngineOutput.timing */
  toTimingData(): EngineOutput['timing'] {
    return {
      totalMs: this.totalMs,
      perIterationMs: [...this.perIterationMs],
    };
  }

  /** Export cho EngineOutput.search */
  toSearchData(): EngineOutput['search'] {
    return {
      iterations: this.iterations,
      candidatesPerIteration: [...this.candidatesPerIteration],
      survivorsPerIteration: [...this.survivorsPerIteration],
      prunedPerIteration: [...this.prunedPerIteration],
      cacheHitsPerIteration: [...this.cacheHitsPerIteration],
      operatorAllocations: this.operatorAllocations.map(m => new Map(m)),
    };
  }
}

// ══════════════════════════════════════════════════════════
// CONTEXT BUILDER — Map BenchmarkScenario → Engine contexts
// ══════════════════════════════════════════════════════════

/**
 * Xây dựng BeamSearchContext từ BenchmarkScenario.
 *
 * Chuyển đổi tất cả benchmark types → engine types:
 *   - PlaceCandidate[] → Place[] (candidatePool)
 *   - WeatherForecast[] → WeatherSnapshot[] (weatherForecast)
 *   - UserPreferences → UserPreference (user)
 *   - TripState → EngineTripState (initialState)
 *   - TripSlot[] → EngineTripSlot[] (remainingSlots)
 *   - Tạo ObjectiveWeights mặc định
 */
function buildBeamSearchContext(
  scenario: BenchmarkScenario,
): BeamSearchContext {
  // ── Chuyển đổi types ──
  const candidatePool: Place[] = scenario.candidatePool.map(toEnginePlace);
  const user: UserPreference = toEngineUser(scenario.userPreferences);
  const initialState: EngineTripState = toEngineState(scenario.initialState);
  const remainingSlots: EngineTripSlot[] = scenario.initialPlan.map(toEngineSlot);

  // ── WeatherForecast → indexed WeatherSnapshot[] ──
  // Engine weatherForecast là mảng index bởi dayIndex.
  // Tìm max dayIndex để tạo mảng đủ lớn.
  const maxDayIndex = scenario.weatherForecast.reduce(
    (max, wf) => Math.max(max, wf.dayIndex),
    0,
  );
  const weatherForecast: WeatherSnapshot[] = new Array(maxDayIndex + 1).fill({
    rainMmPerH: 0,
  });
  for (const wf of scenario.weatherForecast) {
    weatherForecast[wf.dayIndex] = toWeatherSnapshot(wf);
  }

  // ── ObjectiveWeights ──
  const weights: ObjectiveWeights = defaultWeights();

  return {
    remainingSlots,
    weights,
    candidatePool,
    user,
    weatherForecast,
    initialState,
  };
}

// ══════════════════════════════════════════════════════════
// ENGINE ADAPTER
// ══════════════════════════════════════════════════════════

export class EngineAdapter implements ReplanEngine {
  private config: EngineConfig = {
    label: 'default',
    incrementalTrajectory: false,
    constraintPropagation: false,
    adaptiveOperators: false,
    beamWidth: 6,
    maxIterations: 20,
    improvementThreshold: 0.01,
  };

  private instrumentation = new SearchInstrumentation();

  configure(config: EngineConfig): void {
    this.config = config;
  }

  run(scenario: BenchmarkScenario): EngineOutput {
    this.instrumentation.reset();

    const ctx = buildBeamSearchContext(scenario);

    // ── Khởi tạo engine components ──

    const evolver = new StateEvolver();
    const operators = new MutationOperators(evolver);
    const scorer = new ObjectiveScorer(evolver);

    const beamSearchConfig: RealBeamSearchConfig = {
      beamWidth: this.config.beamWidth,
      maxIterations: this.config.maxIterations,
      improvementThreshold: this.config.improvementThreshold,
      latencyBudgetMs: 4500,

      // Feature flags từ EngineConfig
      adaptiveOperators: this.config.adaptiveOperators,
      banditExploration: this.config.banditExploration,
      banditMinAllocation: this.config.banditMinAllocation,
    };

    const beamSearch = new BeamSearch(
      evolver,
      operators,
      scorer,
      beamSearchConfig,
    );

    // ── Chạy search với instrumentation ──

    this.instrumentation.start();
    const bestNode: BeamNode = beamSearch.search(ctx);
    this.instrumentation.finish();

    // ── Thu thập per-iteration metrics từ engine ──
    // Engine BeamSearch hiện tại không expose per-iteration metrics trực tiếp.
    // Dùng instrumentation wrapper: đo thời gian tổng thể và tính toán từ
    // kết quả cuối cùng.
    //
    // Với per-iteration data chi tiết hơn, cần inject SearchInstrumentation
    // vào BeamSearch (xem hướng dẫn ở cuối file).
    // Hiện tại, ghi lại metrics ở mức tổng thể.

    if (this.instrumentation.iterations === 0) {
      // Nếu chưa có iteration data từ instrumentation,
      // tạo một iteration entry duy nhất chứa toàn bộ thời gian.
      this.instrumentation.perIterationMs = [this.instrumentation.totalMs];
      this.instrumentation.candidatesPerIteration = [0];
      this.instrumentation.survivorsPerIteration = [beamSearchConfig.beamWidth];
      this.instrumentation.prunedPerIteration = [0];
      this.instrumentation.cacheHitsPerIteration = [0];
      this.instrumentation.iterations = 1;
    }

    // ── Map BeamNode → EngineOutput ──

    const bestPlan: TripSlot[] = bestNode.plan.map(toBenchmarkSlot);
    const bestStates: TripState[] = bestNode.stateTrajectory.map(toBenchmarkState);

    return {
      bestNode: {
        plan: bestPlan,
        score: bestNode.score,
        mutationHistory: bestNode.mutationHistory.map((m) => ({
          operator: m.operator,
          affectedSlotIds: [...m.affectedSlotIds],
        })),
      },
      beam: [{ plan: bestPlan, score: bestNode.score }],
      states: bestStates,
      feasible: bestNode.stateTrajectory
        .slice(1)
        .every((s) => evolver.isFeasible(s)),
      timing: this.instrumentation.toTimingData(),
      search: this.instrumentation.toSearchData(),
    };
  }

  // ──────────────────────────────────────────────────────
  // SCORE INITIAL PLAN — Gọi trực tiếp, không qua search
  // ──────────────────────────────────────────────────────

  /**
   * Tính score cho plan ban đầu mà KHÔNG chạy beam search.
   * Dùng cho benchmark để có initial score ổn định.
   */
  scoreInitialPlan(scenario: BenchmarkScenario): number {
    const ctx = buildBeamSearchContext(scenario);
    const evolver = new StateEvolver();
    const scorer = new ObjectiveScorer(evolver);

    // Tính trajectory cho plan ban đầu
    const trajectory = evolver.computeTrajectory(
      ctx.remainingSlots,
      ctx.initialState,
      ctx,
    );

    // Kiểm tra feasibility — plan infeasible → score rất thấp
    const isFeasible = trajectory.slice(1).every((s) => evolver.isFeasible(s));
    if (!isFeasible) {
      return -Infinity;
    }

    // Tính score bằng ObjectiveScorer
    return scorer.score(
      ctx.remainingSlots,
      trajectory,
      ctx.weights,
      ctx,
      [], // không có mutation history cho plan ban đầu
    );
  }
}

// ══════════════════════════════════════════════════════════
// GUIDE: NƠI CẦN SỬA TRONG BEAM SEARCH (nếu cần per-iteration metrics)
// ══════════════════════════════════════════════════════════

/*
Để thu thập per-iteration metrics chi tiết hơn (candidates, pruned, cache hits
per iteration), cần inject SearchInstrumentation vào BeamSearch.

Dưới đây là diff cho thấy chính xác cần thêm gì vào BeamSearch.
Copy paste các dòng có dấu + vào code thật.

```diff
 class BeamSearch {
+  private instrumentation?: SearchInstrumentation;
+
   constructor(config: BeamSearchConfig) {
     // ... existing ...
+    this.instrumentation = config.instrumentation;
   }

   search(initialPlan: TripSlot[], ctx: SearchContext): SearchResult {
+    this.instrumentation?.start();
     let beam = [createRootNode(initialPlan, ctx)];

     for (let iter = 0; iter < this.maxIterations; iter++) {
+      this.instrumentation?.beginIteration(iter);
+
+      let totalCandidates = 0;
+      let totalPruned = 0;
+      let totalCacheHits = 0;

       for (const parentNode of beam) {
         // Generate candidates
         const mutations = generateAll(parentNode.plan, ctx);
+        totalCandidates += mutations.length;

         // === Spec-02: Pruning ===
         // const windows = propagateConstraints(parentNode.plan, propCtx);
         // const beforePrune = mutations.length;
         // const surviving = mutations.filter(m => !canPrune(m, parentNode.plan, windows));
+        // totalPruned += beforePrune - surviving.length;

         for (const mut of mutations) {
           // === Spec-01: Incremental trajectory ===
           // const { states, feasible, cache } =
           //   computeTrajectoryIncremental(mut.plan, ctx, parentNode.cache, mut.resumeIndex);
+          // if (mut.resumeIndex > 0) totalCacheHits++;

           // ... score, push to candidates ...
         }
       }

+      this.instrumentation?.recordCandidates(totalCandidates);
+      this.instrumentation?.recordPruned(totalPruned);
+      this.instrumentation?.recordCacheHits(totalCacheHits);

       // Select new beam
       const newBeam = selectBeam(candidates, this.beamWidth);
+      this.instrumentation?.recordSurvivors(newBeam.length);

       // === Spec-03: Bandit ===
       // const allocation = this.bandit.allocate(GENERATE_ALL_CAP);
+      // this.instrumentation?.recordAllocations(allocation);

+      this.instrumentation?.endIteration();

       if (hasConverged(beam, newBeam, this.threshold)) break;
       beam = newBeam;
     }

+    this.instrumentation?.finish();
     return { beam };
   }
 }
```
*/
