/**
 * Benchmark Entry Point — Chạy toàn bộ benchmark suite.
 *
 * ┌──────────────────────────────────────────────────┐
 * │  CÁCH INTEGRATE VÀO CODEBASE                    │
 * ├──────────────────────────────────────────────────┤
 * │                                                  │
 * │  1. Copy thư mục benchmark/ vào project          │
 * │                                                  │
 * │  2. Implement ReplanEngine adapter:              │
 * │     - Wrap engine thật vào interface             │
 * │     - Expose instrumentation data                │
 * │                                                  │
 * │  3. Chạy:                                        │
 * │     npx ts-node benchmark/main.ts                │
 * │     hoặc                                         │
 * │     npx vitest benchmark/main.test.ts            │
 * │                                                  │
 * │  4. Đọc report trong console + CSV               │
 * └──────────────────────────────────────────────────┘
 */

import {
  BenchmarkConfig,
  ReplanEngine,
  EngineConfig,
  EngineOutput,
  BenchmarkScenario,
} from './types';

import {
  runBenchmark,
  BenchmarkReport,
  ALL_CONFIGS,
  BASELINE_CONFIG,
  SPEC01_CONFIG,
  SPEC02_CONFIG,
  SPEC03_CONFIG,
  COMBINED_CONFIG,
} from './harness';

import { ALL_SCENARIOS } from './scenarios';

import {
  validateOutput,
  validateSpec01,
  validateSpec02,
  validateSpec03,
  printValidationReport,
  ValidationReport,
} from './validators';

import { EngineAdapter } from './engine-adapter';

// ─────────────────────────────────────────────────────────
// RUN MODES
// ─────────────────────────────────────────────────────────

/** Chạy đầy đủ: tất cả scenarios × tất cả configs × 5 runs */
export function runFull(engine: ReplanEngine): BenchmarkReport {
  return runBenchmark(engine, {
    runsPerScenario: 5,
    configs: ALL_CONFIGS,
    verbose: true,
    exportCsv: true,
    csvPath: './benchmark-results.csv',
    latencyBudgetMs: 4500,
  });
}

/** Chạy nhanh: chỉ baseline + combined, 2 runs, scenarios dễ + khó */
export function runQuick(engine: ReplanEngine): BenchmarkReport {
  return runBenchmark(engine, {
    runsPerScenario: 2,
    configs: [BASELINE_CONFIG, COMBINED_CONFIG],
    scenarioFilter: ['S01', 'S02', 'S06', 'S09'],
    verbose: true,
    exportCsv: false,
    latencyBudgetMs: 4500,
  });
}

/** Chạy chỉ validation: 1 run mỗi scenario, kiểm tra correctness */
export function runValidationOnly(engine: ReplanEngine): ValidationReport[] {
  const reports: ValidationReport[] = [];

  for (const scenario of ALL_SCENARIOS) {
    for (const config of ALL_CONFIGS) {
      engine.configure(config);
      const output = engine.run(scenario);
      const report = validateOutput(scenario, config.label, output);
      reports.push(report);
      printValidationReport(report);
    }
  }

  const criticalCount = reports.filter(r => !r.passed).length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Validation complete: ${reports.length - criticalCount}/${reports.length} passed`);

  return reports;
}

/** Chạy single scenario (debug mode) */
export function runSingle(
  engine: ReplanEngine,
  scenarioId: string,
  config: EngineConfig = BASELINE_CONFIG,
): { output: EngineOutput; validation: ValidationReport } {
  const scenario = ALL_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario) throw new Error(`Scenario "${scenarioId}" not found`);

  engine.configure(config);
  const output = engine.run(scenario);
  const validation = validateOutput(scenario, config.label, output);

  printValidationReport(validation);

  console.log('\n── Plan Output ──');
  for (const s of output.bestNode.plan) {
    console.log(
      `  [${s.dayIndex}:${s.slotOrder}] ` +
      `placeId=${s.placeId} ` +
      `${new Date(s.plannedStart).toISOString().slice(11, 16)}–` +
      `${new Date(s.plannedEnd).toISOString().slice(11, 16)} ` +
      `${s.activityType} ` +
      `${s.isLocked ? '🔒' : ''}`
    );
  }
  console.log(`  Score: ${output.bestNode.score.toFixed(4)}`);
  console.log(`  Feasible: ${output.feasible}`);
  console.log(`  Latency: ${output.timing.totalMs.toFixed(0)}ms`);

  return { output, validation };
}

// ─────────────────────────────────────────────────────────
// CLI ENTRY POINT
// ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] ?? 'quick';

  // EngineAdapter: hiện tại chạy stub deterministic bên trong.
  // Khi uncomment code thật trong engine-adapter.ts, tự động chuyển sang engine thật.
  const engine: ReplanEngine = new EngineAdapter();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Replan Engine Benchmark Suite`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Scenarios: ${ALL_SCENARIOS.length}`);
  console.log(`  Configs: ${ALL_CONFIGS.length}`);
  console.log(`${'═'.repeat(60)}`);

  switch (mode) {
    case 'full':
      runFull(engine);
      break;
    case 'quick':
      runQuick(engine);
      break;
    case 'validate':
      runValidationOnly(engine);
      break;
    case 'single': {
      const scenarioId = args[1] ?? 'S01';
      const configLabel = args[2] ?? 'baseline';
      const config = ALL_CONFIGS.find(c => c.label === configLabel) ?? BASELINE_CONFIG;
      runSingle(engine, scenarioId, config);
      break;
    }
    default:
      console.log('Usage: ts-node main.ts [full|quick|validate|single <scenarioId> <configLabel>]');
  }
}

// Run if executed directly
main().catch(console.error);

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────

export {
  ALL_SCENARIOS,
  ALL_CONFIGS,
  BASELINE_CONFIG,
  SPEC01_CONFIG,
  SPEC02_CONFIG,
  SPEC03_CONFIG,
  COMBINED_CONFIG,
};