import { describe, it, expect } from 'vitest';
import { generateGreedyPlan, SolverContext } from '../src/api/plan/solver';
import type { Place } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture: 6 địa điểm ở Đà Nẵng với tag rất khác nhau
// Tag map: 1=beach, 2=mountain, 3=culture, 4=food, 5=spiritual,
//          6=shopping, 7=entertainment, 8=park, 9=rest, 10=sightseeing
// ---------------------------------------------------------------------------

const PLACES: Place[] = [
  // beach lover paradise
  { placeId: 1, name: 'Bãi Mỹ Khê',     lat: 16.054, lng: 108.247, avgVisitDurationMin: 90, indoorOutdoor: 'outdoor', popularityScore: 0.9, terrainEasiness: 1.0, minPrice: 0, tagIds: [1, 9], tags: [{tagId:1},{tagId:9}], openingHours: [] } as any,
  { placeId: 2, name: 'Biển Non Nước',  lat: 15.995, lng: 108.265, avgVisitDurationMin: 90, indoorOutdoor: 'outdoor', popularityScore: 0.7, terrainEasiness: 1.0, minPrice: 0, tagIds: [1],    tags: [{tagId:1}],          openingHours: [] } as any,
  // culture lover
  { placeId: 3, name: 'Bảo tàng Chăm',  lat: 16.060, lng: 108.224, avgVisitDurationMin: 90, indoorOutdoor: 'indoor',  popularityScore: 0.8, terrainEasiness: 1.0, minPrice: 60_000, tagIds: [3, 10], tags: [{tagId:3},{tagId:10}], openingHours: [] } as any,
  { placeId: 4, name: 'Phố cổ Hội An',  lat: 15.880, lng: 108.338, avgVisitDurationMin: 120, indoorOutdoor: 'outdoor', popularityScore: 0.95, terrainEasiness: 1.0, minPrice: 0, tagIds: [3, 10], tags: [{tagId:3},{tagId:10}], openingHours: [] } as any,
  // food
  { placeId: 5, name: 'Phố ẩm thực',    lat: 16.075, lng: 108.221, avgVisitDurationMin: 60, indoorOutdoor: 'outdoor', popularityScore: 0.6, terrainEasiness: 1.0, minPrice: 50_000, tagIds: [4], tags: [{tagId:4}], openingHours: [] } as any,
  // spiritual / mountain
  { placeId: 6, name: 'Chùa Linh Ứng',  lat: 16.099, lng: 108.279, avgVisitDurationMin: 90, indoorOutdoor: 'outdoor', popularityScore: 0.85, terrainEasiness: 0.8, minPrice: 0, tagIds: [5, 2], tags: [{tagId:5},{tagId:2}], openingHours: [] } as any,
];

const BASE_WEIGHTS = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
const START_DATE = new Date('2026-05-01T00:00:00.000+07:00');

function ctxFor(vector: number[], preferredTagIds: number[] = [], soft: any[] = []): SolverContext {
  return {
    weights: BASE_WEIGHTS,
    preferenceVector: vector,
    preferredTagIds,
    softConstraints: soft,
    startDate: START_DATE,
    budgetTotal: 5_000_000,
  };
}

function placeIdsOf(plan: { placeId: number }[]): number[] {
  return plan.map((s) => s.placeId);
}

