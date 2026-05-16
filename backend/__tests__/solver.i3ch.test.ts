import { describe, it, expect } from 'vitest';
import {
  generateGreedyPlan,
  generateI3CHPlan,
  optimizeWith2Opt,
  calculateItineraryScore,
  SolverContext,
} from '../src/api/plan/solver';
import type { Place } from '../src/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PLACES: Place[] = [
  { placeId: 1, name: 'A', lat: 16.060, lng: 108.224, avgVisitDurationMin: 60, indoorOutdoor: 'indoor',  popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{ tagId: 3 }], openingHours: [], peakTimes: [] } as any,
  { placeId: 2, name: 'B', lat: 16.075, lng: 108.221, avgVisitDurationMin: 60, indoorOutdoor: 'indoor',  popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{ tagId: 3 }], openingHours: [], peakTimes: [] } as any,
  { placeId: 3, name: 'C', lat: 16.054, lng: 108.247, avgVisitDurationMin: 90, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{ tagId: 1 }], openingHours: [], peakTimes: [] } as any,
  { placeId: 4, name: 'D', lat: 15.995, lng: 108.265, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{ tagId: 1 }], openingHours: [], peakTimes: [] } as any,
  { placeId: 5, name: 'E', lat: 16.032, lng: 108.210, avgVisitDurationMin: 60, indoorOutdoor: 'mixed',   popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [2], tags: [{ tagId: 2 }], openingHours: [], peakTimes: [] } as any,
  { placeId: 6, name: 'F', lat: 16.068, lng: 108.238, avgVisitDurationMin: 60, indoorOutdoor: 'mixed',   popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [2], tags: [{ tagId: 2 }], openingHours: [], peakTimes: [] } as any,
];

const CTX: SolverContext = {
  weights: { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 },
  preferenceVector: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  preferredTagIds: [],
  softConstraints: [],
  startDate: new Date('2026-05-01T00:00:00.000+07:00'),
  budgetTotal: 5_000_000,
};

// ─── Correctness ─────────────────────────────────────────────────────────────

describe('generateI3CHPlan — correctness', () => {
  it('trả về plan không rỗng với dữ liệu hợp lệ', () => {
    const result = generateI3CHPlan(1, PLACES, CTX);
    expect(result.length).toBeGreaterThan(0);
  });

  it('tất cả slot có plannedStart < plannedEnd', () => {
    const result = generateI3CHPlan(1, PLACES, CTX);
    for (const slot of result) {
      expect(new Date(slot.plannedStart).getTime()).toBeLessThan(new Date(slot.plannedEnd).getTime());
    }
  });

  it('tất cả slot kết thúc trước hoặc đúng 20:00', () => {
    const result = generateI3CHPlan(1, PLACES, CTX);
    for (const slot of result) {
      const end = new Date(slot.plannedEnd);
      const endMin = end.getHours() * 60 + end.getMinutes();
      expect(endMin).toBeLessThanOrEqual(20 * 60);
    }
  });

  it('slotOrder tăng liên tục từ 1 trong mỗi ngày', () => {
    const result = generateI3CHPlan(1, PLACES, CTX);
    const byDay = new Map<number, number[]>();
    for (const s of result) {
      if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
      byDay.get(s.dayIndex)!.push(s.slotOrder);
    }
    for (const orders of byDay.values()) {
      const sorted = [...orders].sort((a, b) => a - b);
      expect(sorted[0]).toBe(1);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBe(sorted[i - 1]! + 1);
      }
    }
  });

  it('không có placeId bị trùng lặp trong cùng một ngày', () => {
    const result = generateI3CHPlan(1, PLACES, CTX);
    const byDay = new Map<number, number[]>();
    for (const s of result) {
      if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
      byDay.get(s.dayIndex)!.push(s.placeId);
    }
    for (const [, ids] of byDay) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ─── Quality vs Greedy+2opt ───────────────────────────────────────────────────

describe('generateI3CHPlan — quality vs greedy+2opt', () => {
  it('I3CH score >= greedy+2opt score (I3CH chỉ cập nhật khi cải thiện)', () => {
    const greedy2opt = optimizeWith2Opt(generateGreedyPlan(1, PLACES, CTX), CTX, PLACES);
    const greedyScore = calculateItineraryScore(greedy2opt, CTX, PLACES);

    const i3ch = generateI3CHPlan(1, PLACES, CTX, { maxIterations: 10, perturbMoves: 3 });
    const i3chScore = calculateItineraryScore(i3ch, CTX, PLACES);

    expect(i3chScore).toBeGreaterThanOrEqual(greedyScore);
  });
});

// ─── Options behavior ─────────────────────────────────────────────────────────

describe('generateI3CHPlan — options behavior', () => {
  it('timeBudgetMs=1 vẫn trả về plan hợp lệ (Component 1+2 luôn chạy)', () => {
    const result = generateI3CHPlan(1, PLACES, CTX, { timeBudgetMs: 1 });
    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      expect(new Date(slot.plannedStart).getTime()).toBeLessThan(new Date(slot.plannedEnd).getTime());
    }
  });

  it('maxIterations=0 cho score bằng greedy+2opt (không perturbation nào chạy)', () => {
    const i3ch = generateI3CHPlan(1, PLACES, CTX, { maxIterations: 0 });
    const i3chScore = calculateItineraryScore(i3ch, CTX, PLACES);

    const greedy2opt = optimizeWith2Opt(generateGreedyPlan(1, PLACES, CTX), CTX, PLACES);
    const greedyScore = calculateItineraryScore(greedy2opt, CTX, PLACES);

    expect(i3chScore).toBe(greedyScore);
  });

  it('multi-day: slot được phân bổ với dayIndex hợp lệ [0, days-1]', () => {
    const days = 3;
    const result = generateI3CHPlan(days, PLACES, CTX);
    for (const slot of result) {
      expect(slot.dayIndex).toBeGreaterThanOrEqual(0);
      expect(slot.dayIndex).toBeLessThan(days);
    }
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('generateI3CHPlan — edge cases', () => {
  it('1 candidate → không throw, trả về plan', () => {
    expect(() => generateI3CHPlan(1, [PLACES[0]!], CTX)).not.toThrow();
    const result = generateI3CHPlan(1, [PLACES[0]!], CTX);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('candidates rỗng → trả về plan rỗng', () => {
    const result = generateI3CHPlan(1, [], CTX);
    expect(result.length).toBe(0);
  });

  it('anchor place (isAnchor=true) được chọn bởi greedy và không bị perturbation xóa', () => {
    const anchorPlace: Place = {
      placeId: 99,
      name: 'Anchor',
      lat: 16.062,
      lng: 108.228,
      avgVisitDurationMin: 60,
      indoorOutdoor: 'indoor',
      popularityScore: 0.5,
      terrainEasiness: 1,
      minPrice: 0,
      tagIds: [3],
      tags: [{ tagId: 3 }],
      openingHours: [],
      peakTimes: [],
      isAnchor: true,
    } as any;

    const candidates = [...PLACES, anchorPlace];
    const result = generateI3CHPlan(1, candidates, CTX, { maxIterations: 20, perturbMoves: 3 });

    // Anchor có score +1000 → greedy luôn chọn. Perturbation bỏ qua isAnchor → phải còn trong plan.
    expect(result.some((s) => s.placeId === 99)).toBe(true);
  });
});
