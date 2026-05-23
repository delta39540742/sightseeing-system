# Replan Engine Benchmark Suite

## Kiến trúc

```
benchmark/
├── types.ts         Shared types: scenarios, metrics, engine interface
├── scenarios.ts     10 test scenarios mô phỏng Đà Nẵng
├── metrics.ts       Runtime + utility measurement, aggregation, comparison
├── validators.ts    Correctness invariant checkers (bao gồm spec-specific)
├── harness.ts       Main runner: scenario × config matrix + CSV export
└── main.ts          Entry point + CLI + engine adapter placeholder
```

## Hai trục đo

### 1. Thời gian chạy (Runtime)

| Metric               | Mô tả                                         | Pass/Fail                |
|----------------------|------------------------------------------------|--------------------------|
| `totalLatencyMs`     | Tổng thời gian từ lúc gọi đến khi trả kết quả | ≤ 4500ms (P95)          |
| `iterationLatencies` | Thời gian mỗi iteration                        | Report only              |
| `iterationCount`     | Số iterations trước khi converge                | Report only              |
| `timeoutOccurred`    | Có vượt latency budget không                    | Phải = false             |
| `survivalRate`       | % candidates sống sót vào beam                  | ↑ tốt hơn                |
| `pruneRate`          | % candidates bị prune (Spec-02)                 | Report only              |
| `cacheHitRate`       | % trajectory reused (Spec-01)                   | Report only              |

### 2. Độ hữu ích (Utility)

| Metric                  | Mô tả                                        | Pass/Fail                      |
|------------------------|-----------------------------------------------|--------------------------------|
| `finalBestScore`       | Score của plan tốt nhất                        | ≥ baseline                     |
| `scoreImprovement`     | Cải thiện so với plan ban đầu                  | > 0 (khi scenario yêu cầu)   |
| `isFeasible`           | Plan thỏa mọi constraint cứng                 | Phải = true                    |
| `placeDiversity`       | Tỉ lệ unique places                           | Report only                    |
| `paceFitScore`         | |avgSlotsPerDay - preferredPace|               | ↓ tốt hơn                     |
| `constraintViolations` | Night/budget/fatigue/locked violations          | Phải = 0                       |
| `forbiddenPlacePresent`| Place bị cấm xuất hiện trong plan              | Phải = false                   |

## 10 Scenarios

| ID  | Category        | Difficulty | Slots | Mô tả                                    |
|-----|-----------------|------------|-------|-------------------------------------------|
| S01 | baseline        | easy       | 4     | Plan đã gần optimal                       |
| S02 | disruption      | medium     | 5     | Slot đầu hoàn thành trễ 15'               |
| S03 | tight_schedule  | hard       | 4     | Slots sát night constraint 22:30           |
| S04 | budget_pressure | hard       | 5     | Chỉ còn 200k cho 5 slots                  |
| S05 | fatigue_heavy   | hard       | 6     | Fatigue 0.70, 6 hoạt động nặng            |
| S06 | multi_day       | medium     | 12    | 3 ngày, weather mixed                     |
| S07 | large_pool      | medium     | 6     | Pool 50+ candidates                       |
| S08 | locked_slots    | medium     | 6     | 2 slots locked                             |
| S09 | worst_case      | extreme    | 25    | 5 ngày, 25 slots, pool 60+ (stress test) |
| S10 | disruption      | medium     | 5     | Mưa to, outdoor → indoor swap             |

## 5 Configs

| Label             | Spec-01 | Spec-02 | Spec-03 | Mô tả                      |
|-------------------|---------|---------|---------|------------------------------|
| baseline          | ✗       | ✗       | ✗       | Engine gốc, không optimization |
| spec01-incremental| ✓       | ✗       | ✗       | Chỉ incremental trajectory    |
| spec02-pruning    | ✗       | ✓       | ✗       | Chỉ constraint propagation    |
| spec03-bandit     | ✗       | ✗       | ✓       | Chỉ adaptive operators        |
| combined-all      | ✓       | ✓       | ✓       | Tất cả optimizations          |

## Chạy

```bash
# Quick (4 scenarios × 2 configs × 2 runs)
npx ts-node benchmark/main.ts quick

# Full (10 scenarios × 5 configs × 5 runs = 250 runs)
npx ts-node benchmark/main.ts full

# Validation only (correctness, không đo performance)
npx ts-node benchmark/main.ts validate

# Single scenario debug
npx ts-node benchmark/main.ts single S04 combined-all
```

## Integrate engine thật

1. Implement `ReplanEngine` interface trong `main.ts`
2. Engine phải expose instrumentation data (timing, candidate counts, etc.)
3. Uncomment code thật trong `engine-adapter.ts` (thay stub bên trong)
4. Feature flags trong `EngineConfig` (`incrementalTrajectory`, `constraintPropagation`, `adaptiveOperators`) phải toggle từng optimization

## Tiêu chí Pass/Fail

Mỗi config được so sánh với `baseline`. Comparison PASS khi:

1. **P95 latency ≤ budget** (4500ms)
2. **Latency không tăng quá 10%** so với baseline
3. **Score không giảm** (tolerance 1%)
4. **Feasibility ≥ baseline** (tolerance 5%)
5. **Zero constraint violations**
6. **Score cải thiện** (khi scenario yêu cầu `mustImproveOverInitial`)

## Validators (correctness)

Validators kiểm tra INVARIANTS — bất kỳ violation nào = BUG:

- Structural: no duplicate slotIds, required fields present
- Temporal: slots theo thứ tự dayIndex → slotOrder → plannedStart
- Night constraint: plannedEnd ≤ 22:30
- No time overlaps trong cùng ngày
- Locked slots giữ nguyên placeId + dayIndex
- Budget ≥ 0, fatigue ≤ threshold
- States.length === plan.length

Spec-specific validators:
- **Spec-01**: incrementalStates ≡ fullStates (tolerance 1e-9)
- **Spec-02**: pruned candidates thực sự infeasible (no false prunes)
- **Spec-03**: Σ allocation = GENERATE_ALL_CAP cho mọi iteration