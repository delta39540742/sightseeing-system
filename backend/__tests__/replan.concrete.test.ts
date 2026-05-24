/**
 * replan.concrete.test.ts
 *
 * Kiểm tra replan với dữ liệu cụ thể, thực tế (không mock):
 *  1. Bug: isFeasible() luôn return true — không lọc được plan vượt ngân sách/thời gian
 *  2. Bug: isSetFeasible() không kiểm tra budget
 *  3. Không có "Điểm dừng chân" bị chèn vào plan
 *  4. Tất cả plannedStart/plannedEnd phải là ISO-8601 hợp lệ và nằm trong khung 08:00–22:00 VN
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import { isSetFeasible, clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference } from '@app/types';

// ---------------------------------------------------------------------------
// Hằng số múi giờ — Vietnam UTC+7
// ---------------------------------------------------------------------------
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;

// ---------------------------------------------------------------------------
// Dữ liệu địa điểm thực tế Đà Nẵng
// (tọa độ gần đúng, giờ mở cửa điển hình)
// ---------------------------------------------------------------------------

const MUSEUM_CHAM: Place = {
  placeId: 1,
  name: 'Bảo tàng Điêu khắc Chăm',
  description: null,
  lat: 16.0611,
  lng: 108.2238,
  minPrice: 60_000,
  maxPrice: 60_000,
  priceType: 'fixed',
  avgVisitDurationMin: 90,
  parkingAvailable: true,
  wheelchairAccess: true,
  publicTransport: false,
  terrainEasiness: 1.0,
  roadAccessScore: null,
  spaciousness1km: null,
  popularityScore: null,
  indoorOutdoor: 'indoor',
  isLandmark: true,
  landmarkClassId: null,
  address: 'Đà Nẵng',
  images: [],
  tags: [{ tagId: 1, name: 'văn hóa', displayName: 'Văn hóa' }],
  openingHours: [
    { dayOfWeek: 1, openTime: '08:00', closeTime: '17:30' }, // Thứ 2
    { dayOfWeek: 2, openTime: '08:00', closeTime: '17:30' },
    { dayOfWeek: 3, openTime: '08:00', closeTime: '17:30' },
    { dayOfWeek: 4, openTime: '08:00', closeTime: '17:30' },
    { dayOfWeek: 5, openTime: '08:00', closeTime: '17:30' },
    { dayOfWeek: 6, openTime: '08:00', closeTime: '17:30' },
    { dayOfWeek: 0, openTime: '08:00', closeTime: '17:30' }, // Chủ nhật
  ],
};

const BRIDGE_RONG: Place = {
  placeId: 2,
  name: 'Cầu Rồng',
  description: null,
  lat: 16.0611,
  lng: 108.2275,
  minPrice: 0,
  maxPrice: 0,
  priceType: 'free',
  avgVisitDurationMin: 45,
  parkingAvailable: false,
  wheelchairAccess: true,
  publicTransport: false,
  terrainEasiness: 1.0,
  roadAccessScore: null,
  spaciousness1km: null,
  popularityScore: null,
  indoorOutdoor: 'outdoor',
  isLandmark: true,
  landmarkClassId: null,
  address: 'Đà Nẵng',
  images: [],
  tags: [{ tagId: 2, name: 'kiến trúc', displayName: 'Kiến trúc' }],
  openingHours: [],
};

const LINH_UNG_PAGODA: Place = {
  placeId: 3,
  name: 'Chùa Linh Ứng',
  description: null,
  lat: 16.1031,
  lng: 108.2759,
  minPrice: 0,
  maxPrice: 0,
  priceType: 'free',
  avgVisitDurationMin: 60,
  parkingAvailable: true,
  wheelchairAccess: false,
  publicTransport: false,
  terrainEasiness: 0.7,
  roadAccessScore: null,
  spaciousness1km: null,
  popularityScore: null,
  indoorOutdoor: 'outdoor',
  isLandmark: true,
  landmarkClassId: null,
  address: 'Đà Nẵng',
  images: [],
  tags: [{ tagId: 3, name: 'tâm linh', displayName: 'Tâm linh' }],
  openingHours: [],
};

const MY_KHE_BEACH: Place = {
  placeId: 4,
  name: 'Bãi biển Mỹ Khê',
  description: null,
  lat: 16.0489,
  lng: 108.2458,
  minPrice: 0,
  maxPrice: 0,
  priceType: 'free',
  avgVisitDurationMin: 120,
  parkingAvailable: true,
  wheelchairAccess: true,
  publicTransport: false,
  terrainEasiness: 1.0,
  roadAccessScore: null,
  spaciousness1km: null,
  popularityScore: null,
  indoorOutdoor: 'outdoor',
  isLandmark: false,
  landmarkClassId: null,
  address: 'Đà Nẵng',
  images: [],
  tags: [{ tagId: 4, name: 'biển', displayName: 'Biển' }],
  openingHours: [],
};

// Địa điểm "ngoại lai" — không phải tham quan, dùng để kiểm tra không bị chèn vào
const REST_STOP: Place = {
  placeId: 99,
  name: 'Điểm dừng chân quốc lộ 1A',
  description: null,
  lat: 16.0500,
  lng: 108.2200,
  minPrice: 0,
  maxPrice: 0,
  priceType: 'free',
  avgVisitDurationMin: 15,
  parkingAvailable: true,
  wheelchairAccess: true,
  publicTransport: false,
  terrainEasiness: 1.0,
  roadAccessScore: null,
  spaciousness1km: null,
  popularityScore: null,
  indoorOutdoor: 'outdoor',
  isLandmark: false,
  landmarkClassId: null,
  address: 'Đà Nẵng',
  images: [],
  tags: [],
  openingHours: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlot(overrides: Partial<TripSlot> & { placeId: number }): TripSlot {
  return {
    slotId: `slot-${overrides.placeId}-${Date.now()}`,
    tripId: 'trip-concrete-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN Thứ 3
    plannedEnd: '2026-04-21T03:30:00.000Z',   // 10:30 VN
    actualStart: null,
    actualEnd: null,
    estimatedCost: 60_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makeInitialState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-concrete-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 600,         // 10 giờ còn lại
    budgetRemaining: 2_000_000,    // 2 triệu VND
    fatigue: 0.1,
    currentLat: 16.0611,
    currentLng: 108.2238,
    moodProxy: 0.7,
    capturedAt: '2026-04-21T01:00:00.000Z', // 08:00 VN
    source: 'planned',
    ...overrides,
  };
}

const USER: UserPreference = {
  userId: 'user-concrete',
  preferenceVector: [0.8, 0.2, 0.1, 0.5, 0.3, 0.7, 0.4, 0.2, 0.6, 0.1],
  pace: 0.6,
  mobilityRestrictions: [],
};

function makeCtx(overrides: Partial<ReplanContext> = {}): ReplanContext {
  const allPlaces = [MUSEUM_CHAM, BRIDGE_RONG, LINH_UNG_PAGODA, MY_KHE_BEACH, REST_STOP];
  const placeMap = new Map(allPlaces.map(p => [p.placeId, p]));
  return {
    candidatePool: allPlaces,
    placeMap,
    user: USER,
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeInitialState(),
    ...overrides,
  };
}

/** Kiểm tra ISO-8601 hợp lệ và nằm trong khung 08:00–22:00 VN */
function assertValidSlotTimes(slot: TripSlot, label: string) {
  const startMs = new Date(slot.plannedStart).getTime();
  const endMs = new Date(slot.plannedEnd).getTime();

  expect(isNaN(startMs), `${label}: plannedStart phải là date hợp lệ`).toBe(false);
  expect(isNaN(endMs), `${label}: plannedEnd phải là date hợp lệ`).toBe(false);
  expect(endMs, `${label}: plannedEnd phải sau plannedStart`).toBeGreaterThan(startMs);

  // Chuyển sang giờ VN
  const startLocal = new Date(startMs + VN_OFFSET_MS);
  const endLocal = new Date(endMs + VN_OFFSET_MS);
  const startHour = startLocal.getUTCHours() + startLocal.getUTCMinutes() / 60;
  const endHour = endLocal.getUTCHours() + endLocal.getUTCMinutes() / 60;

  expect(
    startHour,
    `${label}: plannedStart (${slot.plannedStart}) phải >= 08:00 VN, thực tế = ${startHour.toFixed(2)}h VN`
  ).toBeGreaterThanOrEqual(DAY_START_HOUR);

  expect(
    endHour,
    `${label}: plannedEnd (${slot.plannedEnd}) phải <= 22:00 VN, thực tế = ${endHour.toFixed(2)}h VN`
  ).toBeLessThanOrEqual(DAY_END_HOUR);
}

