/**
 * Benchmark Suite — Public API
 *
 * import { runFull, runQuick, ALL_SCENARIOS, ... } from './benchmark';
 */

// Types
export type {
  BenchmarkScenario,
  BenchmarkConfig,
  EngineConfig,
  EngineOutput,
  ReplanEngine,
  RunResult,
  AggregatedResult,
  ComparisonResult,
  StatSummary,
  TripSlot,
  TripState,
  PlaceCandidate,
  WeatherForecast,
  UserPreferences,
  ScenarioCategory,
  ScenarioExpectations,
} from './types';

// Scenarios
export { ALL_SCENARIOS, getScenario, getScenariosByCategory } from './scenarios';

// Metrics
export {
  measureRun,
  aggregateRuns,
  compareConfigs,
  analyzePlanQuality,
} from './metrics';
export type { PlanQualityReport } from './metrics';

// Validators
export {
  validateOutput,
  validateSpec01,
  validateSpec02,
  validateSpec03,
  printValidationReport,
} from './validators';
export type { Violation, ValidationReport, ViolationCategory } from './validators';

// Harness
export {
  runBenchmark,
  BASELINE_CONFIG,
  SPEC01_CONFIG,
  SPEC02_CONFIG,
  SPEC03_CONFIG,
  COMBINED_CONFIG,
  ALL_CONFIGS,
} from './harness';
export type { BenchmarkReport } from './harness';

// Engine Adapter
export { EngineAdapter, SearchInstrumentation } from './engine-adapter';

// Entry points
export { runFull, runQuick, runValidationOnly, runSingle } from './main';