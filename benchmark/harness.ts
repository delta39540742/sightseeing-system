/**
 * Benchmark Harness — Chạy scenarios × configs, thu thập metrics, xuất report.
 *
 * Usage:
 *   import { runBenchmark } from './harness';
 *   import { MyReplanEngine } from '../src/engine';
 *
 *   const engine = new MyReplanEngine();
 *   const report = runBenchmark(engine, {
 *     runsPerScenario: 5,
 *     configs: [BASELINE_CONFIG, SPEC01_CONFIG, ...],
 *     verbose: true,
 *     exportCsv: true,
 *     csvPath: './benchmark-results.csv',
 *     latencyBudgetMs: 4500,
 *   });
 */

import {
  BenchmarkConfig,
  BenchmarkScenario,
  EngineConfig,
  EngineOutput,
  ReplanEngine,
  RunResult,
  AggregatedResult,
  ComparisonResult,
} from './types';
import { ALL_SCENARIOS } from './scenarios';
import {
  measureRun,
  aggregateRuns,
  compareConfigs,
  analyzePlanQuality,
  PlanQualityReport,
} from './metrics';

// ─────────────────────────────────────────────────────────
// PREDEFINED CONFIGS
// ─────────────────────────────────────────────────────────

export const BASELINE_CONFIG: EngineConfig = {
  label: 'baseline',
  incrementalTrajectory: false,
  constraintPropagation: false,
  adaptiveOperators: false,
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
};

export const SPEC01_CONFIG: EngineConfig = {
  label: 'spec01-incremental',
  incrementalTrajectory: true,
  constraintPropagation: false,
  adaptiveOperators: false,
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
};

export const SPEC02_CONFIG: EngineConfig = {
  label: 'spec02-pruning',
  incrementalTrajectory: false,
  constraintPropagation: true,
  adaptiveOperators: false,
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
};

export const SPEC03_CONFIG: EngineConfig = {
  label: 'spec03-bandit',
  incrementalTrajectory: false,
  constraintPropagation: false,
  adaptiveOperators: true,
  banditExploration: Math.SQRT2,
  banditMinAllocation: 1,
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
};

export const COMBINED_CONFIG: EngineConfig = {
  label: 'combined-all',
  incrementalTrajectory: true,
  constraintPropagation: true,
  adaptiveOperators: true,
  banditExploration: Math.SQRT2,
  banditMinAllocation: 1,
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.01,
};

export const ALL_CONFIGS: EngineConfig[] = [
  BASELINE_CONFIG,
  SPEC01_CONFIG,
  SPEC02_CONFIG,
  SPEC03_CONFIG,
  COMBINED_CONFIG,
];

// ─────────────────────────────────────────────────────────
// BENCHMARK REPORT
// ─────────────────────────────────────────────────────────

export interface BenchmarkReport {
  timestamp: string;
  totalDurationMs: number;

  /** Tất cả runs, grouped by scenario × config */
  aggregated: AggregatedResult[];

  /** So sánh từng config với baseline, per scenario */
  comparisons: ComparisonResult[];

  /** Chi tiết chất lượng plan */
  qualityReports: PlanQualityReport[];

  /** Summary table dạng text */
  summaryText: string;

  /** Pass/Fail tổng hợp */
  overallPassed: boolean;
  failedScenarios: Array<{
    scenarioId: string;
    configLabel: string;
    reasons: string[];
  }>;
}

// ─────────────────────────────────────────────────────────
// MAIN HARNESS
// ─────────────────────────────────────────────────────────