/** Đảm bảo không có slot nào có tên chứa "dừng chân" hoặc "rest stop" */
function assertNoRestStop(plan: TripSlot[], candidatePool: Place[], label: string) {
  for (const slot of plan) {
    const place = candidatePool.find(p => p.placeId === slot.placeId);
    if (!place) continue;
    const name = place.name.toLowerCase();
    expect(
      name.includes('dừng chân') || name.includes('rest stop'),
      `${label}: plan chứa địa điểm ngoại lai "${place.name}"`
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bug 1 — isFeasible() luôn return true (stub)', () => {
  const evolver = new StateEvolver();

  it('[BUG] isFeasible không phát hiện timeRemainingMin âm', () => {
    const badState = makeInitialState({ timeRemainingMin: -10 });
    // Kết quả thực tế (sau khi fix phải là false):
    const result = evolver.isFeasible(badState);
    // TEST PHÁT HIỆN BUG: isFeasible phải trả về false nhưng hiện tại trả về true
    expect(result, 'isFeasible phải false khi timeRemainingMin < 0').toBe(false);
  });

  it('[BUG] isFeasible không phát hiện budgetRemaining âm', () => {
    const badState = makeInitialState({ budgetRemaining: -1 });
    const result = evolver.isFeasible(badState);
    expect(result, 'isFeasible phải false khi budgetRemaining < 0').toBe(false);
  });

  it('[BUG] isFeasible không phát hiện fatigue > 0.95', () => {
    const badState = makeInitialState({ fatigue: 0.96 });
    const result = evolver.isFeasible(badState);
    expect(result, 'isFeasible phải false khi fatigue > 0.95').toBe(false);
  });

  it('[BUG] isPlanFeasible không dừng khi ngân sách cạn kiệt hoàn toàn', () => {
    // Budget chỉ có 50_000 nhưng slot tốn 60_000 — phải infeasible
    const tightCtx = makeCtx({
      initialState: makeInitialState({ budgetRemaining: 50_000, timeRemainingMin: 600 }),
    });
    const plan: TripSlot[] = [
      makeSlot({ placeId: 1, slotOrder: 0, estimatedCost: 60_000 }), // Bảo tàng Chăm
    ];

    // Vì isFeasible luôn true, isPlanFeasible cũng luôn true — đây là bug
    const result = evolver.isPlanFeasible(plan, tightCtx.initialState, tightCtx);
    expect(result, 'isPlanFeasible phải false khi chi phí > budgetRemaining').toBe(false);
  });
});

describe('Bug 2 — isSetFeasible() không kiểm tra budget', () => {
  beforeEach(() => clearSetFeasibilityCache());

  it('[BUG] isSetFeasible pass dù tổng minPrice vượt budgetRemaining', () => {
    // Budget chỉ 50_000 VND, nhưng MUSEUM_CHAM có minPrice = 60_000
    const tightCtx = makeCtx({
      initialState: makeInitialState({ budgetRemaining: 50_000 }),
    });

    const result = isSetFeasible([MUSEUM_CHAM], tightCtx);
    expect(result, 'isSetFeasible phải false khi lbCost > budgetRemaining').toBe(false);
  });

  it('[BUG] isSetFeasible pass dù tổng 3 địa điểm vượt budget', () => {
    // Budget 100_000, MUSEUM_CHAM = 60_000 → tổng = 60_000 > 50_000 nhưng < 100_000, OK
    // Thêm scenario rõ ràng hơn: budget 50_000, 2 địa điểm miễn phí + 1 có giá 60_000
    const tightCtx = makeCtx({
      initialState: makeInitialState({ budgetRemaining: 50_000 }),
    });

    // BRIDGE_RONG (free) + MUSEUM_CHAM (60_000) = 60_000 > 50_000
    const result = isSetFeasible([BRIDGE_RONG, MUSEUM_CHAM], tightCtx);
    expect(result, 'isSetFeasible phải false khi lbCost > budgetRemaining').toBe(false);
  });
});

describe('Concrete replan — dữ liệu Đà Nẵng 3 slot', () => {
  let evolver: StateEvolver;
  let ops: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    ops = new MutationOperators(evolver);
  });

  // Kế hoạch cơ sở: 3 địa điểm ngày 0
  // 09:00–10:30 Bảo tàng Chăm | 11:00–11:45 Cầu Rồng | 12:30–14:30 Bãi Mỹ Khê
  function makeBasePlan(): TripSlot[] {
    return [
      makeSlot({
        placeId: 1, slotOrder: 0,
        plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
        plannedEnd: '2026-04-21T03:30:00.000Z',   // 10:30 VN
        estimatedCost: 60_000,
      }),
      makeSlot({
        placeId: 2, slotOrder: 1,
        plannedStart: '2026-04-21T04:00:00.000Z', // 11:00 VN
        plannedEnd: '2026-04-21T04:45:00.000Z',   // 11:45 VN
        estimatedCost: 0,
      }),
      makeSlot({
        placeId: 4, slotOrder: 2,
        plannedStart: '2026-04-21T05:30:00.000Z', // 12:30 VN
        plannedEnd: '2026-04-21T07:30:00.000Z',   // 14:30 VN
        estimatedCost: 0,
      }),
    ];
  }

  it('Tất cả slot trong kế hoạch gốc có giờ hợp lệ', () => {
    const plan = makeBasePlan();
    for (const slot of plan) {
      assertValidSlotTimes(slot, `slot placeId=${slot.placeId}`);
    }
  });

  it('repairSuffix: output có giờ hợp lệ (08:00–22:00 VN)', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const repaired = ops['repairSuffix'](plan, 0, ctx);

    expect(repaired, 'repairSuffix không được trả về null').not.toBeNull();
    for (const slot of repaired!) {
      assertValidSlotTimes(slot, `repaired placeId=${slot.placeId}`);
    }
  });

  it('timeShift: không tạo slot trước 08:00 hoặc sau 22:00 VN', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.timeShift(plan, ctx);

    for (const r of results) {
      for (const slot of r.newPlan) {
        assertValidSlotTimes(slot, `timeShift result placeId=${slot.placeId}`);
      }
    }
  });

  it('swapOrder: output có giờ hợp lệ', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.swapOrder(plan, ctx);

    for (const r of results) {
      for (const slot of r.newPlan) {
        assertValidSlotTimes(slot, `swapOrder result placeId=${slot.placeId}`);
      }
    }
  });

  it('insertAlt: không chèn "Điểm dừng chân" vào plan', () => {
    const plan = makeBasePlan();
    // candidatePool có cả REST_STOP (placeId=99) — phải không bị chèn vào
    const ctx = makeCtx();
    const results = ops.insertAlt(plan, ctx);

    for (const r of results) {
      assertNoRestStop(r.newPlan, ctx.candidatePool, 'insertAlt');
    }
  });

  it('insertAlt: output có giờ hợp lệ khi chèn Chùa Linh Ứng (placeId=3)', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx({ forceIncludePlaceId: 3 }); // ép chèn Chùa Linh Ứng
    const results = ops.insertAlt(plan, ctx);

    // Phải có ít nhất 1 kết quả
    expect(results.length, 'insertAlt(forceInclude=3) phải tìm được ít nhất 1 cách chèn').toBeGreaterThan(0);

    for (const r of results) {
      for (const slot of r.newPlan) {
        assertValidSlotTimes(slot, `insertAlt(placeId=3) result placeId=${slot.placeId}`);
      }
      // Chùa Linh Ứng phải có mặt trong plan
      expect(
        r.newPlan.some(s => s.placeId === 3),
        'Plan sau insertAlt phải chứa placeId=3 (Chùa Linh Ứng)'
      ).toBe(true);
    }
  });

  it('dropSlot: output không chứa slot bị xoá và giờ vẫn hợp lệ', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.dropSlot(plan, ctx);

    for (const r of results) {
      // Mỗi kết quả phải có ít hơn plan ban đầu 1 slot
      expect(r.newPlan.length, 'dropSlot phải giảm số slot đúng 1').toBe(plan.length - 1);
      for (const slot of r.newPlan) {
        assertValidSlotTimes(slot, `dropSlot result placeId=${slot.placeId}`);
      }
    }
  });

  it('replacePlace: địa điểm mới không phải Điểm dừng chân', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.replacePlace(plan, ctx);

    for (const r of results) {
      assertNoRestStop(r.newPlan, ctx.candidatePool, 'replacePlace');
    }
  });

  it('generateAll: tất cả kết quả có giờ hợp lệ và không có Điểm dừng chân', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.generateAll(plan, ctx);

    // Phải tạo ra ít nhất 1 phương án
    expect(results.length, 'generateAll phải tạo ra ít nhất 1 phương án').toBeGreaterThan(0);

    for (const r of results) {
      assertNoRestStop(r.newPlan, ctx.candidatePool, `generateAll op=${r.operator}`);
      for (const slot of r.newPlan) {
        assertValidSlotTimes(slot, `generateAll op=${r.operator} placeId=${slot.placeId}`);
      }
    }
  });

  it('generateAll: slotOrder trong mỗi ngày phải tăng dần từ 0', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.generateAll(plan, ctx);

    for (const r of results) {
      const byDay = new Map<number, number[]>();
      for (const slot of r.newPlan) {
        if (!byDay.has(slot.dayIndex)) byDay.set(slot.dayIndex, []);
        byDay.get(slot.dayIndex)!.push(slot.slotOrder);
      }
      for (const [dayIdx, orders] of byDay) {
        const sorted = [...orders].sort((a, b) => a - b);
        expect(
          sorted[0],
          `op=${r.operator} dayIndex=${dayIdx}: slotOrder đầu tiên phải là 0`
        ).toBe(0);
        for (let i = 1; i < sorted.length; i++) {
          expect(
            sorted[i],
            `op=${r.operator} dayIndex=${dayIdx}: slotOrder[${i}] phải là ${i}`
          ).toBe(i);
        }
      }
    }
  });

  it('generateAll: plannedEnd luôn sau plannedStart trong cùng slot', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.generateAll(plan, ctx);

    for (const r of results) {
      for (const slot of r.newPlan) {
        const start = new Date(slot.plannedStart).getTime();
        const end = new Date(slot.plannedEnd).getTime();
        expect(
          end,
          `op=${r.operator} placeId=${slot.placeId}: plannedEnd phải > plannedStart`
        ).toBeGreaterThan(start);
      }
    }
  });

  it('generateAll: không có 2 slot trùng placeId trong plan mới', () => {
    const plan = makeBasePlan();
    const ctx = makeCtx();
    const results = ops.generateAll(plan, ctx);

    for (const r of results) {
      const placeIds = r.newPlan.map(s => s.placeId);
      const uniqueIds = new Set(placeIds);
      expect(
        uniqueIds.size,
        `op=${r.operator}: plan có placeId trùng lặp: [${placeIds.join(', ')}]`
      ).toBe(placeIds.length);
    }
  });
});

