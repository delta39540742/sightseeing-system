/**
 * Benchmark Types — Shared interfaces cho toàn bộ benchmark suite.
 *
 * File này define các types cần thiết để chạy benchmark mà KHÔNG phụ thuộc
 * vào implementation cụ thể. Import actual types từ codebase khi integrate.
 */

// ─────────────────────────────────────────────────────────
// RE-EXPORT TỪ CODEBASE (thay path khi integrate)
// ─────────────────────────────────────────────────────────

// TODO: Khi integrate, thay bằng:
// export type { TripSlot, TripState, BeamNode, ... } from '../src/types';

export interface TripSlot {
  slotId: string;
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  placeId: number;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  estimatedCost: number;
  activityType: 'sightseeing' | 'meal' | 'rest' | 'activity';
  status: 'planned' | 'completed' | 'skipped' | 'replaced';
  isLocked?: boolean;
  version: number;
  rationale: string | null;
}

export interface TripState {
  timeRemainingMin: number;
  budgetRemaining: number;
  fatigue: number;
  moodProxy: number;
  currentLat: number;
  currentLng: number;
  dayIndex: number;
  slotOrder: number;
  capturedAt: string;
}

export interface PlaceCandidate {
  placeId: number;
  name: string;
  lat: number;
  lng: number;
  tags: number[];          // tag vector (sparse or dense)
  avgVisitDurationMin: number;
  estimatedCost: number;
  activityType: 'sightseeing' | 'meal' | 'rest' | 'activity';
  openingHour: number;     // 0-23
  closingHour: number;     // 0-23
}

export interface WeatherForecast {
  dayIndex: number;
  precipMmPerHour: number;
  tempCelsius: number;
  condition: 'clear' | 'cloudy' | 'rain' | 'storm';
}

export interface UserPreferences {
  preferenceVector: number[];
  preferredPace: number;        // target slots per day
  budgetTotal: number;
  fatigueThreshold: number;     // default 0.95
}

// ─────────────────────────────────────────────────────────
// BENCHMARK-SPECIFIC TYPES
// ─────────────────────────────────────────────────────────

/** Cấu hình một scenario benchmark */
export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';

  /** Plan đầu vào (remaining slots) */
  initialPlan: TripSlot[];

  /** Pool các địa điểm thay thế */
  candidatePool: PlaceCandidate[];

  /** Dự báo thời tiết theo ngày */
  weatherForecast: WeatherForecast[];

  /** Preferences của user */
  userPreferences: UserPreferences;

  /** Trạng thái ban đầu */
  initialState: TripState;

  /** Thời điểm replan */
  capturedAt: string;

  /** Kỳ vọng — dùng để validate kết quả */
  expectations: ScenarioExpectations;
}

export type ScenarioCategory =
  | 'baseline'          // plan đơn giản, đã gần optimal
  | 'disruption'        // slot bị delay/skip, cần replan
  | 'tight_schedule'    // sát night constraint
  | 'budget_pressure'   // budget thấp
  | 'fatigue_heavy'     // nhiều hoạt động nặng liên tiếp
  | 'multi_day'         // chuyến đi nhiều ngày
  | 'large_pool'        // pool lớn, nhiều alternative
  | 'locked_slots'      // có slots bị khóa
  | 'worst_case';       // scenario tệ nhất cho latency

export interface ScenarioExpectations {
  /** Score tối thiểu chấp nhận được (nếu biết) */
  minAcceptableScore?: number;

  /** Plan phải feasible? (default true) */
  mustBeFeasible: boolean;

  /** Latency tối đa cho phép (ms) */
  maxLatencyMs: number;

  /** Số slot tối thiểu trong plan kết quả */
  minSlotsInResult?: number;

  /** Các placeId KHÔNG được xuất hiện trong kết quả */
  forbiddenPlaceIds?: number[];

  /** Slot bị locked PHẢI giữ nguyên vị trí */
  lockedSlotsPreserved: boolean;

  /** Nếu có "known optimal" (cho plan nhỏ, brute-force được) */
  knownOptimalScore?: number;

  /** Score phải cải thiện so với initial plan */
  mustImproveOverInitial: boolean;
}

// ─────────────────────────────────────────────────────────
// MEASUREMENT TYPES
// ─────────────────────────────────────────────────────────

/** Kết quả đo lường một lần chạy */
export interface RunResult {
  scenarioId: string;
  configLabel: string;      // 'baseline' | 'spec01' | 'spec02' | 'spec03' | 'combined'

  // — Timing —
  totalLatencyMs: number;
  iterationLatencies: number[];    // ms per iteration
  iterationCount: number;
  timeoutOccurred: boolean;

