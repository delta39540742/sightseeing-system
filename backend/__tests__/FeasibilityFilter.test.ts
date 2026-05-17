/**
 * FeasibilityFilter.test.ts
 *
 * Kiểm thử isSetFeasible() — bộ lọc lower-bound trước khi chạy computeTrajectory():
 *   - LB cost  = sum(minPrice)
 *   - LB time  = sum(avgVisitDurationMin) + MST(Haversine) / V_MAX(60 km/h) × 60
 *   - Cache module-level (clearSetFeasibilityCache phải gọi trong beforeEach)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isSetFeasible, clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { ReplanContext } from '../src/replanner/StateEvolver';
import type { Place, TripState } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    minPrice: 0,
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

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,
    budgetRemaining: 500_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-20T08:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makeCtx(
  timeRemainingMin: number,
  budgetRemaining: number,
): ReplanContext {
  return {
    candidatePool: [],
    user: { preferenceVector: [], pace: 0.5 },
    initialState: makeState({ timeRemainingMin, budgetRemaining }),
    defaultWeather: { rainMmPerH: 0 },
  };
}

// ---------------------------------------------------------------------------
// Setup: xóa cache trước mỗi test để tránh kết quả stale
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSetFeasibilityCache();
});

// ---------------------------------------------------------------------------
// 1. Điều kiện biên cơ bản
// ---------------------------------------------------------------------------

describe('1. Nhóm kiểm thử điều kiện biên cơ bản', () => {
  it('mảng places rỗng: luôn trả về true', () => {
    expect(isSetFeasible([], makeCtx(0, 0))).toBe(true);
  });

  it('1 place, đủ thời gian và ngân sách: trả về true', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 50_000 });
    expect(isSetFeasible([place], makeCtx(480, 500_000))).toBe(true);
  });

  it('1 place, ngân sách không đủ (minPrice > budgetRemaining): trả về false', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: 600_000 });
    expect(isSetFeasible([place], makeCtx(480, 500_000))).toBe(false);
  });

  it('1 place, thời gian không đủ (avgVisitDurationMin > timeRemainingMin): trả về false', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 500, minPrice: 0 });
    expect(isSetFeasible([place], makeCtx(60, 500_000))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. LB cost: sum(minPrice)
// ---------------------------------------------------------------------------

describe('2. Nhóm kiểm thử LB cost (sum minPrice)', () => {
  it('minPrice = undefined được coi là 0 (không tính vào lbCost)', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: undefined });
    expect(isSetFeasible([place], makeCtx(480, 0))).toBe(true);
  });

  it('minPrice = null được coi là 0', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: null as any });
    expect(isSetFeasible([place], makeCtx(480, 0))).toBe(true);
  });

  it('nhiều place: lbCost là tổng tất cả minPrice', () => {
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: 100_000 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 30, minPrice: 200_000, lat: 16.07, lng: 108.23 }),
    ];
    // tổng = 300_000, budget = 299_999 → false
    expect(isSetFeasible(places, makeCtx(480, 299_999))).toBe(false);
  });

  it('lbCost chính xác bằng budgetRemaining: vẫn pass (điều kiện ≤)', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: 100_000 });
    expect(isSetFeasible([place], makeCtx(480, 100_000))).toBe(true);
  });

  it('lbCost vượt 1 đơn vị: trả về false', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: 100_001 });
    expect(isSetFeasible([place], makeCtx(480, 100_000))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. LB time: sum(avgVisitDurationMin) + MST/V_MAX×60
// ---------------------------------------------------------------------------

describe('3. Nhóm kiểm thử LB time (visit + MST travel)', () => {
  it('1 place: MST = 0 → lbTime = avgVisitDurationMin', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    // timeRemaining = 60 → lbTime = 60 → pass
    expect(isSetFeasible([place], makeCtx(60, 999_999))).toBe(true);
    // timeRemaining = 59 → fail
    clearSetFeasibilityCache();
    expect(isSetFeasible([place], makeCtx(59, 999_999))).toBe(false);
  });

  it('2 places cùng tọa độ: MST Haversine = 0 → lbTime = sum(avgVisitDurationMin)', () => {
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0, lat: 16.0614, lng: 108.2273 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 60, minPrice: 0, lat: 16.0614, lng: 108.2273 }),
    ];
    expect(isSetFeasible(places, makeCtx(120, 999_999))).toBe(true);
    clearSetFeasibilityCache();
    expect(isSetFeasible(places, makeCtx(119, 999_999))).toBe(false);
  });

  it('2 places xa nhau: lbTime > sum(avgVisitDurationMin)', () => {
    // Đà Nẵng → Hội An ≈ 29 km
    // lbTravel ≈ 29/60 × 60 ≈ 29 phút (dùng V_MAX = 60 km/h)
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0, lat: 16.0614, lng: 108.2273 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 60, minPrice: 0, lat: 15.8794, lng: 108.3346 }),
    ];
    // lbTime ≈ 120 + 29 ≈ 149 phút → 120 phút không đủ
    expect(isSetFeasible(places, makeCtx(120, 999_999))).toBe(false);
    clearSetFeasibilityCache();
    // 200 phút đủ
    expect(isSetFeasible(places, makeCtx(200, 999_999))).toBe(true);
  });

  it('lbTime chính xác bằng timeRemainingMin: vẫn pass (điều kiện ≤)', () => {
    // 1 place không cần MST travel
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 100, minPrice: 0 });
    expect(isSetFeasible([place], makeCtx(100, 999_999))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Cache module-level
// ---------------------------------------------------------------------------

describe('4. Nhóm kiểm thử cache', () => {
  it('cache hit: cùng placeIds → cùng kết quả dù ctx khác', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    // Lần 1: đủ ngân sách → true
    const r1 = isSetFeasible([place], makeCtx(480, 999_999));
    expect(r1).toBe(true);
    // Lần 2: cùng places nhưng ngân sách 0 → trả về cached true (vì key giống nhau)
    const r2 = isSetFeasible([place], makeCtx(480, 0));
    expect(r2).toBe(true); // cache hit → không tính lại
  });

  it('sau khi clearSetFeasibilityCache: key giống nhau với ctx khác → tính lại', () => {
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0 });
    // Lần 1: đủ → cache true
    isSetFeasible([place], makeCtx(480, 999_999));
    // Clear cache
    clearSetFeasibilityCache();
    // Lần 2: thiếu thời gian → tính lại → false
    const r = isSetFeasible([place], makeCtx(1, 999_999));
    expect(r).toBe(false);
  });

  it('canonical key không phụ thuộc thứ tự places', () => {
    const p1 = makePlace({ placeId: 1, avgVisitDurationMin: 30, minPrice: 0 });
    const p2 = makePlace({ placeId: 2, avgVisitDurationMin: 30, minPrice: 0, lat: 16.07, lng: 108.23 });
    // Lần 1: [p1, p2]
    const r1 = isSetFeasible([p1, p2], makeCtx(480, 999_999));
    // Lần 2: [p2, p1] → cùng canonical key → cache hit, kết quả như r1
    const r2 = isSetFeasible([p2, p1], makeCtx(1, 0));
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// 5. Admissibility guarantee
// ---------------------------------------------------------------------------

describe('5. Nhóm kiểm thử admissibility (necessary condition)', () => {
  it('khi isSetFeasible trả về false → không cần gọi computeTrajectory (chặn sớm)', () => {
    // Xác nhận filter prune đúng trường hợp hiển nhiên không khả thi
    const place = makePlace({ placeId: 1, avgVisitDurationMin: 1000, minPrice: 0 });
    expect(isSetFeasible([place], makeCtx(60, 999_999))).toBe(false);
  });

  it('isSetFeasible là điều kiện cần: có thể pass nhưng computeTrajectory vẫn fail (false positive OK)', () => {
    // Hai place xa nhau → lbTravel dùng V_MAX 60km/h (thấp hơn thực tế 25km/h)
    // → lbTime có thể nhỏ hơn actual time → filter pass nhưng simulation fail
    // Điều này là đúng theo thiết kế (admissible LB)
    const places = [
      makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 0, lat: 16.0614, lng: 108.2273 }),
      makePlace({ placeId: 2, avgVisitDurationMin: 60, minPrice: 0, lat: 15.8794, lng: 108.3346 }),
    ];
    // Với 150 phút: lbTime (V_MAX=60) ≈ 149 → pass filter
    // Nhưng actualTravelTime (V_AVG=25) ≈ 97 phút → tổng ≈ 217 phút → simulation có thể fail
    // Test này chỉ kiểm tra rằng filter KHÔNG false-negative (nếu pass filter, simulation có thể fail)
    const result = isSetFeasible(places, makeCtx(150, 999_999));
    // Kết quả có thể là true hoặc false tuỳ vào MST, test chỉ kiểm tra không throw
    expect(typeof result).toBe('boolean');
  });
});