describe('Concrete replan — kiểm tra ngân sách cạn kiệt', () => {
  let evolver: StateEvolver;
  let ops: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    ops = new MutationOperators(evolver);
  });

  it('generateAll với budget 100_000: không tạo plan có chi phí > budget', () => {
    const tightCtx = makeCtx({
      initialState: makeInitialState({ budgetRemaining: 100_000, timeRemainingMin: 600 }),
    });

    const plan: TripSlot[] = [
      makeSlot({ placeId: 2, slotOrder: 0, estimatedCost: 0 }),  // Cầu Rồng (miễn phí)
      makeSlot({ placeId: 4, slotOrder: 1, estimatedCost: 0 }),  // Bãi Mỹ Khê (miễn phí)
    ];

    const results = ops.generateAll(plan, tightCtx);

    for (const r of results) {
      const totalCost = r.newPlan.reduce((s, slot) => s + (slot.estimatedCost ?? 0), 0);
      // Nếu isFeasible và isSetFeasible hoạt động đúng, totalCost phải <= budget
      // Với bug hiện tại, có thể có plan MUSEUM_CHAM (60_000) vượt budget 100_000 khi cộng với các slot khác
      // Nhưng test này kiểm tra behaviour đúng: phải từ chối plan > budget
      expect(
        totalCost,
        `op=${r.operator}: tổng chi phí ${totalCost} vượt budget 100_000`
      ).toBeLessThanOrEqual(100_000);
    }
  });
});