  // — Quality —
  initialScore: number;
  finalBestScore: number;
  scoreImprovement: number;        // finalBest - initial
  scoreImprovementPct: number;     // (finalBest - initial) / |initial| × 100
  isFeasible: boolean;

  // — Plan metrics —
  finalPlanLength: number;
  finalSlotsPerDay: Map<number, number>;  // dayIndex → count
  placeDiversity: number;          // unique placeIds / total slots

  // — Search efficiency —
  totalCandidatesGenerated: number;
  totalCandidatesSurvived: number; // entered beam at any iteration
  survivalRate: number;            // survived / generated
  totalCandidatesPruned: number;   // spec-02 pruning
  pruneRate: number;               // pruned / generated
  cacheHitRate: number;            // spec-01 incremental reuse rate

  // — Beam diversity —
  uniquePlansInFinalBeam: number;
  beamScoreSpread: number;         // max - min score trong beam cuối

  // — Per-operator stats (spec-03) —
  operatorAllocations: Map<string, number>;     // cuối cùng
  operatorSurvivalRates: Map<string, number>;   // per operator

  // — Constraint violations (nếu có) —
  nightConstraintViolations: number;
  budgetViolations: number;
  fatigueViolations: number;
  lockedSlotViolations: number;

  // — Final plan —
  finalPlan: TripSlot[];
  finalStates: TripState[];
}

/** Kết quả tổng hợp qua nhiều runs (cùng scenario, cùng config) */
export interface AggregatedResult {
  scenarioId: string;
  configLabel: string;
  runCount: number;

  latency: StatSummary;
  score: StatSummary;
  scoreImprovement: StatSummary;
  survivalRate: StatSummary;
  pruneRate: StatSummary;
  cacheHitRate: StatSummary;
  iterationCount: StatSummary;

  feasibilityRate: number;         // % runs feasible
  timeoutRate: number;             // % runs timed out
  violationRate: number;           // % runs with any constraint violation

  allRuns: RunResult[];
}

export interface StatSummary {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  p5: number;
  p95: number;
}

/** Kết quả so sánh 2 configs */
export interface ComparisonResult {
  scenarioId: string;
  baselineConfig: string;
  testConfig: string;

  // — Statistical comparison —
  latencyReduction: number;        // % giảm latency
  scoreGain: number;               // absolute score difference
  scoreGainPct: number;            // % improvement

  // — Efficiency gains —
  candidateSavings: number;        // % ít candidates hơn
  iterationSavings: number;        // ít iterations hơn để converge

  // — Pass/Fail —
  passed: boolean;
  failReasons: string[];
}

// ─────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────

export interface BenchmarkConfig {
  /** Số lần chạy mỗi scenario (for statistical significance) */
  runsPerScenario: number;        // default 5

  /** Configs để so sánh */
  configs: EngineConfig[];

  /** Scenarios để chạy (null = tất cả) */
  scenarioFilter?: string[];

  /** In progress log */
  verbose: boolean;

  /** Export CSV report */
  exportCsv: boolean;
  csvPath?: string;

  /** Latency budget (ms) — global override */
  latencyBudgetMs: number;        // default 4500
}

export interface EngineConfig {
  label: string;

  // Spec-01
  incrementalTrajectory: boolean;

  // Spec-02
  constraintPropagation: boolean;

  // Spec-03
  adaptiveOperators: boolean;
  banditExploration?: number;
  banditMinAllocation?: number;

  // Core beam search params
  beamWidth: number;              // default 6
  maxIterations: number;          // default 20
  improvementThreshold: number;   // default 0.01
}

// ─────────────────────────────────────────────────────────
// HARNESS HOOKS — Interface cho actual engine
// ─────────────────────────────────────────────────────────

/**
 * Adapter pattern: benchmark không biết implementation detail.
 * Implement interface này để plug engine vào benchmark.
 */
export interface ReplanEngine {
  configure(config: EngineConfig): void;

  run(scenario: BenchmarkScenario): EngineOutput;
}

export interface EngineOutput {
  bestNode: {
    plan: TripSlot[];
    score: number;
    mutationHistory: Array<{
      operator: string;
      affectedSlotIds: string[];
    }>;
  };
  beam: Array<{
    plan: TripSlot[];
    score: number;
  }>;
  states: TripState[];
  feasible: boolean;

  // Instrumentation (engine phải expose)
  timing: {
    totalMs: number;
    perIterationMs: number[];
  };
  search: {
    iterations: number;
    candidatesPerIteration: number[];
    survivorsPerIteration: number[];
    prunedPerIteration: number[];          // spec-02
    cacheHitsPerIteration: number[];       // spec-01
    operatorAllocations: Map<string, number>[]; // spec-03, per iteration
  };
}
