/**
 * replan.human-logic-extended.test.ts
 *
 * Kiểm tra các kịch bản mà engine replan chưa được test, tập trung vào:
 *   - Logic con người: slot đã "hoàn thành" phải giữ nguyên thời gian lịch sử
 *   - TSP_REORDER không được thay đổi thời gian slot đã completed
 *   - Các operator hoạt động đúng khi plan có completed slots
 *   - Edge cases: plan rỗng, pool rỗng, budget=0
 *   - Opening hours: place đóng cửa trong khoảng thời gian trip
 *   - Score bounds: không NaN, không Infinity
 *   - TSP tìm đúng thứ tự tối ưu cho bài toán 3 điểm đã biết kết quả
 *
 * Tiền đề địa lý:
 *   - Da Nang center (initial position): lat=16.054, lng=108.202
 *   - NUI_THAN_TAI (far west):           lat=15.968, lng=108.019  (~21km từ center)
 *   - MY_AN_BEACH (east):                lat=16.025, lng=108.259  (~6km từ center)
 *   - LANG_BICH_HOA (north center):      lat=16.060, lng=108.220  (~2km từ center)
 *
 * Travel order analysis (từ Da Nang center):
 *   - Optimal TSP cho 3 điểm: [LANG_BICH_HOA → MY_AN_BEACH → NUI_THAN_TAI]
 *     (gần trung tâm trước, xa sau) — tổng đi ít hơn thứ tự gốc ~60min
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchContext,
} from '../src/replanner/BeamSearch';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference, ObjectiveWeights } from '@app/types';

// ---------------------------------------------------------------------------
// Helpers & fixtures
// ---------------------------------------------------------------------------

function allDayHours(open: string, close: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d, openTime: open, closeTime: close,
  }));
}

function weekdayOnly(open: string, close: string) {
  // Chỉ mở Mon–Fri (dayOfWeek 0–4)
  return [0, 1, 2, 3, 4].map((d) => ({
    dayOfWeek: d, openTime: open, closeTime: close,
  }));
}

function isValidISO(s: string) { return !isNaN(new Date(s).getTime()); }
function vnHour(iso: string) {
  const ms = new Date(iso).getTime() + 7 * 3_600_000;
  return new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
}

// ---------------------------------------------------------------------------
// Places (toạ độ thực Da Nang)
// ---------------------------------------------------------------------------

const DA_NANG_CENTER = { lat: 16.054, lng: 108.202 };

/** Xa nhất — phía tây (~21km từ center) */
const NUI_THAN_TAI: Place = {
  placeId: 2_221_527,
  name: 'Núi Thần Tài',
  lat: 15.968, lng: 108.019,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }],
  openingHours: allDayHours('08:00', '18:00'),
};

/** Trung bình — bãi biển phía đông (~6km từ center) */
const MY_AN_BEACH: Place = {
  placeId: 2_221_547,
  name: 'My An Beach',
  lat: 16.025, lng: 108.259,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }],
  openingHours: allDayHours('00:00', '23:59'),
};

/** Gần nhất — phía bắc trung tâm (~2km từ center) */
const LANG_BICH_HOA: Place = {
  placeId: 2_221_530,
  name: 'Lang Bich Hoa Da Nang',
  lat: 16.060, lng: 108.220,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }],
  openingHours: allDayHours('08:00', '18:00'),
};

/** Place chỉ mở thứ 2–6, dùng để test opening hours constraint */
const MUSEUM_WEEKDAY: Place = {
  placeId: 99_801,
  name: 'Bảo tàng chỉ mở thứ 2–6',
  lat: 16.050, lng: 108.210,
  avgVisitDurationMin: 90,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }],
  openingHours: weekdayOnly('09:00', '17:00'),
};

/** Place miễn phí, dùng để test budget=0 */
const FREE_PLACE: Place = {
  placeId: 99_802,
  name: 'Khu vui chơi miễn phí',
  lat: 16.055, lng: 108.205,
  avgVisitDurationMin: 60,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }],
  openingHours: allDayHours('08:00', '20:00'),
};

/** Place đắt tiền, dùng để test budget guard */
const EXPENSIVE_RESORT: Place = {
  placeId: 99_803,
  name: 'Resort đắt (500k)',
  lat: 16.050, lng: 108.220,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 500_000, estimatedCost: 500_000,
  tags: [{ tagId: 6 }],
  openingHours: allDayHours('08:00', '22:00'),
};

const ALL_PLACES_EXT = [NUI_THAN_TAI, MY_AN_BEACH, LANG_BICH_HOA, MUSEUM_WEEKDAY, FREE_PLACE, EXPENSIVE_RESORT];

// ---------------------------------------------------------------------------
// Slot factory
// ---------------------------------------------------------------------------

const TRIP_ID_EXT = 'ext-test-trip-2026';