export function runBenchmark(
  engine: ReplanEngine,
  config: BenchmarkConfig,
): BenchmarkReport {
  const startTime = Date.now();

  const scenarios = config.scenarioFilter
    ? ALL_SCENARIOS.filter(s => config.scenarioFilter!.includes(s.id))
    : ALL_SCENARIOS;

  const allRuns: RunResult[] = [];
  const allQuality: PlanQualityReport[] = [];
  const aggregatedResults: AggregatedResult[] = [];

  // ── Run matrix: scenario × config × repetitions ──
  for (const scenario of scenarios) {
    if (config.verbose) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`  Scenario: ${scenario.id} — ${scenario.name}`);
      console.log(`  Difficulty: ${scenario.difficulty} | Slots: ${scenario.initialPlan.length}`);
      console.log(`${'═'.repeat(60)}`);
    }

    // Compute initial score ONCE per scenario (same plan → same score)
    const initialScore = computeInitialScore(engine, scenario);
    if (config.verbose) {
      console.log(`  Initial plan score: ${initialScore.toFixed(4)}`);
    }

    for (const engineConfig of config.configs) {
      if (config.verbose) {
        console.log(`\n  Config: ${engineConfig.label}`);
        console.log(`  ${'─'.repeat(50)}`);
      }

      engine.configure(engineConfig);

      const runs: RunResult[] = [];

      for (let r = 0; r < config.runsPerScenario; r++) {
        // GC hint trước mỗi run (giảm variance)
        if (typeof globalThis.gc === 'function') globalThis.gc();

        const output = engine.run(scenario);
        const run = measureRun(scenario, engineConfig, output, initialScore);
        runs.push(run);

        if (config.verbose) {
          const status = run.isFeasible ? '✓' : '✗';
          const timeout = run.timeoutOccurred ? ' ⚠TIMEOUT' : '';
          console.log(
            `    Run ${r + 1}/${config.runsPerScenario}: ` +
            `${status} score=${run.finalBestScore.toFixed(3)} ` +
            `(Δ${run.scoreImprovement >= 0 ? '+' : ''}${run.scoreImprovement.toFixed(3)}) ` +
            `latency=${run.totalLatencyMs.toFixed(0)}ms ` +
            `iters=${run.iterationCount}${timeout}`
          );
        }

        // Quality report cho run tốt nhất (hoặc cuối)
        if (r === config.runsPerScenario - 1) {
          const quality = analyzePlanQuality(scenario, engineConfig, run);
          allQuality.push(quality);
        }
      }

      allRuns.push(...runs);

      const agg = aggregateRuns(runs);
      aggregatedResults.push(agg);

      if (config.verbose) {
        console.log(
          `    ── Aggregate: ` +
          `score=${agg.score.mean.toFixed(3)}±${agg.score.stddev.toFixed(3)} ` +
          `latency=${agg.latency.mean.toFixed(0)}±${agg.latency.stddev.toFixed(0)}ms ` +
          `feasibility=${(agg.feasibilityRate * 100).toFixed(0)}% ` +
          `violations=${(agg.violationRate * 100).toFixed(0)}%`
        );
      }
    }
  }

  // ── Comparisons: every non-baseline config vs baseline ──
  const comparisons: ComparisonResult[] = [];
  for (const scenario of scenarios) {
    const baselineAgg = aggregatedResults.find(
      a => a.scenarioId === scenario.id && a.configLabel === 'baseline'
    );
    if (!baselineAgg) continue;

    for (const engineConfig of config.configs) {
      if (engineConfig.label === 'baseline') continue;

      const testAgg = aggregatedResults.find(
        a => a.scenarioId === scenario.id && a.configLabel === engineConfig.label
      );
      if (!testAgg) continue;

      const comparison = compareConfigs(baselineAgg, testAgg, scenario);
      comparisons.push(comparison);
    }
  }

  // ── Summary ──
  const summaryText = buildSummaryText(scenarios, config.configs, aggregatedResults, comparisons);
  const failedScenarios = comparisons
    .filter(c => !c.passed)
    .map(c => ({
      scenarioId: c.scenarioId,
      configLabel: c.testConfig,
      reasons: c.failReasons,
    }));

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    aggregated: aggregatedResults,
    comparisons,
    qualityReports: allQuality,
    summaryText,
    overallPassed: failedScenarios.length === 0,
    failedScenarios,
  };

  // ── Print summary ──
  console.log('\n' + summaryText);

  // ── Export CSV ──
  if (config.exportCsv) {
    const csv = buildCsv(aggregatedResults, comparisons);
    if (config.csvPath) {
      // Caller handles file write; we just return the data
      (report as any).csvContent = csv;
    }
    if (config.verbose) {
      console.log(`\nCSV report generated (${csv.split('\n').length} rows)`);
    }
  }

  return report;
}

