/**
 * replan.trip-context.test.ts
 *
 * Test tập trung vào ràng buộc ngữ cảnh chuyến đi (trip context constraints):
 *   - Không tạo slot vượt quá số ngày trip (maxAllowedDayIndex)
 *   - Cursor trước chuyến đi (pre-trip) không làm tăng dayIndex sai
 *   - Mọi mutation operator (timeShift, swapOrder, dropSlot, insertAlt, replacePlace, tspReorder)
 *     đều tôn trọng ràng buộc ngày
 *   - BeamSearch end-to-end không tạo slot ngoài phạm vi trip
 *
 * Quy ước thời gian trong test:
 *   - "Day 0" = April 21, 2026 VN   (UTC+7 → 08:00 VN = 01:00 UTC)
 *   - "Day 1" = April 22, 2026 VN
 *   - "Day 2" = April 23, 2026 VN
 *   - Ngưỡng tràn (maxOverflow): 22:30 VN = 15:30 UTC
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchContext,
} from '../src/replanner/BeamSearch';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type {
  TripSlot,
  Place,
  TripState,
  UserPreference,
  ObjectiveWeights,
} from '@app/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Vietnam UTC+7 offset
const VN_MS = 7 * 60 * 60 * 1000;

// Day 0 timestamps (UTC)
const D0_08_VN = '2026-04-21T01:00:00.000Z'; // 08:00 VN April 21
const D0_10_VN = '2026-04-21T03:00:00.000Z'; // 10:00 VN
const D0_18_VN = '2026-04-21T11:00:00.000Z'; // 18:00 VN
const D0_20_VN = '2026-04-21T13:00:00.000Z'; // 20:00 VN
const D0_21_VN = '2026-04-21T14:00:00.000Z'; // 21:00 VN
const D0_2130_VN = '2026-04-21T14:30:00.000Z'; // 21:30 VN
const D0_22_VN = '2026-04-21T15:00:00.000Z'; // 22:00 VN
const D0_23_VN = '2026-04-21T16:00:00.000Z'; // 23:00 VN (past day-end)

// Day 1 timestamps (UTC)
const D1_08_VN = '2026-04-22T01:00:00.000Z'; // 08:00 VN April 22
const D1_09_VN = '2026-04-22T02:00:00.000Z'; // 09:00 VN
const D1_10_VN = '2026-04-22T03:00:00.000Z'; // 10:00 VN
const D1_21_VN = '2026-04-22T14:00:00.000Z'; // 21:00 VN
const D1_2130_VN = '2026-04-22T14:30:00.000Z'; // 21:30 VN
const D1_22_VN = '2026-04-22T15:00:00.000Z'; // 22:00 VN

// Pre-trip cursor (2 days before Day 0)
const PRE_TRIP = '2026-04-19T01:00:00.000Z'; // 08:00 VN April 19

// Day 2 timestamps (UTC)
const D2_08_VN = '2026-04-23T01:00:00.000Z'; // 08:00 VN April 23

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let placeIdCounter = 0;

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: ++placeIdCounter,
    name: `Place-${placeIdCounter}`,
    description: null,
    lat: 16.06,
    lng: 108.22,
    minPrice: 0,
    maxPrice: null,
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
    slotId: `slot-${Math.random().toString(36).slice(2, 9)}`,
    tripId: 'trip-ctx-test',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: D0_08_VN,
    plannedEnd: D0_10_VN,
    actualStart: null,
    actualEnd: null,
    estimatedCost: 0,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-ctx-test',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 720,
    budgetRemaining: 2_000_000,
    fatigue: 0.1,
    currentLat: 16.06,
    currentLng: 108.22,
    moodProxy: 0.7,
    capturedAt: D0_08_VN,
    source: 'simulated',
    ...overrides,
  };
}

const ZERO_WEIGHTS: ObjectiveWeights = {
  wInterest: 0, wPace: 0, wDistance: 0, wBudget: 0,
  wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0,
  wProximity: 0, wSynergy: 0,
};

const DEFAULT_USER: UserPreference = {
  preferenceVector: new Array(10).fill(0.1),
  pace: 0.5,
  mobilityRestrictions: [],
};

function makeCtx(
  places: Place[],
  slots: TripSlot[],
  stateOverrides: Partial<TripState> = {},
): BeamSearchContext {
  const placeMap = new Map(places.map((p) => [p.placeId, p]));
  return {
    remainingSlots: slots,
    initialState: makeState(stateOverrides),
    candidatePool: places,
    placeMap,
    user: DEFAULT_USER,
    weights: ZERO_WEIGHTS,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
  };
}

function makeRepairCtx(
  places: Place[],
  stateOverrides: Partial<TripState> = {},
): ReplanContext {
  const placeMap = new Map(places.map((p) => [p.placeId, p]));
  return {
    candidatePool: places,
    placeMap,
    initialState: makeState(stateOverrides),
    user: DEFAULT_USER,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
  };
}

// ---------------------------------------------------------------------------
// Group C1: Trip 1 ngày (maxAllowedDayIndex = 0)
// ---------------------------------------------------------------------------

describe('Group C1: Trip 1 ngày — maxAllowedDayIndex = 0', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  it('C1.1 — Các slot vừa trong ngày 0 không bị từ chối', () => {
    // 2 slot, cùng địa điểm (không tốn thời gian di chuyển)
    // slot A: 08:00–09:00 VN, slot B: 09:00–10:00 VN
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slotA = makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN });
    const slotB = makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_10_VN, plannedEnd: D0_18_VN, slotOrder: 1 });

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix']([slotA, slotB], 0, ctx as any);

    expect(result, 'repairSuffix phải trả về kết quả hợp lệ').not.toBeNull();
    for (const s of result!) {
      expect(s.dayIndex, `dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
    }
  });

  it('C1.2 — Slot tràn sang ngày 1 → phải trả về null (vi phạm trip boundary)', () => {
    // slot A: 20:00–21:00 VN, slot B: 21:30–23:00 VN (tràn 22:30 giới hạn)
    // → repairSuffix cần đẩy slot B sang 08:00 ngày 1 → dayIndex=1 > maxAllowedDayIndex=0 → null
    const place = makePlace({ avgVisitDurationMin: 90 });
    const slotA = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_20_VN, plannedEnd: D0_21_VN,
    });
    const slotB = makeSlot({
      placeId: place.placeId, dayIndex: 0, slotOrder: 1,
      plannedStart: D0_2130_VN, plannedEnd: D0_23_VN, // kết thúc 23:00 > 22:30 giới hạn
    });

    const ctx = makeRepairCtx([place], { capturedAt: D0_20_VN });
    const result = operators['repairSuffix']([slotA, slotB], 1, ctx as any);

    // cursor sau slotA = 21:00 VN; slot B bắt đầu 21:30 VN, dur=90min → kết thúc 23:00 → tràn
    expect(result).toBeNull();
  });

  it('C1.3 — Slot kết thúc đúng 22:00 VN (giới hạn maxOverflow=30min) → không bị từ chối', () => {
    // dur=60min bắt đầu 21:00 VN → kết thúc 22:00 VN = trong giới hạn cho phép
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_21_VN, plannedEnd: D0_22_VN,
    });

    const ctx = makeRepairCtx([place], { capturedAt: D0_21_VN });
    const result = operators['repairSuffix']([slot], 0, ctx as any);

    expect(result, 'Slot kết thúc đúng 22:00 VN phải hợp lệ').not.toBeNull();
    expect(result![0]!.dayIndex).toBe(0);
  });

  it('C1.4 — generateAll không trả về kết quả nào có dayIndex > 0', () => {
    // Plan 2 slot gần cuối ngày → một số mutations có thể tràn → phải bị lọc
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slotA = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_20_VN, plannedEnd: D0_21_VN,
    });
    const slotB = makeSlot({
      placeId: place.placeId, dayIndex: 0, slotOrder: 1,
      plannedStart: D0_21_VN, plannedEnd: D0_22_VN,
    });

    const ctx = makeCtx([place], [slotA, slotB], {
      capturedAt: D0_08_VN,
      budgetRemaining: 5_000_000,
      timeRemainingMin: 840,
    });

    const mutations = operators.generateAll([slotA, slotB], ctx as any);
    for (const mut of mutations) {
      for (const slot of mut.newPlan) {
        expect(
          slot.dayIndex,
          `Mutation ${mut.operator}: slot placeId=${slot.placeId} có dayIndex=${slot.dayIndex} vượt ngày cuối (0)`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group C2: Trip 2 ngày (maxAllowedDayIndex = 1)
// ---------------------------------------------------------------------------

describe('Group C2: Trip 2 ngày — maxAllowedDayIndex = 1', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  it('C2.1 — Slot ngày 0 tràn sang ngày 1 được chấp nhận khi trip có 2 ngày', () => {
    // slot A: 20:00–21:00 VN day 0, slot B: 21:30–? VN day 0 (dur=90 → tràn)
    // dummyDay1: slot giữ chỗ dayIndex=1 → maxAllowedDayIndex=1
    const place = makePlace({ avgVisitDurationMin: 90 });
    const slotA = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_20_VN, plannedEnd: D0_21_VN,
      slotOrder: 0,
    });
    const slotB = makeSlot({
      placeId: place.placeId, dayIndex: 0, slotOrder: 1,
      plannedStart: D0_2130_VN, plannedEnd: D0_23_VN,
    });
    const dummyDay1 = makeSlot({
      placeId: place.placeId, dayIndex: 1, slotOrder: 0,
      plannedStart: D1_10_VN, plannedEnd: D1_22_VN,
    });

    const ctx = makeRepairCtx([place], { capturedAt: D0_20_VN });
    // Repair suffix từ slotB (index 1) — cursor = slotA end = 21:00 VN
    const result = operators['repairSuffix']([slotA, slotB, dummyDay1], 1, ctx as any);

    expect(result, 'repairSuffix trip 2 ngày không được null khi tràn hợp lệ').not.toBeNull();
    for (const s of result!) {
      expect(
        s.dayIndex,
        `dayIndex=${s.dayIndex} vượt maxAllowedDayIndex=1`,
      ).toBeLessThanOrEqual(1);
    }
    // slotB phải được đẩy sang day 1 (do tràn)
    const repairedSlotB = result!.find((s) => s.slotId === slotB.slotId);
    expect(repairedSlotB?.dayIndex, 'slotB phải được đẩy sang day 1').toBe(1);
  });

  it('C2.2 — Slot ngày 1 tràn sang ngày 2 → phải trả về null', () => {
    // slot A: day 1 bình thường; slot B: 21:30 VN day 1, dur=90min → tràn sang day 2
    // maxAllowedDayIndex=1 → null
    const place = makePlace({ avgVisitDurationMin: 90 });
    const slotA = makeSlot({
      placeId: place.placeId, dayIndex: 1,
      plannedStart: D1_08_VN, plannedEnd: D1_09_VN,
      slotOrder: 0,
    });
    const slotB = makeSlot({
      placeId: place.placeId, dayIndex: 1, slotOrder: 1,
      plannedStart: D1_2130_VN, plannedEnd: D1_22_VN, // khởi điểm 21:30 + dur 90min → 23:00 VN
    });

    const ctx = makeRepairCtx([place], {
      capturedAt: D1_08_VN,
    });
    // Repair suffix từ slotB (index 1); cursor = slotA.plannedEnd = 09:00 VN day 1
    const result = operators['repairSuffix']([slotA, slotB], 1, ctx as any);

    expect(result).toBeNull();
  });

  it('C2.3 — Các slot trải đều qua 2 ngày được sắp xếp đúng', () => {
    const place = makePlace({ avgVisitDurationMin: 120 });
    const slotA = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_08_VN, plannedEnd: D0_10_VN,
    });
    const slotB = makeSlot({
      placeId: place.placeId, dayIndex: 1, slotOrder: 0,
      plannedStart: D1_08_VN, plannedEnd: D1_10_VN,
    });

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix']([slotA, slotB], 0, ctx as any);

    expect(result).not.toBeNull();
    expect(result![0]!.dayIndex).toBe(0);
    expect(result![1]!.dayIndex).toBe(1);
    // Mỗi ngày phải có slotOrder bắt đầu từ 0
    expect(result![0]!.slotOrder).toBe(0);
    expect(result![1]!.slotOrder).toBe(0);
  });

  it('C2.4 — slotOrder tăng dần trong cùng một ngày sau repair', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slots = [
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_10_VN, plannedEnd: D0_18_VN, slotOrder: 1 }),
      makeSlot({ placeId: place.placeId, dayIndex: 1, plannedStart: D1_08_VN, plannedEnd: D1_09_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 1, plannedStart: D1_09_VN, plannedEnd: D1_10_VN, slotOrder: 1 }),
    ];

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix'](slots, 0, ctx as any);

    expect(result).not.toBeNull();
    const byDay = new Map<number, number[]>();
    for (const s of result!) {
      if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
      byDay.get(s.dayIndex)!.push(s.slotOrder);
    }
    for (const [day, orders] of byDay) {
      for (let i = 0; i < orders.length; i++) {
        expect(
          orders[i],
          `dayIndex=${day}: slotOrder[${i}]=${orders[i]} không đơn điệu tăng`,
        ).toBe(i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group C3: Pre-trip cursor (capturedAt trước ngày bắt đầu chuyến đi)
// ---------------------------------------------------------------------------

describe('Group C3: Pre-trip cursor — capturedAt trước chuyến đi', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  it('C3.1 — Trip 1 ngày, cursor 2 ngày trước → không tạo ra dayIndex > 0', () => {
    // BUG cũ (trước fix): dayJump = April 21 - April 19 = 2 → currentDayIndex = 2 → null sai
    // Fix: tripStartVNDay clamp → cursorVNDay = April 21 → dayJump = 0 → OK
    const place = makePlace({ avgVisitDurationMin: 120 });
    const slot = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_08_VN, // 08:00 VN ngày trip
      plannedEnd: D0_10_VN,
    });

    const ctx = makeRepairCtx([place], {
      capturedAt: PRE_TRIP, // 2 ngày TRƯỚC trip
    });
    const result = operators['repairSuffix']([slot], 0, ctx as any);

    expect(result, 'Pre-trip cursor không được làm null kế hoạch hợp lệ').not.toBeNull();
    expect(result![0]!.dayIndex).toBe(0);
  });

  it('C3.2 — Trip 2 ngày, cursor 2 ngày trước → dayIndex tiến đúng theo thứ tự tự nhiên', () => {
    // Slot 0: ngày 0 của trip (April 21), slot 1: ngày 1 của trip (April 22)
    // capturedAt = April 19 (2 ngày trước)
    // Sau fix: slot 0 = dayIndex 0, slot 1 = dayIndex 1 — tiến đúng vì natural scheduling
    const place = makePlace({ avgVisitDurationMin: 120 });
    const slotDay0 = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_08_VN, plannedEnd: D0_10_VN,
    });
    const slotDay1 = makeSlot({
      placeId: place.placeId, dayIndex: 1, slotOrder: 0,
      plannedStart: D1_08_VN, plannedEnd: D1_10_VN,
    });

    const ctx = makeRepairCtx([place], {
      capturedAt: PRE_TRIP,
    });
    const result = operators['repairSuffix']([slotDay0, slotDay1], 0, ctx as any);

    expect(result, 'Trip 2 ngày với pre-trip cursor không được null').not.toBeNull();
    expect(result![0]!.dayIndex).toBe(0);
    expect(result![1]!.dayIndex).toBe(1);
  });

  it('C3.3 — Trip 1 ngày, cursor ngay trước đêm trip (23:00 VN ngày trước) → không bị coi là ngày mới', () => {
    // capturedAt = April 20 16:00 UTC = 23:00 VN April 20 (1 tiếng trước trip bắt đầu)
    // rawCursorVNDay = April 20 VN day → tripStartVNDay = April 21 VN day → clamp
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slot = makeSlot({
      placeId: place.placeId, dayIndex: 0,
      plannedStart: D0_08_VN, plannedEnd: D0_10_VN,
    });

    const ctx = makeRepairCtx([place], {
      capturedAt: '2026-04-20T16:00:00.000Z', // 23:00 VN April 20
    });
    const result = operators['repairSuffix']([slot], 0, ctx as any);

    expect(result, 'Cursor đêm trước trip không được làm null kế hoạch').not.toBeNull();
    expect(result![0]!.dayIndex).toBe(0);
  });

  it('C3.4 — Trip 3 ngày, cursor 3 ngày trước → đầy đủ 3 ngày vẫn được lên lịch đúng', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const slotDay0 = makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN });
    const slotDay1 = makeSlot({ placeId: place.placeId, dayIndex: 1, slotOrder: 0, plannedStart: D1_08_VN, plannedEnd: D1_09_VN });
    const slotDay2 = makeSlot({ placeId: place.placeId, dayIndex: 2, slotOrder: 0, plannedStart: D2_08_VN, plannedEnd: '2026-04-23T02:00:00.000Z' });

    const ctx = makeRepairCtx([place], {
      capturedAt: '2026-04-18T01:00:00.000Z', // 08:00 VN April 18 — 3 ngày trước
    });
    const result = operators['repairSuffix']([slotDay0, slotDay1, slotDay2], 0, ctx as any);

    expect(result).not.toBeNull();
    expect(result!.map((s) => s.dayIndex)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Group C4: Tất cả mutation operators tôn trọng ràng buộc ngày
// ---------------------------------------------------------------------------

describe('Group C4: Mọi mutation operator — không vượt maxAllowedDayIndex', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  /**
   * Tạo plan 1 ngày (maxAllowedDayIndex=0) với 3 slot ở vị trí khác nhau trong ngày.
   * Thêm 2 candidate pool để REPLACE_PLACE và INSERT_ALT có ứng viên.
   */
  function makeOneDayPlanCtx() {
    const placeA = makePlace({ placeId: 10, avgVisitDurationMin: 60, lat: 16.06, lng: 108.22 });
    const placeB = makePlace({ placeId: 11, avgVisitDurationMin: 60, lat: 16.07, lng: 108.23 });
    const placeC = makePlace({ placeId: 12, avgVisitDurationMin: 60, lat: 16.05, lng: 108.21 });
    const altPlace = makePlace({
      placeId: 13, avgVisitDurationMin: 60, lat: 16.08, lng: 108.24,
      tags: [{ tagId: 1, name: 'culture', displayName: 'Văn hoá' }],
    });
    const places = [placeA, placeB, placeC, altPlace];
    const placeMap = new Map(places.map((p) => [p.placeId, p]));

    const slotA = makeSlot({
      slotId: 'ctx-a', placeId: placeA.placeId, dayIndex: 0, slotOrder: 0,
      plannedStart: D0_08_VN, plannedEnd: D0_10_VN,
    });
    const slotB = makeSlot({
      slotId: 'ctx-b', placeId: placeB.placeId, dayIndex: 0, slotOrder: 1,
      plannedStart: D0_10_VN, plannedEnd: D0_18_VN,
    });
    const slotC = makeSlot({
      slotId: 'ctx-c', placeId: placeC.placeId, dayIndex: 0, slotOrder: 2,
      plannedStart: D0_18_VN, plannedEnd: D0_20_VN,
    });

    const ctx: BeamSearchContext = {
      remainingSlots: [slotA, slotB, slotC],
      initialState: makeState({ capturedAt: D0_08_VN, budgetRemaining: 5_000_000, timeRemainingMin: 840 }),
      candidatePool: places,
      placeMap,
      user: DEFAULT_USER,
      weights: ZERO_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
    return { ctx, plan: [slotA, slotB, slotC], places };
  }

  it('C4.1 — TIME_SHIFT: không tạo slot có dayIndex > 0', () => {
    const { ctx, plan } = makeOneDayPlanCtx();
    const results = operators.timeShift(plan, ctx as any);
    for (const mut of results) {
      for (const s of mut.newPlan) {
        expect(s.dayIndex, `TIME_SHIFT: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('C4.2 — SWAP_ORDER: không tạo slot có dayIndex > 0', () => {
    const { ctx, plan } = makeOneDayPlanCtx();
    const results = operators.swapOrder(plan, ctx as any);
    for (const mut of results) {
      for (const s of mut.newPlan) {
        expect(s.dayIndex, `SWAP_ORDER: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('C4.3 — DROP_SLOT: không tạo slot có dayIndex > 0', () => {
    const { ctx, plan } = makeOneDayPlanCtx();
    const results = operators.dropSlot(plan, ctx as any);
    for (const mut of results) {
      for (const s of mut.newPlan) {
        expect(s.dayIndex, `DROP_SLOT: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('C4.4 — TSP_REORDER: không tạo slot có dayIndex > 0', () => {
    const { ctx, plan } = makeOneDayPlanCtx();
    const results = operators.tspReorder(plan, ctx as any);
    for (const mut of results) {
      for (const s of mut.newPlan) {
        expect(s.dayIndex, `TSP_REORDER: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('C4.5 — generateAll: tất cả 6 operators kết hợp không tạo slot vượt ngày cuối', () => {
    const { ctx, plan } = makeOneDayPlanCtx();
    const mutations = operators.generateAll(plan, ctx as any);
    for (const mut of mutations) {
      const maxDayInPlan = Math.max(...plan.map((s) => s.dayIndex));
      for (const s of mut.newPlan) {
        expect(
          s.dayIndex,
          `${mut.operator}: slot placeId=${s.placeId} dayIndex=${s.dayIndex} > maxAllowedDayIndex=${maxDayInPlan}`,
        ).toBeLessThanOrEqual(maxDayInPlan);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Group C5: BeamSearch end-to-end tôn trọng ràng buộc ngày
// ---------------------------------------------------------------------------

describe('Group C5: BeamSearch end-to-end — plan đầu ra tôn trọng ngày trip', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;
  let scorer: ObjectiveScorer;
  let beamSearch: BeamSearch;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
    scorer = new ObjectiveScorer(evolver);
    beamSearch = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 4,
      maxIterations: 10,
      improvementThreshold: 0.001,
      latencyBudgetMs: 5000,
    });
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-21T01:00:00.000Z').getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('C5.1 — Trip 1 ngày: BeamSearch output không có slot dayIndex > 0', () => {
    const placeA = makePlace({ placeId: 20, avgVisitDurationMin: 90, lat: 16.06, lng: 108.22 });
    const placeB = makePlace({ placeId: 21, avgVisitDurationMin: 60, lat: 16.07, lng: 108.23 });
    const places = [placeA, placeB];

    const slots = [
      makeSlot({ slotId: 'bs-a', placeId: placeA.placeId, dayIndex: 0, slotOrder: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN }),
      makeSlot({ slotId: 'bs-b', placeId: placeB.placeId, dayIndex: 0, slotOrder: 1, plannedStart: D0_10_VN, plannedEnd: D0_18_VN }),
    ];

    const ctx = makeCtx(places, slots, {
      capturedAt: D0_08_VN,
      budgetRemaining: 5_000_000,
      timeRemainingMin: 840,
    });

    const { plan } = beamSearch.search(ctx);

    expect(plan.length).toBeGreaterThan(0);
    for (const s of plan) {
      expect(s.dayIndex, `BeamSearch 1 ngày: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
    }
  });

  it('C5.2 — Trip 2 ngày: BeamSearch output không có slot dayIndex > 1', () => {
    const placeA = makePlace({ placeId: 30, avgVisitDurationMin: 90, lat: 16.06, lng: 108.22 });
    const placeB = makePlace({ placeId: 31, avgVisitDurationMin: 60, lat: 16.07, lng: 108.23 });
    const places = [placeA, placeB];

    const slots = [
      makeSlot({ slotId: 'bs2-a', placeId: placeA.placeId, dayIndex: 0, slotOrder: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN }),
      makeSlot({ slotId: 'bs2-b', placeId: placeB.placeId, dayIndex: 0, slotOrder: 1, plannedStart: D0_10_VN, plannedEnd: D0_18_VN }),
      makeSlot({ slotId: 'bs2-c', placeId: placeA.placeId, dayIndex: 1, slotOrder: 0, plannedStart: D1_08_VN, plannedEnd: D1_09_VN }),
      makeSlot({ slotId: 'bs2-d', placeId: placeB.placeId, dayIndex: 1, slotOrder: 1, plannedStart: D1_09_VN, plannedEnd: D1_10_VN }),
    ];

    const ctx = makeCtx(places, slots, {
      capturedAt: D0_08_VN,
      budgetRemaining: 5_000_000,
      timeRemainingMin: 1440,
    });

    const { plan } = beamSearch.search(ctx);

    expect(plan.length).toBeGreaterThan(0);
    for (const s of plan) {
      expect(s.dayIndex, `BeamSearch 2 ngày: dayIndex=${s.dayIndex} vượt ngày cuối (1)`).toBeLessThanOrEqual(1);
    }
  });

  it('C5.3 — Trip 1 ngày với pre-trip cursor: BeamSearch output không có slot dayIndex > 0', () => {
    const place = makePlace({ placeId: 40, avgVisitDurationMin: 90 });
    const slots = [
      makeSlot({ slotId: 'bs3-a', placeId: place.placeId, dayIndex: 0, slotOrder: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN }),
    ];

    const ctx = makeCtx([place], slots, {
      capturedAt: PRE_TRIP, // cursor 2 ngày trước trip
      budgetRemaining: 5_000_000,
      timeRemainingMin: 720,
    });

    const { plan } = beamSearch.search(ctx);

    for (const s of plan) {
      expect(s.dayIndex, `BeamSearch pre-trip: dayIndex=${s.dayIndex} vượt ngày cuối (0)`).toBeLessThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Group C6: Bất biến ngữ cảnh (Context invariants)
// ---------------------------------------------------------------------------

describe('Group C6: Bất biến ngữ cảnh — plannedStart/plannedEnd nhất quán với dayIndex', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;

  beforeEach(() => {
    clearSetFeasibilityCache();
    placeIdCounter = 0;
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
  });

  it('C6.1 — plannedStart phải nằm trong khung ngày VN tương ứng với dayIndex', () => {
    // Chuyến đi bắt đầu April 21 VN (Day 0) và kết thúc April 23 VN (Day 2)
    // Mỗi slot phải có plannedStart trong đúng ngày VN tương ứng
    const place = makePlace({ avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 1, plannedStart: D1_08_VN, plannedEnd: D1_09_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 2, plannedStart: D2_08_VN, plannedEnd: '2026-04-23T02:00:00.000Z', slotOrder: 0 }),
    ];

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix'](plan, 0, ctx as any);

    expect(result).not.toBeNull();

    // Ngày VN bắt đầu của trip = April 21
    const tripStartVNDay = Math.floor((new Date(D0_08_VN).getTime() + VN_MS) / 86_400_000);

    for (const s of result!) {
      const slotVNDay = Math.floor((new Date(s.plannedStart).getTime() + VN_MS) / 86_400_000);
      const expectedVNDay = tripStartVNDay + s.dayIndex;
      expect(
        slotVNDay,
        `Slot dayIndex=${s.dayIndex}: plannedStart (${s.plannedStart}) VN day ${slotVNDay} ≠ expected ${expectedVNDay}`,
      ).toBe(expectedVNDay);
    }
  });

  it('C6.2 — plannedEnd không được trước plannedStart', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 1, plannedStart: D1_08_VN, plannedEnd: D1_09_VN, slotOrder: 0 }),
    ];

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix'](plan, 0, ctx as any);

    expect(result).not.toBeNull();
    for (const s of result!) {
      const startMs = new Date(s.plannedStart).getTime();
      const endMs = new Date(s.plannedEnd).getTime();
      expect(
        endMs,
        `Slot placeId=${s.placeId}: plannedEnd (${s.plannedEnd}) trước plannedStart (${s.plannedStart})`,
      ).toBeGreaterThan(startMs);
    }
  });

  it('C6.3 — Các slot trong output được sắp xếp theo thứ tự thời gian (plannedStart tăng dần)', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_10_VN, plannedEnd: D0_18_VN, slotOrder: 1 }),
      makeSlot({ placeId: place.placeId, dayIndex: 1, plannedStart: D1_08_VN, plannedEnd: D1_09_VN, slotOrder: 0 }),
    ];

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix'](plan, 0, ctx as any);

    expect(result).not.toBeNull();
    for (let i = 1; i < result!.length; i++) {
      const prev = result![i - 1]!;
      const curr = result![i]!;
      expect(
        new Date(curr.plannedStart).getTime(),
        `Slot[${i}] plannedStart không >= Slot[${i - 1}] plannedStart`,
      ).toBeGreaterThanOrEqual(new Date(prev.plannedStart).getTime());
    }
  });

  it('C6.4 — Không tạo khoảng chồng chéo thời gian giữa các slot', () => {
    const place = makePlace({ avgVisitDurationMin: 60 });
    const plan = [
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_08_VN, plannedEnd: D0_10_VN, slotOrder: 0 }),
      makeSlot({ placeId: place.placeId, dayIndex: 0, plannedStart: D0_10_VN, plannedEnd: D0_18_VN, slotOrder: 1 }),
    ];

    const ctx = makeRepairCtx([place], { capturedAt: D0_08_VN });
    const result = operators['repairSuffix'](plan, 0, ctx as any);

    expect(result).not.toBeNull();
    for (let i = 1; i < result!.length; i++) {
      const prev = result![i - 1]!;
      const curr = result![i]!;
      expect(
        new Date(curr.plannedStart).getTime(),
        `Slot[${i}] bắt đầu trước khi Slot[${i - 1}] kết thúc — chồng chéo thời gian!`,
      ).toBeGreaterThanOrEqual(new Date(prev.plannedEnd).getTime());
    }
  });
});