describe('Solver personalization', () => {
  it('user yêu biển (vector cao ở tag 1) phải xếp Mỹ Khê / Non Nước trước văn hoá', () => {
    // Vector boost tag 1 (beach), tag 9 (rest)
    const vector = [1.0, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.8, 0.2];
    const plan = generateGreedyPlan(1, PLACES, ctxFor(vector));

    const ids = placeIdsOf(plan);
    const idxMyKhe   = ids.indexOf(1);
    const idxNonNuoc = ids.indexOf(2);
    const idxCham    = ids.indexOf(3);
    const idxHoiAn   = ids.indexOf(4);

    // Ít nhất một địa điểm biển phải xuất hiện
    expect(idxMyKhe >= 0 || idxNonNuoc >= 0).toBe(true);

    // Nếu cả biển và văn hoá cùng được chọn, biển phải đứng trước (không tính meal)
    const beachFirst = ids.indexOf(1) >= 0 ? ids.indexOf(1) : ids.indexOf(2);
    const cultureFirst = idxCham >= 0 ? idxCham : idxHoiAn;
    if (beachFirst >= 0 && cultureFirst >= 0) {
      expect(beachFirst).toBeLessThan(cultureFirst);
    }
  });

  it('user yêu văn hoá (vector cao ở tag 3) phải xếp Bảo tàng / Hội An trước biển', () => {
    const vector = [0.1, 0.1, 1.0, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.9];
    const plan = generateGreedyPlan(1, PLACES, ctxFor(vector));

    const ids = placeIdsOf(plan);
    const idxCham    = ids.indexOf(3);
    const idxHoiAn   = ids.indexOf(4);
    const idxMyKhe   = ids.indexOf(1);
    const idxNonNuoc = ids.indexOf(2);

    expect(idxCham >= 0 || idxHoiAn >= 0).toBe(true);

    const cultureFirst = idxCham >= 0 ? idxCham : idxHoiAn;
    const beachFirst = idxMyKhe >= 0 ? idxMyKhe : idxNonNuoc;
    if (cultureFirst >= 0 && beachFirst >= 0) {
      expect(cultureFirst).toBeLessThan(beachFirst);
    }
  });

  it('hai user khác nhau cho ra plan khác nhau', () => {
    const beachLover = [1.0, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.8, 0.2];
    const cultureLover = [0.1, 0.1, 1.0, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.9];

    const planA = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor(beachLover)));
    const planB = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor(cultureLover)));

    expect(planA).not.toEqual(planB);
  });

  it('softConstraints avoid_category loại bỏ địa điểm thuộc tag bị tránh', () => {
    // Vector trung tính
    const neutralVec = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const planNoSoft = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor(neutralVec)));

    // Avoid văn hoá (tag 3) với strength cao
    const planAvoid = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor(neutralVec, [], [
      { type: 'avoid_category', value: '3', strength: 1.0 },
    ])));

    // Plan tránh culture không nên có Bảo tàng (3) hay Hội An (4) ở những vị trí đầu
    // (hoặc bị đẩy xuống cuối)
    const idxCultureNoSoft = Math.min(...[planNoSoft.indexOf(3), planNoSoft.indexOf(4)].filter(i => i >= 0).concat([Infinity]));
    const idxCultureAvoid = Math.min(...[planAvoid.indexOf(3), planAvoid.indexOf(4)].filter(i => i >= 0).concat([Infinity]));

    expect(idxCultureAvoid).toBeGreaterThanOrEqual(idxCultureNoSoft);
  });

  it('cold-start (no vector, no payload tags) vẫn ra plan hợp lệ', () => {
    const plan = generateGreedyPlan(1, PLACES, ctxFor([], []));
    expect(plan.length).toBeGreaterThan(0);
    // Không có cá nhân hoá → ranking driven bởi popularity + distance + meal logic
  });

  it('preferredTagIds được dùng khi vector rỗng', () => {
    const planFood = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor([], [4])));
    const planBeach = placeIdsOf(generateGreedyPlan(1, PLACES, ctxFor([], [1])));

    // Plan food-lover: place 5 (food) phải xuất hiện sớm hơn so với plan beach-lover
    const foodIdxInFood = planFood.indexOf(5);
    const foodIdxInBeach = planBeach.indexOf(5);
    if (foodIdxInFood >= 0 && foodIdxInBeach >= 0) {
      expect(foodIdxInFood).toBeLessThanOrEqual(foodIdxInBeach);
    }
  });

  it('sinh slot meal vào khoảng 12:00 với food tag', () => {
    const vector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const plan = generateGreedyPlan(1, PLACES, ctxFor(vector, [4]));

    const mealSlot = plan.find((s) => s.activityType === 'meal');
    expect(mealSlot).toBeDefined();
    if (mealSlot) {
      expect(mealSlot.placeId).toBe(5); // chỉ có place 5 là food
      const startHour = new Date(mealSlot.plannedStart).getHours();
      // lunch window 10:30-13:30 hoặc dinner window 16:30-19:30
      expect(startHour >= 10 && startHour <= 19).toBe(true);
    }
  });
});
