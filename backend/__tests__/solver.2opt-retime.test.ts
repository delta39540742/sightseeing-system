import { describe, it, expect } from 'vitest';
import { generateGreedyPlan, optimizeWith2Opt, SolverContext } from '../src/api/plan/solver';
import type { Place, TripSlot } from '../src/types';

const PLACES: Place[] = [
  { placeId: 1, name: 'A', lat: 16.060, lng: 108.224, avgVisitDurationMin: 60, indoorOutdoor: 'indoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{tagId:3}], openingHours: [], peakTimes: [] } as any,
  { placeId: 2, name: 'B', lat: 16.075, lng: 108.221, avgVisitDurationMin: 60, indoorOutdoor: 'indoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{tagId:3}], openingHours: [], peakTimes: [] } as any,
  { placeId: 3, name: 'C', lat: 16.054, lng: 108.247, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
  { placeId: 4, name: 'D', lat: 15.995, lng: 108.265, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
];

const CTX: SolverContext = {
  weights: { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 },
  preferenceVector: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  preferredTagIds: [],
  softConstraints: [],
  startDate: new Date('2026-05-01T00:00:00.000+07:00'),
  budgetTotal: 5_000_000,
};

describe('Solver — 2-opt re-time correctness', () => {
  it('sau optimize, mỗi slot có plannedStart > plannedEnd của slot trước (cùng ngày)', () => {
    const greedy = generateGreedyPlan(1, PLACES, CTX);
    const optimized = optimizeWith2Opt(greedy, CTX, PLACES);

    for (let i = 1; i < optimized.length; i++) {
      if (optimized[i]!.dayIndex !== optimized[i - 1]!.dayIndex) continue;
      const prevEnd = new Date(optimized[i - 1]!.plannedEnd).getTime();
      const curStart = new Date(optimized[i]!.plannedStart).getTime();
      expect(curStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('sau optimize, mỗi slot end ≤ 20:00', () => {
    const greedy = generateGreedyPlan(1, PLACES, CTX);
    const optimized = optimizeWith2Opt(greedy, CTX, PLACES);

    for (const slot of optimized) {
      const end = new Date(slot.plannedEnd);
      const endMin = end.getHours() * 60 + end.getMinutes();
      expect(endMin).toBeLessThanOrEqual(20 * 60);
    }
  });

  it('opening_hours được tôn trọng sau optimize', () => {
    // Place 5 chỉ mở 14:00-18:00; nếu 2-opt đẩy nó vào 8:00 → phải bị reject
    const placeNoon: Place = {
      placeId: 5, name: 'Noon-only', lat: 16.061, lng: 108.225,
      avgVisitDurationMin: 60, indoorOutdoor: 'indoor', popularityScore: 0.5,
      terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{tagId:3}],
      openingHours: [
        { dayOfWeek: 0, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 1, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 2, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 3, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 4, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 5, openTime: '14:00', closeTime: '18:00' },
        { dayOfWeek: 6, openTime: '14:00', closeTime: '18:00' },
      ],
      peakTimes: [],
    } as any;

    const places = [...PLACES, placeNoon];
    const greedy = generateGreedyPlan(1, places, CTX);
    const optimized = optimizeWith2Opt(greedy, CTX, places);

    // Nếu placeNoon được chọn, slot của nó phải nằm trong 14:00-18:00
    for (const slot of optimized) {
      if (slot.placeId !== 5) continue;
      const start = new Date(slot.plannedStart);
      const end = new Date(slot.plannedEnd);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = end.getHours() * 60 + end.getMinutes();
      expect(startMin).toBeGreaterThanOrEqual(14 * 60);
      expect(endMin).toBeLessThanOrEqual(18 * 60);
    }
  });

  it('plan rỗng → trả rỗng, không throw', () => {
    const result = optimizeWith2Opt([] as TripSlot[], CTX, PLACES);
    expect(result).toEqual([]);
  });

  it('plan 1 slot → giữ nguyên', () => {
    const greedy = generateGreedyPlan(1, [PLACES[0]!], CTX);
    const optimized = optimizeWith2Opt(greedy, CTX, [PLACES[0]!]);
    expect(optimized.length).toBe(greedy.length);
    if (greedy.length > 0) {
      expect(optimized[0]!.placeId).toBe(greedy[0]!.placeId);
    }
  });
});