// ─────────────────────────────────────────────────────────
// INITIAL SCORE — Score plan gốc KHÔNG qua beam search
// ─────────────────────────────────────────────────────────

function computeInitialScore(engine: ReplanEngine, scenario: BenchmarkScenario): number {
  // Ưu tiên: dùng scoreInitialPlan nếu engine hỗ trợ (adapter mới)
  if ('scoreInitialPlan' in engine && typeof (engine as any).scoreInitialPlan === 'function') {
    const score = (engine as any).scoreInitialPlan(scenario);
    if (typeof score === 'number' && isFinite(score)) {
      return score;
    }
  }

  // Fallback: chạy engine với 0 iterations
  // Lưu config hiện tại để restore sau
  const savedLabel = '_initial_score_probe';

  const zeroConfig: EngineConfig = {
    label: savedLabel,
    incrementalTrajectory: false,
    constraintPropagation: false,
    adaptiveOperators: false,
    beamWidth: 1,
    maxIterations: 0,
    improvementThreshold: 1.0,
  };

  engine.configure(zeroConfig);
  const output = engine.run(scenario);

  // NOTE: caller phải gọi engine.configure(actualConfig) sau đó
  // (harness loop đã làm điều này)
  return output.bestNode.score;
}

// ─────────────────────────────────────────────────────────
// SUMMARY TEXT BUILDER
// ─────────────────────────────────────────────────────────