describe('Concrete replan — kịch bản thực: trip 2 ngày', () => {
  let evolver: StateEvolver;
  let ops: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    ops = new MutationOperators(evolver);
  });

  it('repairSuffix khi slot từ ngày 0 tràn sang ngày 1: dayIndex tăng đúng', () => {
    // Slot bắt đầu 21:30 VN (14:30 UTC) với duration 90 phút → kết thúc 23:00
    // Nếu slot tiếp theo không vừa trong ngày, phải dời sang ngày hôm sau 08:00
    const plan: TripSlot[] = [
      makeSlot({
        placeId: 1, dayIndex: 0, slotOrder: 0,
        plannedStart: '2026-04-21T14:30:00.000Z', // 21:30 VN
        plannedEnd: '2026-04-21T16:00:00.000Z',   // 23:00 VN
        estimatedCost: 60_000,
      }),
      makeSlot({
        placeId: 2, dayIndex: 0, slotOrder: 1,
        plannedStart: '2026-04-21T16:30:00.000Z', // 23:30 VN — quá muộn!
        plannedEnd: '2026-04-21T17:15:00.000Z',   // 00:15 ngày hôm sau VN
        estimatedCost: 0,
      }),
    ];

    const ctx = makeCtx({
      initialState: makeInitialState({
        capturedAt: '2026-04-21T01:00:00.000Z', // 08:00 VN
        timeRemainingMin: 600,
      }),
    });

    const repaired = ops['repairSuffix'](plan, 1, ctx);
    // repairSuffix có thể trả về null (infeasible) hoặc dời slot sang ngày hôm sau
    if (repaired !== null) {
      const secondSlot = repaired[1]!;
      // Nếu không null, slot thứ 2 phải hợp lệ về thời gian
      assertValidSlotTimes(secondSlot, 'repairSuffix overflow slot');
      // Nếu bị dời sang ngày hôm sau, dayIndex phải tăng lên 1
      if (secondSlot.dayIndex > 0) {
        const startVN = new Date(new Date(secondSlot.plannedStart).getTime() + VN_OFFSET_MS);
        expect(
          startVN.getUTCHours(),
          'Slot dời sang ngày hôm sau phải bắt đầu lúc 08:00 VN'
        ).toBe(8);
      }
    }
    // null cũng là kết quả hợp lệ (infeasible — không tạo ra plan xấu)
  });
});
