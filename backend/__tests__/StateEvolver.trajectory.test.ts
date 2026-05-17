/**
 * StateEvolver.trajectory.test.ts
 *
 * Kiểm thử trực tiếp ba phương thức chưa được bao phủ trong StateEvolver:
 *   - estimateTravelTime()  — công thức Haversine + hệ số đường
 *   - computeTrajectory()   — mô phỏng chuỗi trạng thái
 *   - isPlanFeasible()      — kiểm tra tính khả thi toàn bộ kế hoạch
 */

import { describe, it, expect } from 'vitest';
import StateEvolver from '../src/replanner/StateEvolver';
import type { ReplanContext } from '../src/replanner/StateEvolver';
import type { TripState, TripSlot, Place, UserPreference } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,
    budgetRemaining: 500_000,
    fatigue: 0.2,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-20T08:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    minPrice: undefined,
    maxPrice: undefined,
    priceType: 'free',
    avgVisitDurationMin: 60,
    parkingAvailable: false,
    wheelchairAccess: false,
    publicTransport: false,
    terrainEasiness: 0.8,
    roadAccessScore: null,
    spaciousness1km: null,
    popularityScore: null,
    indoorOutdoor: 'indoor',
    isLandmark: false,
    landmarkClassId: null,
    address: null,
    images: [],
    tags: [],
    openingHours: [],
    ...overrides,
  };
}

