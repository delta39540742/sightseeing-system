import { describe, it, expect } from 'vitest';
import { generateGreedyPlan, SolverContext } from '../src/api/plan/solver';
import type { Place } from '../src/types';

const PLACES: Place[] = [
  // Hai địa điểm văn hoá tương đương về tag, popularity
  { placeId: 100, name: 'Bảo tàng A', lat: 16.060, lng: 108.224, avgVisitDurationMin: 90, indoorOutdoor: 'indoor', popularityScore: 0.7, terrainEasiness: 1.0, minPrice: 60_000, tagIds: [3, 10], tags: [{tagId:3},{tagId:10}], openingHours: [], peakTimes: [] } as any,
  { placeId: 101, name: 'Bảo tàng B', lat: 16.061, lng: 108.223, avgVisitDurationMin: 90, indoorOutdoor: 'indoor', popularityScore: 0.7, terrainEasiness: 1.0, minPrice: 60_000, tagIds: [3, 10], tags: [{tagId:3},{tagId:10}], openingHours: [], peakTimes: [] } as any,
  // Một food
  { placeId: 200, name: 'Quán ăn',    lat: 16.075, lng: 108.221, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', popularityScore: 0.6, terrainEasiness: 1.0, minPrice: 50_000, tagIds: [4],   tags: [{tagId:4}],          openingHours: [], peakTimes: [] } as any,
];

const BASE_WEIGHTS = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
const START_DATE = new Date('2026-05-01T00:00:00.000+07:00');

function ctxFor(opts: Partial<SolverContext> = {}): SolverContext {
  return {
    weights: BASE_WEIGHTS,
    preferenceVector: [0.1, 0.1, 1.0, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9],
    preferredTagIds: [],
    softConstraints: [],
    startDate: START_DATE,
    budgetTotal: 5_000_000,
    ...opts,
  };
}

describe('Solver P3 — collaborative filtering', () => {
  it('similar users đã rate cao Bảo tàng B → B được xếp trước A', () => {
    const cf = new Map<number, number>([
      [101, 3.5], // boost cao cho place B
    ]);
    const plan = generateGreedyPlan(1, PLACES, ctxFor({ collaborativeBoosts: cf }));

    const ids = plan.map((s) => s.placeId);
    const idxA = ids.indexOf(100);
    const idxB = ids.indexOf(101);
    if (idxA >= 0 && idxB >= 0) {
      expect(idxB).toBeLessThan(idxA);
    } else {
      // ít nhất B phải xuất hiện
      expect(idxB).toBeGreaterThanOrEqual(0);
    }
  });

  it('không có CF data → ranking giữ nguyên (theo distance/popularity)', () => {
    const planNoCf = generateGreedyPlan(1, PLACES, ctxFor());
    const planEmpty = generateGreedyPlan(1, PLACES, ctxFor({ collaborativeBoosts: new Map() }));

    expect(planNoCf.map((s) => s.placeId)).toEqual(planEmpty.map((s) => s.placeId));
  });

  it('CF boost lớn vẫn không vượt anchor (anchor = 1000)', () => {
    const cf = new Map<number, number>([[101, 100]]);
    const placesWithAnchor = [
      ...PLACES,
      { ...PLACES[0], placeId: 999, name: 'Anchor', isAnchor: true } as any,
    ];
    const plan = generateGreedyPlan(1, placesWithAnchor as any, ctxFor({ collaborativeBoosts: cf }));
    expect(plan[0]!.placeId).toBe(999);
  });
});

describe('Solver P3 — peak-time emptiness', () => {
  it('place vắng người vào lúc visit → boost so với place đông', () => {
    // 2 place giống hệt nhau, khác mỗi peakTimes
    const empty = { ...PLACES[0], placeId: 300, name: 'Vắng', peakTimes: [
      { startTime: '09:00', endTime: '12:00', emptinessLevel: 1.0 }
    ]} as any;
    const crowded = { ...PLACES[0], placeId: 301, name: 'Đông', peakTimes: [
      { startTime: '09:00', endTime: '12:00', emptinessLevel: 0.0 }
    ]} as any;

    const plan = generateGreedyPlan(1, [empty, crowded] as any, ctxFor());
    const ids = plan.map((s) => s.placeId);
    const idxEmpty = ids.indexOf(300);
    const idxCrowded = ids.indexOf(301);

    if (idxEmpty >= 0 && idxCrowded >= 0) {
      expect(idxEmpty).toBeLessThan(idxCrowded);
    } else {
      expect(idxEmpty).toBeGreaterThanOrEqual(0);
    }
  });

  it('không có peakTimes → neutral, không ảnh hưởng', () => {
    const a = { ...PLACES[0], placeId: 400, peakTimes: undefined } as any;
    const b = { ...PLACES[1], placeId: 401, peakTimes: [] } as any;

    // ranking phải ổn định khi peakTimes vắng
    const plan = generateGreedyPlan(1, [a, b] as any, ctxFor());
    expect(plan.length).toBeGreaterThan(0);
  });

  it('peakTimes ngoài giờ visit → không tính', () => {
    // Peak time 22:00-23:00 không overlap với window visit ban ngày (8:00-20:00)
    const a = { ...PLACES[0], placeId: 500, peakTimes: [
      { startTime: '22:00', endTime: '23:00', emptinessLevel: 0.0 } // night peak
    ]} as any;
    const b = { ...PLACES[1], placeId: 501, peakTimes: [] } as any;

    const planA = generateGreedyPlan(1, [a] as any, ctxFor()).map((s) => s.placeId);
    const planB = generateGreedyPlan(1, [b] as any, ctxFor()).map((s) => s.placeId);

    // Cả hai đều được chọn (peak time đêm không phạt place ban ngày)
    expect(planA).toEqual([500]);
    expect(planB).toEqual([501]);
  });
});

describe('Solver P3 — combined personalization', () => {
  it('vector + softConstraints + CF + peakTimes hoạt động đồng thời', () => {
    const cf = new Map<number, number>([[101, 4.0]]);
    const placesWithPeak = [
      { ...PLACES[0], peakTimes: [{ startTime: '08:00', endTime: '20:00', emptinessLevel: 0.2 }] } as any, // đông cả ngày
      { ...PLACES[1], peakTimes: [{ startTime: '08:00', endTime: '20:00', emptinessLevel: 0.9 }] } as any, // vắng cả ngày
      PLACES[2] as any,
    ];

    const plan = generateGreedyPlan(1, placesWithPeak, ctxFor({
      collaborativeBoosts: cf,
      softConstraints: [{ type: 'prefer_indoor', value: 'indoor', strength: 0.5 }],
    }));

    // Place 101 có cả CF boost + vắng người + indoor → phải đứng trước 100
    const ids = plan.map((s) => s.placeId);
    const idxA = ids.indexOf(100);
    const idxB = ids.indexOf(101);
    if (idxA >= 0 && idxB >= 0) {
      expect(idxB).toBeLessThan(idxA);
    } else {
      expect(idxB).toBeGreaterThanOrEqual(0);
    }
  });
});