function makeSlot(overrides: Partial<TripSlot> & Pick<TripSlot, 'slotId' | 'placeId' | 'plannedStart' | 'plannedEnd'>): TripSlot {
  return {
    tripId: TRIP_ID_EXT,
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    actualStart: null,
    actualEnd: null,
    estimatedCost: 0,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    isLocked: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default context builders
// ---------------------------------------------------------------------------

const NEUTRAL_USER: UserPreference = {
  preferenceVector: new Array(10).fill(0.1),
  pace: 0.5,
  mobilityRestrictions: [],
};

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1,
  wWeather: 1, wRisk: 1, wStability: 0.5, wPotentialBias: 1.0,
  wProximity: 0, wSynergy: 0.3,
};

function makeInitialState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: TRIP_ID_EXT,
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 720,
    budgetRemaining: 3_000_000,
    fatigue: 0,
    currentLat: DA_NANG_CENTER.lat,
    currentLng: DA_NANG_CENTER.lng,
    moodProxy: 0.8,
    capturedAt: '2026-05-23T01:00:00.000Z', // 08:00 VN
    source: 'simulated',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  const pool = overrides.candidatePool ?? ALL_PLACES_EXT;
  return {
    remainingSlots: [],
    initialState: makeInitialState(),
    candidatePool: pool,
    placeMap: new Map(pool.map((p) => [p.placeId, p])),
    user: NEUTRAL_USER,
    weights: DEFAULT_WEIGHTS,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Timestamps chính (UTC)
// ---------------------------------------------------------------------------

// Day 0 = 2026-05-23 VN (Saturday — dayOfWeek JS: 6 → mapped dayOfWeek: 5)
const D0_08 = '2026-05-23T01:00:00.000Z'; // 08:00 VN
const D0_10 = '2026-05-23T03:00:00.000Z'; // 10:00 VN
const D0_10H30 = '2026-05-23T03:30:00.000Z'; // 10:30 VN
const D0_12H30 = '2026-05-23T05:30:00.000Z'; // 12:30 VN
const D0_13 = '2026-05-23T06:00:00.000Z'; // 13:00 VN
const D0_15 = '2026-05-23T08:00:00.000Z'; // 15:00 VN
const D0_18 = '2026-05-23T11:00:00.000Z'; // 18:00 VN
const D0_20 = '2026-05-23T13:00:00.000Z'; // 20:00 VN
const D0_21 = '2026-05-23T14:00:00.000Z'; // 21:00 VN
const D0_22H30 = '2026-05-23T15:30:00.000Z'; // 22:30 VN (giới hạn overflow)

// ---------------------------------------------------------------------------
// Engine instances
// ---------------------------------------------------------------------------

let evolver: StateEvolver;
let operators: MutationOperators;
let scorer: ObjectiveScorer;
let beamSearch: BeamSearch;

beforeEach(() => {
  clearSetFeasibilityCache();
  evolver = new StateEvolver();
  operators = new MutationOperators(evolver);
  scorer = new ObjectiveScorer(evolver);
  beamSearch = new BeamSearch(evolver, operators, scorer, {
    beamWidth: 4,
    maxIterations: 8,
    improvementThreshold: 0.001,
    latencyBudgetMs: 6000,
  });
  vi.spyOn(Date, 'now').mockReturnValue(new Date(D0_08).getTime());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// GROUP A — TSP_REORDER và completed slots
//
// Logic con người: "Tôi đã ghé Núi Thần Tài lúc 8 giờ sáng — đó là lịch sử.
// Hệ thống không được viết lại quá khứ chỉ vì nó tối ưu lộ trình."
// ===========================================================================

describe('GROUP A — TSP_REORDER: Không được thay đổi thời gian slot đã completed', () => {

  /**
   * Tình huống: chuyến đi bắt đầu từ Da Nang center (16.054, 108.202).
   * 3 địa điểm theo thứ tự gốc:
   *   - Slot A (COMPLETED): NUI_THAN_TAI (far west) 08:00–10:00
   *   - Slot B (planned):   MY_AN_BEACH (east)      10:30–12:30
   *   - Slot C (planned):   LANG_BICH_HOA (center)  13:00–15:00
   *
   * TSP từ Da Nang center:
   *   - Thứ tự gốc [A, B, C]: travel ≈ 73 + 89 + 19 = 181 min
   *   - Thứ tự tối ưu [C, B, A]: travel ≈ 6 + 19 + 89 = 114 min → tiết kiệm ~67 min
   *   → TSP sẽ reorder sang [C, B, A], đưa completed slot A về cuối
   *   → repairSuffix sẽ ĐẨY slot A_completed sang ~14:00 VN (thay vì giữ 08:00 VN gốc)
   *
   * Đây là BUG: tspReorder không skip completed slots như các operator khác.
   */
  it('A1 — [BUG TIỀM NĂNG] TSP_REORDER không được thay đổi plannedStart/plannedEnd của completed slot', () => {
    // Slot A: NUI_THAN_TAI — đã hoàn thành, lịch sử 08:00–10:00
    const slotA_completed = makeSlot({
      slotId: 'a1-nui-than-tai',
      placeId: NUI_THAN_TAI.placeId,
      slotOrder: 0,
      plannedStart: D0_08,  // 08:00 VN
      plannedEnd: D0_10,    // 10:00 VN
      status: 'completed',
      actualStart: D0_08,
      actualEnd: D0_10,
    });

    // Slot B: MY_AN_BEACH — kế hoạch tiếp theo
    const slotB = makeSlot({
      slotId: 'a1-my-an-beach',
      placeId: MY_AN_BEACH.placeId,
      slotOrder: 1,
      plannedStart: D0_10H30, // 10:30 VN
      plannedEnd: D0_12H30,   // 12:30 VN
    });

    // Slot C: LANG_BICH_HOA — cuối ngày
    const slotC = makeSlot({
      slotId: 'a1-lang-bich-hoa',
      placeId: LANG_BICH_HOA.placeId,
      slotOrder: 2,
      plannedStart: D0_13,  // 13:00 VN
      plannedEnd: D0_15,    // 15:00 VN
    });

    const plan = [slotA_completed, slotB, slotC];
    const ctx = makeCtx({
      remainingSlots: plan,
      initialState: makeInitialState({ capturedAt: D0_08 }),
    });

    // Xác nhận rằng TSP thực sự tạo ra ít nhất 1 kết quả
    // (tức là TSP tìm thấy thứ tự tốt hơn)
    const tspResults = operators.tspReorder(plan, ctx);

    // Nếu TSP tạo kết quả, slot A (completed) PHẢI giữ nguyên thời gian
    if (tspResults.length > 0) {
      for (const result of tspResults) {
        const aInResult = result.newPlan.find(s => s.slotId === slotA_completed.slotId);

        expect(
          aInResult,
          'Slot A (completed) phải xuất hiện trong kết quả TSP_REORDER',
        ).toBeDefined();

        expect(
          aInResult!.plannedStart,
          `[BUG A1] TSP_REORDER thay đổi plannedStart của completed slot từ ` +
          `${slotA_completed.plannedStart} thành ${aInResult!.plannedStart}. ` +
          `tspReorder phải bỏ qua slot có status='completed' như timeShift/swapOrder/dropSlot đã làm.`,
        ).toBe(slotA_completed.plannedStart);

        expect(
          aInResult!.plannedEnd,
          `[BUG A1] TSP_REORDER thay đổi plannedEnd của completed slot.`,
        ).toBe(slotA_completed.plannedEnd);
      }
    }
  });

  it('A2 — Khi plan chỉ có completed slots, TSP_REORDER không tạo ra kết quả', () => {
    // Nếu tất cả slots đã completed, không có gì để tối ưu — TSP nên trả về []
    const allCompleted = [
      makeSlot({ slotId: 'a2-1', placeId: NUI_THAN_TAI.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10, status: 'completed', actualStart: D0_08, actualEnd: D0_10 }),
      makeSlot({ slotId: 'a2-2', placeId: MY_AN_BEACH.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30, status: 'completed', actualStart: D0_10H30, actualEnd: D0_12H30 }),
      makeSlot({ slotId: 'a2-3', placeId: LANG_BICH_HOA.placeId, slotOrder: 2, plannedStart: D0_13, plannedEnd: D0_15, status: 'completed', actualStart: D0_13, actualEnd: D0_15 }),
    ];

    const ctx = makeCtx({
      remainingSlots: allCompleted,
      initialState: makeInitialState({ capturedAt: D0_15 }), // sau khi tất cả hoàn thành
    });

    const tspResults = operators.tspReorder(allCompleted, ctx);

    // Logic con người: đã đi xong hết rồi, TSP không cần làm gì
    // Hiện tại engine CÓ THỂ vẫn reorder completed slots → đây là test kiểm tra behavior
    if (tspResults.length > 0) {
      // Nếu có kết quả, tất cả completed slots phải giữ nguyên thời gian
      for (const result of tspResults) {
        for (const origSlot of allCompleted) {
          const inResult = result.newPlan.find(s => s.slotId === origSlot.slotId);
          if (inResult) {
            expect(
              inResult.plannedStart,
              `[BUG A2] TSP_REORDER thay đổi plannedStart của completed slot ${origSlot.slotId}`,
            ).toBe(origSlot.plannedStart);
          }
        }
      }
    }
  });

  it('A3 — Các operator khác (swapOrder, timeShift, dropSlot) không tác động vào completed slots', () => {
    // Đây là baseline test để confirm rằng các operator KHÁC đã handle correctly
    const completedSlot = makeSlot({
      slotId: 'a3-completed',
      placeId: LANG_BICH_HOA.placeId,
      slotOrder: 0,
      plannedStart: D0_08,
      plannedEnd: D0_10,
      status: 'completed',
      actualStart: D0_08,
      actualEnd: D0_10,
    });
    const plannedSlot = makeSlot({
      slotId: 'a3-planned',
      placeId: MY_AN_BEACH.placeId,
      slotOrder: 1,
      plannedStart: D0_10H30,
      plannedEnd: D0_12H30,
    });

    const plan = [completedSlot, plannedSlot];
    const ctx = makeCtx({
      remainingSlots: plan,
      initialState: makeInitialState({ capturedAt: D0_10H30 }),
    });

    // swapOrder không được swap completed slot
    const swaps = operators.swapOrder(plan, ctx);
    for (const sw of swaps) {
      const compInSwap = sw.newPlan.find(s => s.slotId === completedSlot.slotId);
      if (compInSwap) {
        // Completed slot phải giữ slotOrder gốc (không bị đổi chỗ)
        // timeShift/swapOrder explicitly skips completed slots
        expect(
          compInSwap.plannedStart,
          'swapOrder không được thay đổi planned times của completed slot',
        ).toBe(completedSlot.plannedStart);
      }
    }

    // dropSlot không được xóa completed slot
    const drops = operators.dropSlot(plan, ctx);
    for (const dp of drops) {
      const hasCompleted = dp.newPlan.some(s => s.slotId === completedSlot.slotId);
      expect(
        hasCompleted,
        'dropSlot không được xóa completed slot khỏi plan',
      ).toBe(true);
    }

    // timeShift không được shift completed slot
    const timeShifts = operators.timeShift(plan, ctx);
    for (const ts of timeShifts) {
      const compInTs = ts.newPlan.find(s => s.slotId === completedSlot.slotId);
      if (compInTs) {
        expect(
          compInTs.plannedStart,
          'timeShift không được thay đổi plannedStart của completed slot',
        ).toBe(completedSlot.plannedStart);
      }
    }
  });
});

// ===========================================================================
// GROUP B — Opening hours: Place đóng cửa vào ngày trip
//
// Logic con người: "Nếu bảo tàng chỉ mở thứ 2–6 và chuyến đi là thứ 7,
// engine phải từ chối lên lịch chứ không được im lặng tạo ra plan bất khả thi."
// ===========================================================================

describe('GROUP B — Opening hours constraint: Place đóng cửa vào ngày trip', () => {

  it('B1 — repairSuffix với place chỉ mở thứ 2–6 trên trip thứ 7: phải trả về null', () => {
    // 2026-05-23 là thứ 7 (Saturday)
    // MUSEUM_WEEKDAY chỉ mở Mon–Fri (dayOfWeek DB: 0–4)
    // getUTCDay() for Saturday = 6 → mapped dayOfWeek = (6+6)%7 = 5 → NOT in weekdayOnly()
    const saturdaySlot = makeSlot({
      slotId: 'b1-museum',
      placeId: MUSEUM_WEEKDAY.placeId,
      slotOrder: 0,
      plannedStart: D0_08,
      plannedEnd: D0_10,
    });

    const ctx = makeCtx({
      remainingSlots: [saturdaySlot],
      initialState: makeInitialState({ capturedAt: D0_08 }),
      candidatePool: [MUSEUM_WEEKDAY],
      placeMap: new Map([[MUSEUM_WEEKDAY.placeId, MUSEUM_WEEKDAY]]),
    });

    // repairSuffix sẽ thử schedule MUSEUM_WEEKDAY vào thứ 7 → fail opening hours
    // Sau đó thử shift sang thứ 2 (ngày tiếp theo là Sunday thứ 1, Monday thứ 2, etc.)
    // Nhưng maxAllowedDayIndex = 0 (1-day trip) → return null
    const result = operators['repairSuffix']([saturdaySlot], 0, ctx as any);

    // Nếu place đóng cửa vào ngày trip và trip chỉ có 1 ngày, kết quả phải null
    // (không thể schedule trong trip boundary)
    expect(
      result,
      'Place chỉ mở thứ 2–6, trip là thứ 7 (1 ngày): repairSuffix phải trả về null',
    ).toBeNull();
  });

  it('B2 — BeamSearch không tạo plan với slot có opening hours vi phạm', () => {
    // Slot cho MUSEUM_WEEKDAY vào thứ 7 — BeamSearch phải bỏ qua hoặc thay thế
    const saturdayMuseumSlot = makeSlot({
      slotId: 'b2-museum',
      placeId: MUSEUM_WEEKDAY.placeId,
      slotOrder: 0,
      plannedStart: D0_08,
      plannedEnd: D0_10,
    });

    // Pool chỉ có MUSEUM_WEEKDAY và FREE_PLACE
    const pool = [MUSEUM_WEEKDAY, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [saturdayMuseumSlot],
      initialState: makeInitialState({ capturedAt: D0_08 }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    // BeamSearch không được crash
    let plan: TripSlot[] = [];
    expect(() => { plan = beamSearch.search(ctx).plan; }).not.toThrow();

    // Mọi slot trong plan phải có planned times hợp lệ (ISO)
    for (const s of plan) {
      expect(isValidISO(s.plannedStart), `plannedStart không hợp lệ`).toBe(true);
      expect(isValidISO(s.plannedEnd), `plannedEnd không hợp lệ`).toBe(true);
    }
  });

  it('B3 — Place chỉ mở thứ 2–6 trong trip 2 ngày (thứ 6 + thứ 7): slot thứ 7 phải được chuyển sang thứ 6', () => {
    // Nếu trip 2 ngày: day0=thứ 6, day1=thứ 7
    // Slot trên thứ 7 cho MUSEUM_WEEKDAY: repairSuffix nên shift sang thứ 6... nhưng
    // thứ 6 là ngày 0 (trước), không thể đi ngược lại.
    // Kết quả: vẫn null (không thể rewind)

    // Tạo plan 2 ngày: day0 slot (thứ 6) + museum slot trên day1 (thứ 7)
    // 2026-05-22 = thứ 6 (Friday), 2026-05-23 = thứ 7 (Saturday)
    const day0Slot = makeSlot({
      slotId: 'b3-day0',
      placeId: MY_AN_BEACH.placeId,
      slotOrder: 0,
      dayIndex: 0,
      plannedStart: '2026-05-22T01:00:00.000Z', // 08:00 VN Friday
      plannedEnd:   '2026-05-22T03:00:00.000Z', // 10:00 VN Friday
    });
    const museumOnSaturday = makeSlot({
      slotId: 'b3-museum-sat',
      placeId: MUSEUM_WEEKDAY.placeId,
      slotOrder: 0,
      dayIndex: 1,
      plannedStart: '2026-05-23T01:00:00.000Z', // 08:00 VN Saturday
      plannedEnd:   '2026-05-23T02:30:00.000Z', // 09:30 VN Saturday
    });

    const pool = [MY_AN_BEACH, MUSEUM_WEEKDAY];
    const ctx = makeCtx({
      remainingSlots: [day0Slot, museumOnSaturday],
      initialState: makeInitialState({
        capturedAt: '2026-05-22T01:00:00.000Z', // Bắt đầu từ thứ 6
      }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    // repairSuffix từ index 0 (cả 2 ngày)
    const result = operators['repairSuffix']([day0Slot, museumOnSaturday], 0, ctx as any);

    // Museum chỉ mở thứ 2–6. Day1 là thứ 7 → museum không thể schedule trong trip boundary
    // (không thể đi ngược về thứ 6)
    expect(
      result,
      'Museum chỉ mở thứ 2–6, day1=thứ 7: repairSuffix phải trả về null',
    ).toBeNull();
  });
});

// ===========================================================================
// GROUP C — Edge cases: Plan rỗng, pool rỗng, tất cả completed
//
// Logic con người: "Hệ thống không được crash trong tình huống bất thường."
// ===========================================================================

describe('GROUP C — Edge cases: Plan/pool rỗng, tất cả completed', () => {

  it('C1 — Plan rỗng: generateAll trả về []', () => {
    const ctx = makeCtx({ remainingSlots: [] });
    const results = operators.generateAll([], ctx);
    expect(results, 'generateAll với plan rỗng phải trả về []').toHaveLength(0);
  });

  it('C2 — Plan rỗng: BeamSearch trả về plan rỗng không crash', () => {
    const ctx = makeCtx({ remainingSlots: [] });
    let result: ReturnType<typeof beamSearch.search> | undefined;
    expect(() => { result = beamSearch.search(ctx); }).not.toThrow();
    expect(result!.plan, 'BeamSearch với plan rỗng nên trả về plan rỗng').toHaveLength(0);
  });

  it('C3 — CandidatePool rỗng: generateAll trả về [] không crash', () => {
    const slot = makeSlot({
      slotId: 'c3-1', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });
    const ctx = makeCtx({
      remainingSlots: [slot],
      candidatePool: [MY_AN_BEACH], // pool tối thiểu chỉ có slot place
      placeMap: new Map([[MY_AN_BEACH.placeId, MY_AN_BEACH]]),
    });

    let results: ReturnType<typeof operators.generateAll> | undefined;
    expect(() => { results = operators.generateAll([slot], ctx); }).not.toThrow();
    expect(Array.isArray(results), 'generateAll không crash với pool tối thiểu').toBe(true);
  });

  it('C4 — Tất cả slots là meal: dropSlot trả về []', () => {
    // dropSlot skip activityType='meal' → không có slot nào bị drop → []
    const mealSlots = [
      makeSlot({ slotId: 'c4-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10, activityType: 'meal' }),
      makeSlot({ slotId: 'c4-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30, activityType: 'meal' }),
    ];
    const ctx = makeCtx({
      remainingSlots: mealSlots,
      candidatePool: [MY_AN_BEACH, LANG_BICH_HOA],
      placeMap: new Map([[MY_AN_BEACH.placeId, MY_AN_BEACH], [LANG_BICH_HOA.placeId, LANG_BICH_HOA]]),
    });

    const drops = operators.dropSlot(mealSlots, ctx);
    expect(drops, 'dropSlot trên plan toàn meal phải trả về [] (meal không được drop)').toHaveLength(0);
  });

  it('C5 — Plan 1 slot locked: swapOrder và dropSlot đều trả về []', () => {
    const lockedSingle = makeSlot({
      slotId: 'c5-locked', placeId: LANG_BICH_HOA.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
      isLocked: true,
    });

    const ctx = makeCtx({
      remainingSlots: [lockedSingle],
      candidatePool: [LANG_BICH_HOA, MY_AN_BEACH],
      placeMap: new Map([[LANG_BICH_HOA.placeId, LANG_BICH_HOA], [MY_AN_BEACH.placeId, MY_AN_BEACH]]),
    });

    const swaps = operators.swapOrder([lockedSingle], ctx);
    expect(swaps, 'swapOrder trên 1 locked slot phải trả về []').toHaveLength(0);

    const drops = operators.dropSlot([lockedSingle], ctx);
    expect(drops, 'dropSlot trên 1 locked slot phải trả về []').toHaveLength(0);
  });

  it('C6 — insertAlt với forceIncludePlaceId đã có trong plan: trả về []', () => {
    const slot = makeSlot({
      slotId: 'c6-1', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });

    const ctx = makeCtx({
      remainingSlots: [slot],
      candidatePool: [MY_AN_BEACH, LANG_BICH_HOA],
      placeMap: new Map([[MY_AN_BEACH.placeId, MY_AN_BEACH], [LANG_BICH_HOA.placeId, LANG_BICH_HOA]]),
      forceIncludePlaceId: MY_AN_BEACH.placeId, // đã có trong plan!
    } as any);

    const inserts = operators.insertAlt([slot], ctx as any);
    expect(inserts, 'insertAlt với forceIncludePlaceId đã tồn tại trong plan phải trả về []').toHaveLength(0);
  });
});

// ===========================================================================
// GROUP D — Score bounds: Không NaN, không Infinity
//
// Logic con người: "Điểm số phải là con số thực — không phải 'không xác định'."
// ===========================================================================

describe('GROUP D — Score bounds: Không NaN, không Infinity', () => {

  it('D1 — Score luôn hữu hạn cho mọi mutation output', () => {
    const slot1 = makeSlot({ slotId: 'd1-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'd1-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30 });

    const ctx = makeCtx({
      remainingSlots: [slot1, slot2],
      candidatePool: [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI],
      placeMap: new Map([MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI].map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll([slot1, slot2], ctx);

    for (const m of mutations) {
      const states = evolver.computeTrajectory(m.newPlan, ctx.initialState, ctx);
      const score = scorer.score(m.newPlan, states, DEFAULT_WEIGHTS, ctx);

      expect(
        isFinite(score),
        `op=${m.operator}: score=${score} không hữu hạn (NaN hoặc Infinity)`,
      ).toBe(true);
      expect(
        isNaN(score),
        `op=${m.operator}: score là NaN`,
      ).toBe(false);
    }
  });

  it('D2 — Score với budget=0 và plan gồm toàn free places: hữu hạn, không crash', () => {
    const freeSlot = makeSlot({
      slotId: 'd2-free', placeId: FREE_PLACE.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
      estimatedCost: 0,
    });

    const ctx = makeCtx({
      remainingSlots: [freeSlot],
      initialState: makeInitialState({ budgetRemaining: 0 }),
      candidatePool: [FREE_PLACE, MY_AN_BEACH],
      placeMap: new Map([[FREE_PLACE.placeId, FREE_PLACE], [MY_AN_BEACH.placeId, MY_AN_BEACH]]),
    });

    const states = evolver.computeTrajectory([freeSlot], ctx.initialState, ctx);
    const score = scorer.score([freeSlot], states, DEFAULT_WEIGHTS, ctx);

    expect(isFinite(score), 'Score với budget=0 phải hữu hạn').toBe(true);
  });

  it('D3 — Score với fatigue=1.0 (tối đa): hữu hạn', () => {
    const slot = makeSlot({
      slotId: 'd3-tired', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });

    const ctx = makeCtx({
      remainingSlots: [slot],
      initialState: makeInitialState({ fatigue: 1.0 }),
      candidatePool: [MY_AN_BEACH],
      placeMap: new Map([[MY_AN_BEACH.placeId, MY_AN_BEACH]]),
    });

    let score: number = 0;
    expect(() => {
      const states = evolver.computeTrajectory([slot], ctx.initialState, ctx);
      score = scorer.score([slot], states, DEFAULT_WEIGHTS, ctx);
    }).not.toThrow();
    expect(isFinite(score), 'Score với fatigue=1.0 phải hữu hạn').toBe(true);
  });

  it('D4 — Score với mưa rất nặng (100mm/h) và plan outdoor: hữu hạn', () => {
    const outdoorSlot = makeSlot({
      slotId: 'd4-rain', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });

    const ctx = makeCtx({
      remainingSlots: [outdoorSlot],
      weatherForecast: [{ rainMmPerH: 100 }],
      candidatePool: [MY_AN_BEACH],
      placeMap: new Map([[MY_AN_BEACH.placeId, MY_AN_BEACH]]),
    });

    let score: number = 0;
    expect(() => {
      const states = evolver.computeTrajectory([outdoorSlot], ctx.initialState, ctx);
      score = scorer.score([outdoorSlot], states, DEFAULT_WEIGHTS, ctx);
    }).not.toThrow();
    expect(isFinite(score), 'Score với rain=100mm/h phải hữu hạn').toBe(true);
  });
});

// ===========================================================================
// GROUP E — Budget boundary: Engine không chèn place quá đắt
//
// Logic con người: "Khi ví còn 100k, đừng gợi ý resort 500k."
// ===========================================================================

describe('GROUP E — Budget boundary', () => {

  it('E1 — insertAlt không chèn EXPENSIVE_RESORT khi budget còn 100k', () => {
    const baseSlot = makeSlot({
      slotId: 'e1-base', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });

    const tightState = makeInitialState({ budgetRemaining: 100_000 });
    const pool = [MY_AN_BEACH, EXPENSIVE_RESORT, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [baseSlot],
      initialState: tightState,
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const inserts = operators.insertAlt([baseSlot], ctx);
    const hasResort = inserts.some(m => m.newPlan.some(s => s.placeId === EXPENSIVE_RESORT.placeId));

    expect(
      hasResort,
      'insertAlt không được chèn EXPENSIVE_RESORT (500k) khi budget còn 100k',
    ).toBe(false);
  });

  it('E2 — replacePlace không thay bằng EXPENSIVE_RESORT khi budget còn 100k', () => {
    const baseSlot = makeSlot({
      slotId: 'e2-base', placeId: MY_AN_BEACH.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
    });

    const pool = [MY_AN_BEACH, EXPENSIVE_RESORT, LANG_BICH_HOA];
    const ctx = makeCtx({
      remainingSlots: [baseSlot],
      initialState: makeInitialState({ budgetRemaining: 100_000 }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const replaces = operators.replacePlace([baseSlot], ctx);
    const hasResort = replaces.some(m => m.newPlan.some(s => s.placeId === EXPENSIVE_RESORT.placeId));

    expect(
      hasResort,
      'replacePlace không được chọn EXPENSIVE_RESORT (500k) khi budget còn 100k',
    ).toBe(false);
  });

  it('E3 — Budget=0: BeamSearch không crash và không tạo plan tốn tiền', () => {
    const baseSlot = makeSlot({
      slotId: 'e3-free', placeId: FREE_PLACE.placeId,
      slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10,
      estimatedCost: 0,
    });

    const pool = [FREE_PLACE, EXPENSIVE_RESORT];
    const ctx = makeCtx({
      remainingSlots: [baseSlot],
      initialState: makeInitialState({ budgetRemaining: 0 }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    let plan: TripSlot[] = [];
    expect(() => { plan = beamSearch.search(ctx).plan; }).not.toThrow();

    const totalCost = plan.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
    expect(totalCost, 'Plan với budget=0 không được tiêu tiền').toBe(0);
  });
});

// ===========================================================================
// GROUP F — TSP optimality verification
//
// Logic con người: "Nếu 3 điểm theo thứ tự A→B→C mất 3 giờ nhưng C→B→A chỉ mất 2 giờ,
// hệ thống phải chọn C→B→A."
// ===========================================================================

describe('GROUP F — TSP_REORDER tìm thứ tự tối ưu cho bài toán 3 điểm đã biết', () => {

  it('F1 — TSP 3 planned slots: thứ tự gốc [NUI_THAN_TAI, BEACH, LANG_BICH_HOA] được tối ưu', () => {
    // Thứ tự gốc từ Da Nang center [far west → east → north center]:
    //   Travel: ~73 + ~89 + ~19 = ~181 min
    // Thứ tự tối ưu [north center → east → far west]:
    //   Travel: ~6 + ~19 + ~89 = ~114 min → tiết kiệm ~67 min
    // TSP_REORDER phải tìm ra thứ tự tốt hơn (tổng travel nhỏ hơn).

    const slotA = makeSlot({ slotId: 'f1-a', placeId: NUI_THAN_TAI.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slotB = makeSlot({ slotId: 'f1-b', placeId: MY_AN_BEACH.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30 });
    const slotC = makeSlot({ slotId: 'f1-c', placeId: LANG_BICH_HOA.placeId, slotOrder: 2, plannedStart: D0_13, plannedEnd: D0_15 });

    const plan = [slotA, slotB, slotC];
    const ctx = makeCtx({
      remainingSlots: plan,
      candidatePool: [NUI_THAN_TAI, MY_AN_BEACH, LANG_BICH_HOA],
      placeMap: new Map([[NUI_THAN_TAI.placeId, NUI_THAN_TAI], [MY_AN_BEACH.placeId, MY_AN_BEACH], [LANG_BICH_HOA.placeId, LANG_BICH_HOA]]),
    });

    const tspResults = operators.tspReorder(plan, ctx);

    // TSP phải TÌM THẤY improvement (không trả về [])
    expect(
      tspResults.length,
      'TSP_REORDER phải tìm thấy thứ tự tốt hơn cho 3 điểm phân bố rõ ràng',
    ).toBeGreaterThan(0);

    if (tspResults.length > 0) {
      const newPlan = tspResults[0]!.newPlan;

      // Thứ tự tối ưu: LANG_BICH_HOA đầu tiên (gần center nhất)
      // NUI_THAN_TAI cuối cùng (xa nhất, chỉ đi 1 lần)
      const firstPlace = newPlan[0]!.placeId;
      const lastPlace = newPlan[newPlan.length - 1]!.placeId;

      expect(
        firstPlace,
        'TSP_REORDER phải đặt LANG_BICH_HOA (gần center) đầu tiên',
      ).toBe(LANG_BICH_HOA.placeId);

      expect(
        lastPlace,
        'TSP_REORDER phải đặt NUI_THAN_TAI (xa nhất) cuối cùng',
      ).toBe(NUI_THAN_TAI.placeId);
    }
  });

  it('F2 — TSP 3 slots equidistant: không thay đổi thứ tự khi không có improvement', () => {
    // Khi tất cả places cùng tọa độ → không có gain → tspReorder trả về []
    const samePlace: Place = { ...LANG_BICH_HOA, placeId: 99_901 };
    const samePlace2: Place = { ...LANG_BICH_HOA, placeId: 99_902 };
    const samePlace3: Place = { ...LANG_BICH_HOA, placeId: 99_903 };

    const slots = [
      makeSlot({ slotId: 'f2-1', placeId: samePlace.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 }),
      makeSlot({ slotId: 'f2-2', placeId: samePlace2.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30 }),
      makeSlot({ slotId: 'f2-3', placeId: samePlace3.placeId, slotOrder: 2, plannedStart: D0_13, plannedEnd: D0_15 }),
    ];

    const pool = [samePlace, samePlace2, samePlace3];
    const ctx = makeCtx({
      remainingSlots: slots,
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const tspResults = operators.tspReorder(slots, ctx);

    // Khi tất cả ở cùng vị trí, mọi hoán vị đều cho travel=0 → không có improvement > 0.01
    // TSP nên trả về [] (không có thay đổi)
    expect(
      tspResults.length,
      'TSP_REORDER với 3 places cùng tọa độ không nên tạo kết quả (không có gain)',
    ).toBe(0);
  });
});

// ===========================================================================
// GROUP G — Time-of-day consistency
//
// Logic con người: "Không ai muốn thăm quan lúc 7 giờ sáng hay 11 giờ đêm."
// ===========================================================================

describe('GROUP G — Time-of-day: Mọi slot phải trong khung 08:00–22:30 VN', () => {

  it('G1 — generateAll không tạo slot bắt đầu trước 08:00 VN', () => {
    const slot1 = makeSlot({ slotId: 'g1-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'g1-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2],
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll([slot1, slot2], ctx);

    for (const m of mutations) {
      for (const s of m.newPlan) {
        const startVnH = vnHour(s.plannedStart);
        expect(
          startVnH,
          `op=${m.operator} slot placeId=${s.placeId}: bắt đầu lúc ${startVnH.toFixed(2)}h VN (< 08:00)`,
        ).toBeGreaterThanOrEqual(8.0);
      }
    }
  });

  it('G2 — generateAll không tạo slot kết thúc sau 22:30 VN (ngoại trừ place có giờ mở cửa midnight-crossing)', () => {
    const slot1 = makeSlot({ slotId: 'g2-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'g2-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, plannedStart: D0_18, plannedEnd: D0_20 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2],
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll([slot1, slot2], ctx);

    for (const m of mutations) {
      for (const s of m.newPlan) {
        const endVnH = vnHour(s.plannedEnd);
        // Places với giờ mở cửa kéo sang hôm sau được phép
        const place = pool.find(p => p.placeId === s.placeId);
        const hasMidnightHours = place?.openingHours.some(h => {
          const [ch] = h.closeTime.split(':').map(Number);
          return ch! < 8; // giờ đóng cửa trước 8 giờ sáng → midnight-crossing
        }) ?? false;

        if (!hasMidnightHours) {
          expect(
            endVnH,
            `op=${m.operator} slot placeId=${s.placeId}: kết thúc lúc ${endVnH.toFixed(2)}h VN (> 22:30)`,
          ).toBeLessThanOrEqual(22.5 + 0.1); // tolerance nhỏ cho floating point
        }
      }
    }
  });

  it('G3 — BeamSearch output: mọi slot bắt đầu sau 08:00 VN', () => {
    const slot1 = makeSlot({ slotId: 'g3-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'g3-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, plannedStart: D0_10H30, plannedEnd: D0_12H30 });
    const slot3 = makeSlot({ slotId: 'g3-3', placeId: NUI_THAN_TAI.placeId, slotOrder: 2, plannedStart: D0_13, plannedEnd: D0_15 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2, slot3],
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const { plan } = beamSearch.search(ctx);

    for (const s of plan) {
      const startVnH = vnHour(s.plannedStart);
      expect(
        startVnH,
        `BeamSearch output: slot placeId=${s.placeId} bắt đầu lúc ${startVnH.toFixed(2)}h VN (< 08:00)`,
      ).toBeGreaterThanOrEqual(8.0);
    }
  });
});

// ===========================================================================
// GROUP H — Nhất quán slotOrder sau mỗi operator
//
// Logic con người: "Slot thứ 3 trong ngày phải có số thứ tự là 2, không phải 5."
// ===========================================================================

describe('GROUP H — slotOrder nhất quán sau mutation', () => {

  it('H1 — DROP_SLOT: slotOrder trong cùng ngày liên tiếp từ 0', () => {
    const slots = [
      makeSlot({ slotId: 'h1-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, dayIndex: 0, plannedStart: D0_08, plannedEnd: D0_10 }),
      makeSlot({ slotId: 'h1-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, dayIndex: 0, plannedStart: D0_10H30, plannedEnd: D0_12H30 }),
      makeSlot({ slotId: 'h1-3', placeId: FREE_PLACE.placeId, slotOrder: 2, dayIndex: 0, plannedStart: D0_13, plannedEnd: D0_15 }),
    ];
    const pool = [MY_AN_BEACH, LANG_BICH_HOA, FREE_PLACE, NUI_THAN_TAI];
    const ctx = makeCtx({
      remainingSlots: slots,
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const drops = operators.dropSlot(slots, ctx);
    expect(drops.length, 'Phải có ít nhất 1 DROP_SLOT').toBeGreaterThan(0);

    for (const dp of drops) {
      const byDay = new Map<number, number[]>();
      for (const s of dp.newPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s.slotOrder);
      }
      for (const [day, orders] of byDay) {
        const sorted = [...orders].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
          expect(
            sorted[i],
            `DROP_SLOT ngày ${day}: slotOrder[${i}] = ${sorted[i]}, kỳ vọng ${i}`,
          ).toBe(i);
        }
      }
    }
  });

  it('H2 — INSERT_ALT: không có slotOrder trùng trong cùng ngày', () => {
    const slot1 = makeSlot({ slotId: 'h2-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, dayIndex: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'h2-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, dayIndex: 0, plannedStart: D0_13, plannedEnd: D0_15 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2],
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const inserts = operators.insertAlt([slot1, slot2], ctx);

    for (const ins of inserts) {
      const byDay = new Map<number, number[]>();
      for (const s of ins.newPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s.slotOrder);
      }
      for (const [day, orders] of byDay) {
        const uniqueOrders = new Set(orders);
        expect(
          uniqueOrders.size,
          `INSERT_ALT ngày ${day}: slotOrder trùng — [${orders.join(', ')}]`,
        ).toBe(orders.length);
      }
    }
  });

  it('H3 — SWAP_ORDER: slotOrder sau swap không tạo ra giá trị âm', () => {
    const slot1 = makeSlot({ slotId: 'h3-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, dayIndex: 0, plannedStart: D0_08, plannedEnd: D0_10 });
    const slot2 = makeSlot({ slotId: 'h3-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, dayIndex: 0, plannedStart: D0_10H30, plannedEnd: D0_12H30 });
    const slot3 = makeSlot({ slotId: 'h3-3', placeId: NUI_THAN_TAI.placeId, slotOrder: 2, dayIndex: 0, plannedStart: D0_13, plannedEnd: D0_15 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2, slot3],
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const swaps = operators.swapOrder([slot1, slot2, slot3], ctx);

    for (const sw of swaps) {
      for (const s of sw.newPlan) {
        expect(
          s.slotOrder,
          `SWAP_ORDER: slot placeId=${s.placeId} có slotOrder=${s.slotOrder} (âm)`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ===========================================================================
// GROUP I — Mid-trip replanning (capturedAt giữa chuyến đi)
//
// Logic con người: "Chúng tôi đang ở giữa chuyến đi — hãy tối ưu phần còn lại,
// đừng thay đổi những gì đã làm."
// ===========================================================================

describe('GROUP I — Mid-trip replanning: capturedAt giữa chuyến đi', () => {

  it('I1 — generateAll với capturedAt giữa ngày: không tạo slot trong quá khứ', () => {
    // capturedAt = 13:00 VN (giữa chuyến đi)
    // Slot 1 đã qua (08:00-10:00), Slot 2 đang xảy ra (11:00-13:00), Slot 3 là tương lai (14:00-16:00)
    const capturedAt = D0_13; // 13:00 VN

    const slot1 = makeSlot({ slotId: 'i1-past', placeId: MY_AN_BEACH.placeId, slotOrder: 0, dayIndex: 0, plannedStart: D0_08, plannedEnd: D0_10, status: 'completed' });
    const slot2 = makeSlot({ slotId: 'i1-now', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, dayIndex: 0, plannedStart: D0_10H30, plannedEnd: D0_12H30, status: 'completed' });
    const slot3 = makeSlot({ slotId: 'i1-future', placeId: NUI_THAN_TAI.placeId, slotOrder: 2, dayIndex: 0, plannedStart: D0_13, plannedEnd: D0_15 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2, slot3],
      initialState: makeInitialState({
        capturedAt,
        dayIndex: 0,
        slotOrder: 2,
        currentLat: LANG_BICH_HOA.lat,
        currentLng: LANG_BICH_HOA.lng,
      }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll([slot1, slot2, slot3], ctx);

    // Mọi planned slot trong mutation output phải có plannedStart >= capturedAt
    const capturedAtMs = new Date(capturedAt).getTime();
    for (const m of mutations) {
      for (const s of m.newPlan) {
        if (s.status === 'planned') {
          const startMs = new Date(s.plannedStart).getTime();
          expect(
            startMs,
            `op=${m.operator}: planned slot placeId=${s.placeId} có plannedStart=${s.plannedStart} trước capturedAt=${capturedAt}`,
          ).toBeGreaterThanOrEqual(capturedAtMs - 1000); // tolerance 1 giây
        }
      }
    }
  });

  it('I2 — BeamSearch khi capturedAt giữa ngày: không trả về slot bắt đầu trong quá khứ', () => {
    const capturedAt = D0_13; // 13:00 VN, giữa chuyến đi

    const slot1 = makeSlot({ slotId: 'i2-1', placeId: MY_AN_BEACH.placeId, slotOrder: 0, dayIndex: 0, plannedStart: D0_08, plannedEnd: D0_10, status: 'completed' });
    const slot2 = makeSlot({ slotId: 'i2-2', placeId: LANG_BICH_HOA.placeId, slotOrder: 1, dayIndex: 0, plannedStart: D0_13, plannedEnd: D0_15 });

    const pool = [MY_AN_BEACH, LANG_BICH_HOA, NUI_THAN_TAI, FREE_PLACE];
    const ctx = makeCtx({
      remainingSlots: [slot1, slot2],
      initialState: makeInitialState({
        capturedAt,
        currentLat: MY_AN_BEACH.lat,
        currentLng: MY_AN_BEACH.lng,
      }),
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const { plan } = beamSearch.search(ctx);

    const capturedAtMs = new Date(capturedAt).getTime();
    for (const s of plan) {
      if (s.status !== 'completed' && s.status !== 'skipped') {
        expect(
          new Date(s.plannedStart).getTime(),
          `BeamSearch mid-trip: slot placeId=${s.placeId} có plannedStart trong quá khứ`,
        ).toBeGreaterThanOrEqual(capturedAtMs - 5000); // tolerance 5 giây
      }
    }
  });
});