function makeSlot(overrides: Partial<TripSlot> = {}): TripSlot {
  return {
    slotId: 'slot-001',
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-20T09:00:00+07:00',
    plannedEnd: '2026-04-20T10:00:00+07:00',
    actualStart: null,
    actualEnd: null,
    estimatedCost: 50_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makeUser(): UserPreference {
  return { preferenceVector: new Array(10).fill(0), pace: 0.5 };
}

function makeCtx(places: Place[], overrides: Partial<ReplanContext> = {}): ReplanContext {
  return {
    candidatePool: places,
    user: makeUser(),
    initialState: makeState(),
    defaultWeather: { rainMmPerH: 0 },
    ...overrides,
  };
}

const evolver = new StateEvolver();

// ---------------------------------------------------------------------------
// 1. estimateTravelTime
// ---------------------------------------------------------------------------

describe('1. Nhóm kiểm thử estimateTravelTime()', () => {
  it('trả về 0 khi hai điểm trùng tọa độ', () => {
    expect(evolver.estimateTravelTime(16.0614, 108.2273, 16.0614, 108.2273)).toBe(0);
  });

  it('trả về giá trị dương với hai điểm khác nhau', () => {
    // Đà Nẵng → Hội An (~30 km đường chim bay)
    const t = evolver.estimateTravelTime(16.0614, 108.2273, 15.8794, 108.3346);
    expect(t).toBeGreaterThan(0);
  });

  it('công thức: haversine_km × 1.4 / 25 × 60 — kiểm tra khoảng giá trị ~30km', () => {
    // Haversine(Đà Nẵng, Hội An) ≈ 28-30 km
    // Thời gian = 29 × 1.4 / 25 × 60 ≈ 97 phút
    const t = evolver.estimateTravelTime(16.0614, 108.2273, 15.8794, 108.3346);
    expect(t).toBeGreaterThan(60);
    expect(t).toBeLessThan(130);
  });

  it('tính đối xứng: estimateTravelTime(A→B) === estimateTravelTime(B→A)', () => {
    const lat1 = 16.0614, lng1 = 108.2273;
    const lat2 = 16.0474, lng2 = 108.2068;
    const ab = evolver.estimateTravelTime(lat1, lng1, lat2, lng2);
    const ba = evolver.estimateTravelTime(lat2, lng2, lat1, lng1);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('tọa độ gốc (0,0 → 0,0): trả về 0', () => {
    expect(evolver.estimateTravelTime(0, 0, 0, 0)).toBe(0);
  });

  it('khoảng cách rất nhỏ (<100m): trả về giá trị không âm', () => {
    // Dịch chuyển ~0.001 độ ≈ 111m
    const t = evolver.estimateTravelTime(16.0614, 108.2273, 16.0615, 108.2274);
    expect(t).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 2. computeTrajectory
// ---------------------------------------------------------------------------

describe('2. Nhóm kiểm thử computeTrajectory()', () => {
  it('kế hoạch rỗng: trả về mảng 1 phần tử chứa initialState', () => {
    const initial = makeState();
    const ctx = makeCtx([]);
    const result = evolver.computeTrajectory([], initial, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(initial);
  });

  it('kế hoạch 1 slot: trả về mảng độ dài 2', () => {
    const place = makePlace({ placeId: 1 });
    const slot = makeSlot({ placeId: 1 });
    const ctx = makeCtx([place]);
    const result = evolver.computeTrajectory([slot], makeState(), ctx);
    expect(result).toHaveLength(2);
  });

  it('kế hoạch N slot: độ dài kết quả = N + 1', () => {
    const places = [
      makePlace({ placeId: 1, lat: 16.06, lng: 108.22 }),
      makePlace({ placeId: 2, lat: 16.07, lng: 108.23 }),
      makePlace({ placeId: 3, lat: 16.08, lng: 108.24 }),
    ];
    const slots = places.map((p, i) =>
      makeSlot({ slotId: `slot-${i}`, placeId: p.placeId, slotOrder: i }),
    );
    const ctx = makeCtx(places);
    const result = evolver.computeTrajectory(slots, makeState(), ctx);
    expect(result).toHaveLength(4);
  });

  it('phần tử đầu tiên là chính xác initialState', () => {
    const initial = makeState({ budgetRemaining: 999_999 });
    const place = makePlace({ placeId: 1 });
    const ctx = makeCtx([place]);
    const result = evolver.computeTrajectory([makeSlot()], initial, ctx);
    expect(result[0]).toBe(initial);
  });

  it('mỗi state trong mảng là object mới (không tham chiếu đến state trước)', () => {
    const place = makePlace({ placeId: 1 });
    const ctx = makeCtx([place]);
    const result = evolver.computeTrajectory([makeSlot()], makeState(), ctx);
    expect(result[0]).not.toBe(result[1]);
  });

  it('timeRemainingMin giảm dần qua từng bước', () => {
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 60 }),
    ];
    const slots = [
      makeSlot({ slotId: 's1', placeId: 1, slotOrder: 0 }),
      makeSlot({ slotId: 's2', placeId: 2, slotOrder: 1 }),
    ];
    const ctx = makeCtx(places);
    const result = evolver.computeTrajectory(slots, makeState({ timeRemainingMin: 480 }), ctx);
    expect(result[1]!.timeRemainingMin).toBeLessThan(result[0]!.timeRemainingMin);
    expect(result[2]!.timeRemainingMin).toBeLessThan(result[1]!.timeRemainingMin);
  });

  it('budgetRemaining giảm dần qua từng bước', () => {
    const place = makePlace({ placeId: 1, minPrice: 50_000 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 50_000 });
    const ctx = makeCtx([place]);
    const result = evolver.computeTrajectory([slot], makeState({ budgetRemaining: 500_000 }), ctx);
    expect(result[1]!.budgetRemaining).toBeLessThan(result[0]!.budgetRemaining);
  });

  it('ném Error khi placeId trong plan không tìm thấy trong candidatePool', () => {
    const ctx = makeCtx([]); // candidatePool rỗng
    const slot = makeSlot({ placeId: 999 });
    expect(() => evolver.computeTrajectory([slot], makeState(), ctx)).toThrow(
      /placeId 999 not found/,
    );
  });

  it('sử dụng ctx.placeMap khi có sẵn (không cần candidatePool)', () => {
    const place = makePlace({ placeId: 1 });
    const placeMap = new Map([[1, place]]);
    const ctx = makeCtx([], { placeMap }); // candidatePool rỗng nhưng placeMap có
    const slot = makeSlot({ placeId: 1 });
    const result = evolver.computeTrajectory([slot], makeState(), ctx);
    expect(result).toHaveLength(2);
  });

  it('travelTime = 0 khi currentLat/Lng là null', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 0 });
    const initial = makeState({ currentLat: null as any, currentLng: null as any, timeRemainingMin: 480 });
    const ctx = makeCtx([place]);
    const result = evolver.computeTrajectory([slot], initial, ctx);
    // Với travelTime=0, chỉ trừ đi avgVisitDurationMin=60
    expect(result[1]!.timeRemainingMin).toBeCloseTo(480 - 60, 1);
  });

  it('thời tiết fallback về ctx.defaultWeather khi dayIndex không có trong weatherForecast', () => {
    const place = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const slot = makeSlot({ placeId: 1, dayIndex: 5 }); // dayIndex 5 không có trong forecast
    const ctx = makeCtx([place], {
      weatherForecast: [], // rỗng
      defaultWeather: { rainMmPerH: 0 },
    });
    // Không nên ném lỗi
    expect(() => evolver.computeTrajectory([slot], makeState(), ctx)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. isPlanFeasible
// ---------------------------------------------------------------------------

describe('3. Nhóm kiểm thử isPlanFeasible()', () => {
  it('trả về false ngay lập tức nếu initialState không khả thi (timeRemaining < 0)', () => {
    const initial = makeState({ timeRemainingMin: -1 });
    const place = makePlace({ placeId: 1 });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([], initial, ctx)).toBe(false);
  });

  it('trả về false ngay lập tức nếu initialState không khả thi (fatigue > 0.95)', () => {
    const initial = makeState({ fatigue: 0.96 });
    const ctx = makeCtx([]);
    expect(evolver.isPlanFeasible([], initial, ctx)).toBe(false);
  });

  it('kế hoạch rỗng với initialState hợp lệ: trả về true', () => {
    const ctx = makeCtx([]);
    expect(evolver.isPlanFeasible([], makeState(), ctx)).toBe(true);
  });

  it('kế hoạch 1 slot hợp lệ: trả về true', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 10_000 });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([slot], makeState(), ctx)).toBe(true);
  });

  it('trả về false khi hết thời gian sau slot đầu tiên', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 200 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 0 });
    // chỉ còn 30 phút nhưng slot cần 200 phút
    const initial = makeState({ timeRemainingMin: 30, currentLat: null as any, currentLng: null as any });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([slot], initial, ctx)).toBe(false);
  });

  it('trả về false khi hết ngân sách sau một slot', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 600_000 });
    const initial = makeState({ budgetRemaining: 100_000, timeRemainingMin: 480 });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([slot], initial, ctx)).toBe(false);
  });

  it('bỏ qua slot có status = completed', () => {
    // slot "completed" cần 9999 phút — nếu không bỏ qua sẽ fail
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 9999 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 999_999_999, status: 'completed' });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([slot], makeState(), ctx)).toBe(true);
  });

  it('bỏ qua slot có status = skipped', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 9999 });
    const slot = makeSlot({ placeId: 1, estimatedCost: 999_999_999, status: 'skipped' });
    const ctx = makeCtx([place]);
    expect(evolver.isPlanFeasible([slot], makeState(), ctx)).toBe(true);
  });

  it('ném Error khi placeId không có trong candidatePool', () => {
    const slot = makeSlot({ placeId: 999 });
    const ctx = makeCtx([]); // candidatePool rỗng
    expect(() => evolver.isPlanFeasible([slot], makeState(), ctx)).toThrow(/placeId 999/);
  });

  it('chuỗi 3 slot hợp lệ: trả về true', () => {
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 60 }),
      makePlace({ placeId: 3, avgVisitDurationMin: 60 }),
    ];
    const slots = places.map((p, i) =>
      makeSlot({ slotId: `s${i}`, placeId: p.placeId, slotOrder: i, estimatedCost: 10_000 }),
    );
    const initial = makeState({ timeRemainingMin: 480, budgetRemaining: 500_000 });
    const ctx = makeCtx(places);
    expect(evolver.isPlanFeasible(slots, initial, ctx)).toBe(true);
  });

  it('dừng sớm: khi slot thứ 2 vi phạm, không throw dù slot thứ 3 có placeId không tồn tại', () => {
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 600 }), // slot này sẽ làm hết giờ
    ];
    const slots = [
      makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 0 }),
      makeSlot({ slotId: 's2', placeId: 2, estimatedCost: 0 }),
      makeSlot({ slotId: 's3', placeId: 999, estimatedCost: 0 }), // không tồn tại
    ];
    const initial = makeState({ timeRemainingMin: 30, currentLat: null as any, currentLng: null as any });
    // slot 2 hết giờ → short-circuit → không đến slot 3 → không ném lỗi
    const ctx = makeCtx(places);
    expect(evolver.isPlanFeasible(slots, initial, ctx)).toBe(false);
  });

  it('sử dụng ctx.placeMap nếu đã có sẵn', () => {
    const place = makePlace({ placeId: 42 });
    const placeMap = new Map([[42, place]]);
    const ctx = makeCtx([], { placeMap }); // candidatePool rỗng
    const slot = makeSlot({ placeId: 42, estimatedCost: 0 });
    expect(evolver.isPlanFeasible([slot], makeState(), ctx)).toBe(true);
  });
});