function buildSummaryText(
  scenarios: BenchmarkScenario[],
  configs: EngineConfig[],
  aggregated: AggregatedResult[],
  comparisons: ComparisonResult[],
): string {
  const lines: string[] = [];
  const W = 80;

  lines.push('╔' + '═'.repeat(W - 2) + '╗');
  lines.push('║' + center('BENCHMARK REPORT', W - 2) + '║');
  lines.push('╠' + '═'.repeat(W - 2) + '╣');
  lines.push('');

  // ── Per-scenario summary table ──
  for (const scenario of scenarios) {
    lines.push(`┌─ ${scenario.id}: ${scenario.name}`);
    lines.push(`│  ${scenario.category} | ${scenario.difficulty} | ${scenario.initialPlan.length} slots`);
    lines.push('│');

    // Header
    lines.push(
      '│  ' +
      pad('Config', 22) +
      pad('Score', 14) +
      pad('Latency(ms)', 14) +
      pad('Feas%', 8) +
      pad('Δ Score%', 10)
    );
    lines.push('│  ' + '─'.repeat(68));

    for (const cfg of configs) {
      const agg = aggregated.find(
        a => a.scenarioId === scenario.id && a.configLabel === cfg.label
      );
      if (!agg) continue;

      const comp = comparisons.find(
        c => c.scenarioId === scenario.id && c.testConfig === cfg.label
      );

      const deltaStr = comp
        ? `${comp.scoreGainPct >= 0 ? '+' : ''}${comp.scoreGainPct.toFixed(1)}%`
        : '—';

      lines.push(
        '│  ' +
        pad(cfg.label, 22) +
        pad(`${agg.score.mean.toFixed(3)}±${agg.score.stddev.toFixed(2)}`, 14) +
        pad(`${agg.latency.mean.toFixed(0)}±${agg.latency.stddev.toFixed(0)}`, 14) +
        pad(`${(agg.feasibilityRate * 100).toFixed(0)}%`, 8) +
        pad(deltaStr, 10)
      );
    }

    // Comparison verdicts
    const scenarioComps = comparisons.filter(c => c.scenarioId === scenario.id);
    if (scenarioComps.length > 0) {
      lines.push('│');
      for (const comp of scenarioComps) {
        const icon = comp.passed ? '  ✅' : '  ❌';
        lines.push(`│ ${icon} ${comp.testConfig} vs ${comp.baselineConfig}`);
        if (!comp.passed) {
          for (const reason of comp.failReasons) {
            lines.push(`│       └─ ${reason}`);
          }
        }
      }
    }

    lines.push('└' + '─'.repeat(W - 2));
    lines.push('');
  }

  // ── Overall verdict ──
  lines.push('╠' + '═'.repeat(W - 2) + '╣');
  const totalComps = comparisons.length;
  const passedComps = comparisons.filter(c => c.passed).length;
  const overallIcon = passedComps === totalComps ? '✅' : '❌';

  lines.push(`║ ${overallIcon} Overall: ${passedComps}/${totalComps} comparisons passed`);

  // Aggregate performance gains per config
  for (const cfg of configs) {
    if (cfg.label === 'baseline') continue;
    const cfgComps = comparisons.filter(c => c.testConfig === cfg.label);
    if (cfgComps.length === 0) continue;

    const avgLatencyReduction = mean(cfgComps.map(c => c.latencyReduction));
    const avgScoreGainPct = mean(cfgComps.map(c => c.scoreGainPct));
    const passRate = cfgComps.filter(c => c.passed).length / cfgComps.length;

    lines.push(
      `║   ${cfg.label}: ` +
      `latency ${avgLatencyReduction >= 0 ? '-' : '+'}${Math.abs(avgLatencyReduction).toFixed(1)}% | ` +
      `score ${avgScoreGainPct >= 0 ? '+' : ''}${avgScoreGainPct.toFixed(1)}% | ` +
      `pass ${(passRate * 100).toFixed(0)}%`
    );
  }

  lines.push('╚' + '═'.repeat(W - 2) + '╝');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────

function buildCsv(
  aggregated: AggregatedResult[],
  comparisons: ComparisonResult[],
): string {
  const headers = [
    'scenario_id',
    'config',
    'runs',
    'score_mean',
    'score_stddev',
    'score_min',
    'score_max',
    'latency_mean_ms',
    'latency_p95_ms',
    'feasibility_pct',
    'violation_pct',
    'timeout_pct',
    'iterations_mean',
    'survival_rate',
    'prune_rate',
    'cache_hit_rate',
    'improvement_mean',
    'improvement_pct',
    'vs_baseline_score_pct',
    'vs_baseline_latency_pct',
    'vs_baseline_passed',
  ];

  const rows: string[] = [headers.join(',')];

  for (const agg of aggregated) {
    const comp = comparisons.find(
      c => c.scenarioId === agg.scenarioId && c.testConfig === agg.configLabel
    );

    rows.push([
      agg.scenarioId,
      agg.configLabel,
      agg.runCount,
      agg.score.mean.toFixed(4),
      agg.score.stddev.toFixed(4),
      agg.score.min.toFixed(4),
      agg.score.max.toFixed(4),
      agg.latency.mean.toFixed(1),
      agg.latency.p95.toFixed(1),
      (agg.feasibilityRate * 100).toFixed(1),
      (agg.violationRate * 100).toFixed(1),
      (agg.timeoutRate * 100).toFixed(1),
      agg.iterationCount.mean.toFixed(1),
      agg.survivalRate.mean.toFixed(3),
      agg.pruneRate.mean.toFixed(3),
      agg.cacheHitRate.mean.toFixed(3),
      agg.scoreImprovement.mean.toFixed(4),
      agg.scoreImprovement.mean.toFixed(2),
      comp ? comp.scoreGainPct.toFixed(2) : '',
      comp ? comp.latencyReduction.toFixed(2) : '',
      comp ? (comp.passed ? '1' : '0') : '',
    ].join(','));
  }

  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function center(s: string, width: number): string {
  const left = Math.floor((width - s.length) / 2);
  const right = width - s.length - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}