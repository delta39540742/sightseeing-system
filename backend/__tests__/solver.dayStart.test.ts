import { describe, it, expect } from 'vitest';
import {
  generateGreedyPlan,
  optimizeWith2Opt,
  resolveDayStart,
  SolverContext,
  DayStart,
} from '../src/api/plan/solver';
import type { Place } from '../src/types';

// Hai cụm địa điểm cách nhau ~50km (Đà Nẵng vs Hội An) để khoảng cách di chuyển
// ngày-đầu có ảnh hưởng rõ tới việc chọn slot đầu tiên.
// Dùng duration dài (240min) để mỗi ngày chỉ chứa ~3 slot, đảm bảo còn candidates
// cho ngày sau khi test multi-day.
const DA_NANG: Place[] = [
  { placeId: 11, name: 'DN-Mỹ Khê',  lat: 16.054, lng: 108.247, avgVisitDurationMin: 240, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
  { placeId: 12, name: 'DN-Sơn Trà', lat: 16.110, lng: 108.275, avgVisitDurationMin: 240, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
  { placeId: 13, name: 'DN-Bảo tàng Chăm', lat: 16.060, lng: 108.224, avgVisitDurationMin: 240, indoorOutdoor: 'indoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [3], tags: [{tagId:3}], openingHours: [], peakTimes: [] } as any,
];

const HOI_AN: Place[] = [
  { placeId: 21, name: 'HA-Phố cổ',  lat: 15.880, lng: 108.338, avgVisitDurationMin: 240, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
  { placeId: 22, name: 'HA-Chùa Cầu', lat: 15.877, lng: 108.326, avgVisitDurationMin: 240, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
  { placeId: 23, name: 'HA-Làng gốm', lat: 15.872, lng: 108.319, avgVisitDurationMin: 240, indoorOutdoor: 'outdoor', popularityScore: 0.5, terrainEasiness: 1, minPrice: 0, tagIds: [1], tags: [{tagId:1}], openingHours: [], peakTimes: [] } as any,
];

const ALL = [...DA_NANG, ...HOI_AN];

const BASE_WEIGHTS = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
const START_DATE = new Date('2026-05-01T00:00:00.000+07:00');

function ctxFor(opts: Partial<SolverContext> = {}): SolverContext {
  return {
    weights: BASE_WEIGHTS,
    preferenceVector: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    preferredTagIds: [],
    softConstraints: [],
    startDate: START_DATE,
    budgetTotal: 5_000_000,
    ...opts,
  };
}

describe('resolveDayStart', () => {
  it('trả về null khi không có dayStarts và không có hotelPlace', () => {
    expect(resolveDayStart(ctxFor(), 0)).toBeNull();
  });

  it('ưu tiên dayStarts theo dayIndex', () => {
    const dayStarts: DayStart[] = [
      { dayIndex: 0, lat: 16.06, lng: 108.22, name: 'Sân bay' },
      { dayIndex: 1, lat: 15.88, lng: 108.34, name: 'Homestay HA' },
    ];
    expect(resolveDayStart(ctxFor({ dayStarts }), 0)).toEqual({ lat: 16.06, lng: 108.22 });
    expect(resolveDayStart(ctxFor({ dayStarts }), 1)).toEqual({ lat: 15.88, lng: 108.34 });
  });

  it('fallback về hotelPlace khi day không có entry trong dayStarts', () => {
    const dayStarts: DayStart[] = [{ dayIndex: 0, lat: 16.06, lng: 108.22 }];
    const hotelPlace = { placeId: 999, lat: 16.07, lng: 108.23 } as any;
    expect(resolveDayStart(ctxFor({ dayStarts, hotelPlace }), 2))
      .toEqual({ lat: 16.07, lng: 108.23 });
  });

  it('bỏ qua entry có lat/lng không hợp lệ', () => {
    const dayStarts: DayStart[] = [
      { dayIndex: 0, lat: Number.NaN, lng: 108.22 },
    ];
    const hotelPlace = { placeId: 999, lat: 16.07, lng: 108.23 } as any;
    expect(resolveDayStart(ctxFor({ dayStarts, hotelPlace }), 0))
      .toEqual({ lat: 16.07, lng: 108.23 });
  });
});

describe('generateGreedyPlan — per-day start ảnh hưởng tới slot đầu tiên', () => {
  it('dayStart ở Đà Nẵng → slot đầu là place Đà Nẵng (gần hơn)', () => {
    const plan = generateGreedyPlan(
      1,
      ALL,
      ctxFor({
        dayStarts: [{ dayIndex: 0, lat: 16.060, lng: 108.224 }], // trung tâm DN
      }),
    );
    expect(plan.length).toBeGreaterThan(0);
    // Slot đầu phải thuộc DA_NANG cluster
    const firstDnIds = DA_NANG.map((p) => p.placeId);
    expect(firstDnIds).toContain(plan[0]!.placeId);
  });

  it('dayStart ở Hội An → slot đầu là place Hội An (gần hơn)', () => {
    const plan = generateGreedyPlan(
      1,
      ALL,
      ctxFor({
        dayStarts: [{ dayIndex: 0, lat: 15.880, lng: 108.338 }], // phố cổ HA
      }),
    );
    expect(plan.length).toBeGreaterThan(0);
    const firstHaIds = HOI_AN.map((p) => p.placeId);
    expect(firstHaIds).toContain(plan[0]!.placeId);
  });

  it('mỗi ngày dùng dayStart riêng: day0=DN, day1=HA → slot đầu mỗi ngày khớp cluster', () => {
    const plan = generateGreedyPlan(
      2,
      ALL,
      ctxFor({
        dayStarts: [
          { dayIndex: 0, lat: 16.060, lng: 108.224 },
          { dayIndex: 1, lat: 15.880, lng: 108.338 },
        ],
      }),
    );

    const day0Slots = plan.filter((s) => s.dayIndex === 0);
    const day1Slots = plan.filter((s) => s.dayIndex === 1);
    expect(day0Slots.length).toBeGreaterThan(0);
    expect(day1Slots.length).toBeGreaterThan(0);

    expect(DA_NANG.map((p) => p.placeId)).toContain(day0Slots[0]!.placeId);
    expect(HOI_AN.map((p) => p.placeId)).toContain(day1Slots[0]!.placeId);
  });

  it('không có dayStart → fallback hotelPlace áp dụng cho mọi ngày', () => {
    const planNoDayStart = generateGreedyPlan(
      2,
      ALL,
      ctxFor({
        hotelPlace: { placeId: 0, lat: 16.060, lng: 108.224 } as any,
      }),
    );
    const planWithDayStart = generateGreedyPlan(
      2,
      ALL,
      ctxFor({
        dayStarts: [
          { dayIndex: 0, lat: 16.060, lng: 108.224 },
          { dayIndex: 1, lat: 16.060, lng: 108.224 },
        ],
      }),
    );
    // Cùng tọa độ xuất phát → cùng plan
    expect(planNoDayStart.map((s) => s.placeId))
      .toEqual(planWithDayStart.map((s) => s.placeId));
  });
});

describe('optimizeWith2Opt — re-time tôn trọng dayStart', () => {
  it('plan sau 2-opt vẫn hợp lệ về thứ tự giờ (cùng ngày)', () => {
    const ctx = ctxFor({
      dayStarts: [
        { dayIndex: 0, lat: 16.060, lng: 108.224 },
        { dayIndex: 1, lat: 15.880, lng: 108.338 },
      ],
    });
    const greedy = generateGreedyPlan(2, ALL, ctx);
    const optimized = optimizeWith2Opt(greedy, ctx, ALL);

    for (let i = 1; i < optimized.length; i++) {
      if (optimized[i]!.dayIndex !== optimized[i - 1]!.dayIndex) continue;
      const prevEnd = new Date(optimized[i - 1]!.plannedEnd).getTime();
      const curStart = new Date(optimized[i]!.plannedStart).getTime();
      expect(curStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });
});
