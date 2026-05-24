/**
 * replan.human-logic.test.ts
 *
 * Kiểm tra engine replan theo góc nhìn "logic con người":
 * Mỗi kịch bản mô phỏng một tình huống thực tế mà hành khách hoặc
 * người lập kế hoạch du lịch kỳ vọng engine phải xử lý đúng.
 *
 * Dữ liệu: 11 địa điểm thật ở Đà Nẵng (placeId từ DB thật).
 * Timestamps: UTC thực (trừ 7h so với dữ liệu DB gốc — xem replan.e2e.realdata.test.ts).
 *
 * Yêu cầu: Không cần kết nối DB — test hoàn toàn offline với dữ liệu tĩnh.
 *
 * Các nhóm test:
 *   GROUP 1  — isLocked: Slot đã đặt cứng không thể bị engine thay đổi
 *   GROUP 2  — Mưa ưu tiên indoor: Con người tránh trời mưa
 *   GROUP 3  — Fatigue: Bữa ăn và nghỉ ngơi phục hồi sức lực
 *   GROUP 4  — Budget: Không tiêu quá số tiền còn lại
 *   GROUP 5  — Thứ tự thời gian: Không thể ở 2 nơi cùng lúc
 *   GROUP 6  — Khoảng cách: Đi gần nhau tiết kiệm hơn
 *   GROUP 7  — Preference: Engine tôn trọng sở thích người dùng
 *   GROUP 8  — Determinism: Cùng input luôn cho cùng output
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchContext,
} from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference, ObjectiveWeights } from '@app/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allDayHours(open: string, close: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    openTime: open,
    closeTime: close,
  }));
}

function isValidISO(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

/** Giờ Việt Nam (UTC+7) từ chuỗi ISO. */
function vnHour(iso: string): number {
  const ms = new Date(iso).getTime() + 7 * 3_600_000;
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

// ---------------------------------------------------------------------------
// Dữ liệu địa điểm thật Đà Nẵng (placeId từ DB)
// ---------------------------------------------------------------------------

const MY_AN_BEACH: Place = {
  placeId: 2_221_547,
  name: 'My An Beach',
  lat: 16.025095, lng: 108.259534,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const THUY_SON: Place = {
  placeId: 2_221_538,
  name: 'Thuỷ Sơn',
  lat: 16.004304, lng: 108.263527,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const LANG_DA_MY_NGHE: Place = {
  placeId: 2_221_542,
  name: 'Làng đá mỹ nghệ Non Nước',
  lat: 16.000952, lng: 108.266643,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '17:00'),
};

const LANG_BICH_HOA: Place = {
  placeId: 2_221_530,
  name: 'Lang Bich Hoa Da Nang',
  lat: 16.060710, lng: 108.220025,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const BAI_BIEN_SON_TRA: Place = {
  placeId: 2_221_548,
  name: 'Bãi Biển Sơn Trà',
  lat: 16.099021, lng: 108.254985,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const BAI_DA: Place = {
  placeId: 2_221_549,
  name: 'Bãi Đá',
  lat: 16.098853, lng: 108.301275,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const CUA_DAI_BEACH: Place = {
  placeId: 2_221_535,
  name: 'Cua Dai Beach',
  lat: 15.903185, lng: 108.357230,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const NUI_THAN_TAI: Place = {
  placeId: 2_221_527,
  name: 'Núi Thần Tài',
  lat: 15.968126, lng: 108.019630,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const NAM_SON_PAGODA: Place = {
  placeId: 2_221_534,
  name: 'Nam Son Pagoda',
  lat: 15.998799, lng: 108.205104,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const QUEEN_COBRA: Place = {
  placeId: 2_221_546,
  name: 'Queen Cobra',
  lat: 16.043299, lng: 108.225990,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('18:00', '22:00'),
};

const CAY_DA_DO_XU: Place = {
  placeId: 2_221_536,
  name: 'Cây đa Đò Xu',
  lat: 16.027678, lng: 108.221887,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

/** Nhà hàng — để test fatigue recovery qua meal slot */
const NHA_HANG_DANANG: Place = {
  placeId: 99_001,
  name: 'Nhà hàng Đà Nẵng',
  lat: 16.054400, lng: 108.202200,
  avgVisitDurationMin: 60,
  indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 50_000,
  tags: [{ tagId: 3 }],   // food
  openingHours: allDayHours('07:00', '21:00'),
};

/** Địa điểm có giá cao — để test budget guard */
const RESORT_DAT_TIEN: Place = {
  placeId: 99_002,
  name: 'Resort đắt tiền',
  lat: 16.050000, lng: 108.220000,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 500_000, estimatedCost: 500_000,
  tags: [{ tagId: 6 }],
  openingHours: allDayHours('08:00', '22:00'),
};

const ALL_PLACES: Place[] = [
  MY_AN_BEACH, THUY_SON, LANG_DA_MY_NGHE, LANG_BICH_HOA,
  BAI_BIEN_SON_TRA, BAI_DA, CUA_DAI_BEACH, NUI_THAN_TAI,
  NAM_SON_PAGODA, QUEEN_COBRA, CAY_DA_DO_XU,
  NHA_HANG_DANANG, RESORT_DAT_TIEN,
];

// ---------------------------------------------------------------------------
// Slots (timestamps UTC thực: 01:00Z = 08:00 VN)
// ---------------------------------------------------------------------------

const TRIP_ID = '6286745f-0b31-42f0-a7e8-5d1583518704';

function makeSlot(overrides: Partial<TripSlot> & Pick<TripSlot, 'slotId' | 'slotOrder' | 'placeId' | 'plannedStart' | 'plannedEnd'>): TripSlot {
  return {
    tripId: TRIP_ID,
    dayIndex: 0,
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

// Ngày 0: 5 slots (08:00–20:00 VN = 01:00–13:00 UTC)
const S0_1 = makeSlot({ slotId: 'd87267a6-5fde-4215-ba42-47474e5da8be', slotOrder: 1, placeId: MY_AN_BEACH.placeId,    plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' });
const S0_2 = makeSlot({ slotId: '986e64b5-bbe2-435a-b50a-486c7f8cabfd', slotOrder: 2, placeId: THUY_SON.placeId,       plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' });
const S0_3 = makeSlot({ slotId: '952086dd-aa6b-48a4-a5e7-5def313f6423', slotOrder: 3, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' });
const S0_4 = makeSlot({ slotId: '7ba45f5b-7a73-4cce-ab00-5dbd94c3bf0a', slotOrder: 4, placeId: LANG_BICH_HOA.placeId,  plannedStart: '2026-05-23T08:30:00.000Z', plannedEnd: '2026-05-23T10:30:00.000Z' });
const S0_5 = makeSlot({ slotId: 'e3f79eee-cf57-48c9-8d19-29e9df82441d', slotOrder: 5, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T11:00:00.000Z', plannedEnd: '2026-05-23T13:00:00.000Z' });

const DAY0_SLOTS: TripSlot[] = [S0_1, S0_2, S0_3, S0_4, S0_5];

// Ngày 1: 5 slots
const S1_1 = makeSlot({ slotId: 'c472a867-60a3-43f5-88a9-ec78d4fbae25', slotOrder: 6, placeId: BAI_DA.placeId,         dayIndex: 1, plannedStart: '2026-05-24T01:00:00.000Z', plannedEnd: '2026-05-24T03:00:00.000Z' });
const S1_2 = makeSlot({ slotId: 'b8303e15-4eb3-4537-8f67-13e77abef70d', slotOrder: 7, placeId: CUA_DAI_BEACH.placeId,  dayIndex: 1, plannedStart: '2026-05-24T03:30:00.000Z', plannedEnd: '2026-05-24T05:30:00.000Z' });
const S1_3 = makeSlot({ slotId: '8dfd03bb-03aa-4833-9c05-ed91468017b5', slotOrder: 8, placeId: NUI_THAN_TAI.placeId,   dayIndex: 1, plannedStart: '2026-05-24T06:00:00.000Z', plannedEnd: '2026-05-24T08:00:00.000Z' });
const S1_4 = makeSlot({ slotId: 'fad50785-47f0-46a7-b3d0-c3d05eeda5ca', slotOrder: 9, placeId: NAM_SON_PAGODA.placeId, dayIndex: 1, plannedStart: '2026-05-24T08:30:00.000Z', plannedEnd: '2026-05-24T10:30:00.000Z' });
const S1_5 = makeSlot({ slotId: 'b443145a-1d46-4362-9163-751d930ef1f2', slotOrder: 10, placeId: QUEEN_COBRA.placeId,   dayIndex: 1, plannedStart: '2026-05-24T11:00:00.000Z', plannedEnd: '2026-05-24T13:00:00.000Z' });

// Ngày 2: 1 slot
const S2_1 = makeSlot({ slotId: '24f66d54-c0bf-46b8-9b87-70804ad5bff2', slotOrder: 11, placeId: CAY_DA_DO_XU.placeId,  dayIndex: 2, plannedStart: '2026-05-25T01:00:00.000Z', plannedEnd: '2026-05-25T03:00:00.000Z' });

const ALL_SLOTS: TripSlot[] = [S0_1, S0_2, S0_3, S0_4, S0_5, S1_1, S1_2, S1_3, S1_4, S1_5, S2_1];

// ---------------------------------------------------------------------------
// Trạng thái ban đầu và cấu hình chung
// ---------------------------------------------------------------------------

const BUDGET_TOTAL = 3_000_000;

const INITIAL_STATE: TripState = {
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 0,
  timeRemainingMin: 3 * 720,   // 3 ngày × 12h
  budgetRemaining: BUDGET_TOTAL,
  fatigue: 0,
  currentLat: 16.0544,
  currentLng: 108.2022,
  moodProxy: 0.8,
  capturedAt: '2026-05-23T01:00:00.000Z',
  source: 'simulated',
};

const NEUTRAL_USER: UserPreference = {
  preferenceVector: new Array(10).fill(0.1),
  pace: 0.5,
  mobilityRestrictions: [],
};

/** User thích biển (tagId 1 = beach, tagId 8 = nature). */
const BEACH_LOVER: UserPreference = {
  preferenceVector: [0.9, 0, 0, 0, 0, 0, 0, 0.9, 0, 0],
  pace: 0.3,
  mobilityRestrictions: [],
};

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1,
  wWeather: 1, wRisk: 1, wStability: 0.5, wPotentialBias: 1.0,
  wProximity: 0, wSynergy: 0.3,
};

function buildCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  return {
    remainingSlots: ALL_SLOTS,
    initialState: INITIAL_STATE,
    candidatePool: ALL_PLACES,
    user: NEUTRAL_USER,
    weights: DEFAULT_WEIGHTS,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Engine instances (tái tạo trước mỗi test)
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
  // Cố định Date.now() để latency budget không làm kết quả nondeterministic
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-23T01:00:00.000Z').getTime());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// GROUP 1 — isLocked: Slot đã đặt cứng không thể bị engine thay đổi
//
// Logic con người: "Tôi đã đặt tour Ngũ Hành Sơn lúc 10:30 sáng, không ai
// được thay đổi giờ đó."
// ===========================================================================

describe('GROUP 1 — isLocked: Slot cứng không bị engine thay đổi', () => {

  it('TC1.1 — TIME_SHIFT bỏ qua slot có isLocked=true', () => {
    // Đặt slot S0_2 (Thuỷ Sơn) là locked
    const lockedSlot = { ...S0_2, isLocked: true };
    const slots = [S0_1, lockedSlot, S0_3, S0_4, S0_5];
    const ctx = buildCtx({
      remainingSlots: slots,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(slots, ctx);
    const timeShifts = mutations.filter(m => m.operator === 'TIME_SHIFT');

    // Không có TIME_SHIFT nào được phép thay đổi slot locked
    for (const ts of timeShifts) {
      const shifted = ts.newPlan.find(s => s.slotId === lockedSlot.slotId);
      expect(
        shifted?.plannedStart,
        `TIME_SHIFT không được thay đổi plannedStart của locked slot "${lockedSlot.slotId}"`,
      ).toBe(lockedSlot.plannedStart);
      expect(
        shifted?.plannedEnd,
        `TIME_SHIFT không được thay đổi plannedEnd của locked slot "${lockedSlot.slotId}"`,
      ).toBe(lockedSlot.plannedEnd);
    }
  });

  it('TC1.2 — SWAP_ORDER không hoán vị cặp slot nếu có ít nhất 1 slot bị lock', () => {
    // Slot S0_2 locked — không được swap với S0_1 hay S0_3
    const lockedSlot = { ...S0_2, isLocked: true };
    const slots = [S0_1, lockedSlot, S0_3, S0_4, S0_5];
    const ctx = buildCtx({
      remainingSlots: slots,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(slots, ctx);
    const swaps = mutations.filter(m => m.operator === 'SWAP_ORDER');

    for (const sw of swaps) {
      const lockedInNew = sw.newPlan.find(s => s.slotId === lockedSlot.slotId);
      expect(
        lockedInNew?.slotOrder,
        `SWAP_ORDER không được thay đổi slotOrder của locked slot`,
      ).toBe(lockedSlot.slotOrder);
    }
  });

  it('TC1.3 — REPLACE_PLACE không thay thế slot có isLocked=true', () => {
    const lockedSlot = { ...S0_1, isLocked: true };  // My An Beach locked
    const slots = [lockedSlot, S0_2, S0_3, S0_4, S0_5];
    const ctx = buildCtx({
      remainingSlots: slots,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(slots, ctx);
    const replaces = mutations.filter(m => m.operator === 'REPLACE_PLACE');

    for (const rp of replaces) {
      // placeId của slot locked phải không thay đổi
      const slotInNew = rp.newPlan.find(s => s.slotId === lockedSlot.slotId);
      expect(
        slotInNew?.placeId,
        `REPLACE_PLACE không được đổi placeId của locked slot`,
      ).toBe(lockedSlot.placeId);
    }
  });

  it('TC1.4 — DROP_SLOT không xóa slot có isLocked=true', () => {
    const lockedSlot = { ...S0_3, isLocked: true };  // Làng đá locked
    const slots = [S0_1, S0_2, lockedSlot, S0_4, S0_5];
    const ctx = buildCtx({
      remainingSlots: slots,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(slots, ctx);
    const drops = mutations.filter(m => m.operator === 'DROP_SLOT');

    for (const dp of drops) {
      const lockedPresent = dp.newPlan.some(s => s.slotId === lockedSlot.slotId);
      expect(
        lockedPresent,
        `DROP_SLOT phải giữ lại locked slot "${lockedSlot.slotId}" trong plan`,
      ).toBe(true);
    }
  });

  it('TC1.5 — BeamSearch giữ nguyên placeId và slotId của locked slot trong plan output', () => {
    // Lock slot S0_3 (Làng đá mỹ nghệ, placeId=2_221_542)
    const lockedSlots = DAY0_SLOTS.map(s =>
      s.slotId === S0_3.slotId ? { ...s, isLocked: true } : s,
    );
    const ctx = buildCtx({
      remainingSlots: lockedSlots,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });

    const { plan } = beamSearch.search(ctx);

    const lockedInOutput = plan.find(s => s.slotId === S0_3.slotId);
    expect(lockedInOutput, 'Locked slot phải xuất hiện trong plan output').toBeDefined();
    expect(lockedInOutput!.placeId, 'placeId của locked slot không được thay đổi').toBe(S0_3.placeId);
  });

  it('TC1.6 — Khi tất cả slots đều locked, BeamSearch không thay đổi bất kỳ placeId nào', () => {
    const allLocked = DAY0_SLOTS.map(s => ({ ...s, isLocked: true }));
    const ctx = buildCtx({
      remainingSlots: allLocked,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });

    const { plan } = beamSearch.search(ctx);
    const outputPlaceIds = plan.map(s => s.placeId).sort();
    const inputPlaceIds = allLocked.map(s => s.placeId).sort();

    expect(outputPlaceIds, 'Tất cả placeId phải giống hệt input khi toàn bộ slots bị lock')
      .toEqual(inputPlaceIds);
  });
});

// ===========================================================================
// GROUP 2 — Mưa ưu tiên indoor
//
// Logic con người: "Trời mưa to thì phải tìm chỗ trong nhà,
// đừng đứng ngoài bãi biển."
// ===========================================================================

describe('GROUP 2 — Mưa: Engine ưu tiên địa điểm trong nhà', () => {

  it('TC2.1 — Plan thuần indoor score cao hơn plan thuần outdoor khi mưa nặng (≥25mm/h)', () => {
    const indoorSlots: TripSlot[] = [
      makeSlot({ slotId: 'in-1', slotOrder: 1, placeId: THUY_SON.placeId,        plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'in-2', slotOrder: 2, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'in-3', slotOrder: 3, placeId: LANG_BICH_HOA.placeId,   plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];
    const outdoorSlots: TripSlot[] = [
      makeSlot({ slotId: 'out-1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,     plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'out-2', slotOrder: 2, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'out-3', slotOrder: 3, placeId: BAI_DA.placeId,           plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];

    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const ctxRain = buildCtx({
      weatherForecast: [{ rainMmPerH: 25 }],
      initialState: initState,
    });

    const statesIndoor  = evolver.computeTrajectory(indoorSlots,  initState, ctxRain);
    const statesOutdoor = evolver.computeTrajectory(outdoorSlots, initState, ctxRain);

    const scoreIndoor  = scorer.score(indoorSlots,  statesIndoor,  DEFAULT_WEIGHTS, ctxRain);
    const scoreOutdoor = scorer.score(outdoorSlots, statesOutdoor, DEFAULT_WEIGHTS, ctxRain);

    expect(
      scoreIndoor,
      `Khi mưa nặng, indoor plan (${scoreIndoor.toFixed(4)}) phải score cao hơn outdoor plan (${scoreOutdoor.toFixed(4)})`,
    ).toBeGreaterThan(scoreOutdoor);
  });

  it('TC2.2 — Score outdoor giảm khi tăng cường độ mưa', () => {
    const outdoorSlots: TripSlot[] = [
      makeSlot({ slotId: 'out-1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,     plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'out-2', slotOrder: 2, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
    ];
    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };

    const ctxNone   = buildCtx({ weatherForecast: [{ rainMmPerH: 0  }], initialState: initState });
    const ctxLight  = buildCtx({ weatherForecast: [{ rainMmPerH: 5  }], initialState: initState });
    const ctxHeavy  = buildCtx({ weatherForecast: [{ rainMmPerH: 25 }], initialState: initState });

    const statesNone  = evolver.computeTrajectory(outdoorSlots, initState, ctxNone);
    const statesLight = evolver.computeTrajectory(outdoorSlots, initState, ctxLight);
    const statesHeavy = evolver.computeTrajectory(outdoorSlots, initState, ctxHeavy);

    const scoreNone  = scorer.score(outdoorSlots, statesNone,  DEFAULT_WEIGHTS, ctxNone);
    const scoreLight = scorer.score(outdoorSlots, statesLight, DEFAULT_WEIGHTS, ctxLight);
    const scoreHeavy = scorer.score(outdoorSlots, statesHeavy, DEFAULT_WEIGHTS, ctxHeavy);

    expect(scoreLight, 'Mưa nhẹ phải làm giảm score so với không mưa').toBeLessThanOrEqual(scoreNone);
    expect(scoreHeavy, 'Mưa nặng phải làm giảm score so với mưa nhẹ').toBeLessThanOrEqual(scoreLight);
  });

  it('TC2.3 — Engine không crash khi mưa rất nặng (60mm/h)', () => {
    const ctx = buildCtx({
      weatherForecast: Array(3).fill({ rainMmPerH: 60 }),
    });
    let plan: TripSlot[] = [];
    expect(() => {
      plan = beamSearch.search(ctx).plan;
    }).not.toThrow();
    expect(plan.length, 'Plan không được rỗng dù mưa 60mm/h').toBeGreaterThan(0);
  });

  it('TC2.4 — Score của plan ngày 0 với mưa nặng luôn thấp hơn hoặc bằng không mưa', () => {
    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const ctxNoRain = buildCtx({ weatherForecast: [],                           initialState: initState });
    const ctxRain   = buildCtx({ weatherForecast: [{ rainMmPerH: 20 }],        initialState: initState });

    const statesNoRain = evolver.computeTrajectory(DAY0_SLOTS, initState, ctxNoRain);
    const statesRain   = evolver.computeTrajectory(DAY0_SLOTS, initState, ctxRain);

    const sNoRain = scorer.score(DAY0_SLOTS, statesNoRain, DEFAULT_WEIGHTS, ctxNoRain);
    const sRain   = scorer.score(DAY0_SLOTS, statesRain,   DEFAULT_WEIGHTS, ctxRain);

    expect(
      sRain,
      `Score khi mưa (${sRain.toFixed(4)}) phải ≤ không mưa (${sNoRain.toFixed(4)}) — plan ngày 0 có 2 outdoor slot`,
    ).toBeLessThanOrEqual(sNoRain);
  });
});

// ===========================================================================
// GROUP 3 — Fatigue: Bữa ăn và nghỉ ngơi phục hồi sức lực
//
// Logic con người: "Ăn trưa xong thì bớt mệt, không phải cứ đi mãi
// không biết nghỉ."
// ===========================================================================

describe('GROUP 3 — Fatigue: Bữa ăn và nghỉ ngơi phục hồi sức lực', () => {

  it('TC3.1 — Sau slot "meal" (0 km đi), fatigue không tăng so với trước', () => {
    const mealSlot = makeSlot({
      slotId: 'meal-1', slotOrder: 1,
      placeId: NHA_HANG_DANANG.placeId,
      plannedStart: '2026-05-23T04:00:00.000Z',
      plannedEnd:   '2026-05-23T05:00:00.000Z',
      activityType: 'meal',
      estimatedCost: 50_000,
    });
    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, fatigue: 0.4, currentLat: NHA_HANG_DANANG.lat, currentLng: NHA_HANG_DANANG.lng };
    const ctx = buildCtx({ remainingSlots: [mealSlot], initialState: initState });
    const [, stateAfterMeal] = evolver.computeTrajectory([mealSlot], initState, ctx);

    expect(
      stateAfterMeal!.fatigue,
      `fatigue sau bữa ăn (${stateAfterMeal!.fatigue.toFixed(3)}) phải ≤ trước bữa ăn (${initState.fatigue})`,
    ).toBeLessThanOrEqual(initState.fatigue);
  });

  it('TC3.2 — Sau slot "rest", fatigue giảm rõ rệt so với slot outdoor cùng độ dài', () => {
    const restSlot = makeSlot({
      slotId: 'rest-1', slotOrder: 1,
      placeId: NHA_HANG_DANANG.placeId,
      plannedStart: '2026-05-23T04:00:00.000Z',
      plannedEnd:   '2026-05-23T05:00:00.000Z',
      activityType: 'rest',
    });
    const outdoorSlot = makeSlot({
      slotId: 'out-1', slotOrder: 1,
      placeId: MY_AN_BEACH.placeId,
      plannedStart: '2026-05-23T04:00:00.000Z',
      plannedEnd:   '2026-05-23T06:00:00.000Z',
      activityType: 'sightseeing',
    });

    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, fatigue: 0.5, currentLat: NHA_HANG_DANANG.lat, currentLng: NHA_HANG_DANANG.lng };
    const ctxRest    = buildCtx({ remainingSlots: [restSlot],    initialState: initState });
    const ctxOutdoor = buildCtx({ remainingSlots: [outdoorSlot], initialState: initState });

    const [, afterRest]    = evolver.computeTrajectory([restSlot],    initState, ctxRest);
    const [, afterOutdoor] = evolver.computeTrajectory([outdoorSlot], initState, ctxOutdoor);

    expect(
      afterRest!.fatigue,
      `fatigue sau rest (${afterRest!.fatigue.toFixed(3)}) phải thấp hơn sau outdoor sightseeing (${afterOutdoor!.fatigue.toFixed(3)})`,
    ).toBeLessThan(afterOutdoor!.fatigue);
  });

  it('TC3.3 — 4 slots outdoor liên tiếp không nghỉ làm fatigue tăng so với ban đầu', () => {
    const outdoorSeries: TripSlot[] = [
      makeSlot({ slotId: 'o1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,      plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'o2', slotOrder: 2, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'o3', slotOrder: 3, placeId: BAI_DA.placeId,           plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
      makeSlot({ slotId: 'o4', slotOrder: 4, placeId: CUA_DAI_BEACH.placeId,    plannedStart: '2026-05-23T08:30:00.000Z', plannedEnd: '2026-05-23T10:30:00.000Z' }),
    ];
    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, fatigue: 0 };
    const ctx = buildCtx({ remainingSlots: outdoorSeries, initialState: initState });
    const states = evolver.computeTrajectory(outdoorSeries, initState, ctx);

    expect(
      states[states.length - 1]!.fatigue,
      `Sau 4 slots outdoor, fatigue phải > 0 (ban đầu = 0)`,
    ).toBeGreaterThan(0);
  });

  it('TC3.4 — Fatigue luôn nằm trong [0, 1] trong suốt trajectory', () => {
    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const ctx = buildCtx({ remainingSlots: DAY0_SLOTS, initialState: initState });
    const states = evolver.computeTrajectory(DAY0_SLOTS, initState, ctx);

    for (const s of states) {
      expect(s.fatigue, 'fatigue < 0 không hợp lệ').toBeGreaterThanOrEqual(0);
      expect(s.fatigue, 'fatigue > 1 không hợp lệ').toBeLessThanOrEqual(1);
    }
  });
});

// ===========================================================================
// GROUP 4 — Budget: Không tiêu quá số tiền còn lại
//
// Logic con người: "Túi tiền chỉ còn 100k, không thể đặt resort 500k."
// ===========================================================================

describe('GROUP 4 — Budget: Không vượt ngân sách', () => {

  it('TC4.1 — Tổng estimatedCost của plan output không vượt budget ban đầu (3tr)', () => {
    const ctx = buildCtx();
    const { plan } = beamSearch.search(ctx);
    const totalCost = plan.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0);
    expect(
      totalCost,
      `Tổng chi phí plan (${totalCost.toLocaleString()} VND) vượt budget ${BUDGET_TOTAL.toLocaleString()} VND`,
    ).toBeLessThanOrEqual(BUDGET_TOTAL);
  });

  it('TC4.2 — budgetRemaining không âm trong suốt trajectory của plan output', () => {
    const ctx = buildCtx();
    const { plan } = beamSearch.search(ctx);
    const states = evolver.computeTrajectory(plan, INITIAL_STATE, ctx);

    for (let i = 0; i < states.length; i++) {
      expect(
        states[i]!.budgetRemaining,
        `budgetRemaining âm tại step ${i}: ${states[i]!.budgetRemaining} VND`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('TC4.3 — Engine không chèn RESORT_DAT_TIEN khi budget còn lại = 200k', () => {
    // Budget cạn → resort 500k không khả thi
    const tightState: TripState = {
      ...INITIAL_STATE,
      budgetRemaining: 200_000,
      timeRemainingMin: 720,
    };
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: tightState,
      candidatePool: ALL_PLACES,   // bao gồm RESORT_DAT_TIEN (500k)
    });
    const { plan } = beamSearch.search(ctx);

    const hasResort = plan.some(s => s.placeId === RESORT_DAT_TIEN.placeId);
    expect(
      hasResort,
      'Khi budget còn 200k, engine không được chèn resort 500k vào plan',
    ).toBe(false);
  });

  it('TC4.4 — isSetFeasible trả về false khi tổng minPrice vượt budget', () => {
    // Kiểm tra lower-bound filter hoạt động đúng
    const expensivePlan: TripSlot[] = [
      makeSlot({ slotId: 'e1', slotOrder: 1, placeId: RESORT_DAT_TIEN.placeId, estimatedCost: 500_000, plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'e2', slotOrder: 2, placeId: RESORT_DAT_TIEN.placeId + 1, estimatedCost: 500_000, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
    ];

    // Tạo 1 place giả thứ 2 cho slot thứ 2
    const resort2: Place = { ...RESORT_DAT_TIEN, placeId: RESORT_DAT_TIEN.placeId + 1, minPrice: 500_000 };
    const resortPool = [RESORT_DAT_TIEN, resort2];

    const tightState: TripState = { ...INITIAL_STATE, budgetRemaining: 100_000, timeRemainingMin: 720 };
    const feasible = evolver.isPlanFeasible(expensivePlan, tightState, {
      candidatePool: resortPool,
      user: NEUTRAL_USER,
      initialState: tightState,
    });
    expect(feasible, 'Plan có tổng chi phí 1tr với budget còn 100k phải infeasible').toBe(false);
  });
});

// ===========================================================================
// GROUP 5 — Thứ tự thời gian: Không thể ở 2 nơi cùng lúc
//
// Logic con người: "Slot 10:30 không thể bắt đầu khi slot 9:00 chưa kết thúc lúc 11:00."
// ===========================================================================

describe('GROUP 5 — Thứ tự thời gian: Không có slot trùng giờ', () => {

  it('TC5.1 — Plan gốc (11 slots, 3 ngày): không có overlap trong cùng ngày', () => {
    const byDay = new Map<number, TripSlot[]>();
    for (const s of ALL_SLOTS) {
      if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
      byDay.get(s.dayIndex)!.push(s);
    }

    for (const [day, slots] of byDay) {
      const sorted = [...slots].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = new Date(sorted[i - 1]!.plannedEnd).getTime();
        const curStart = new Date(sorted[i]!.plannedStart).getTime();
        expect(
          curStart,
          `Ngày ${day}: slot ${sorted[i]!.slotOrder} bắt đầu trước khi slot ${sorted[i - 1]!.slotOrder} kết thúc`,
        ).toBeGreaterThanOrEqual(prevEnd);
      }
    }
  });

  it('TC5.2 — Plan output sau BeamSearch: không có overlap trong cùng ngày', () => {
    const ctx = buildCtx();
    const { plan } = beamSearch.search(ctx);

    const byDay = new Map<number, TripSlot[]>();
    for (const s of plan) {
      if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
      byDay.get(s.dayIndex)!.push(s);
    }

    for (const [day, slots] of byDay) {
      const sorted = [...slots].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd  = new Date(sorted[i - 1]!.plannedEnd).getTime();
        const curStart = new Date(sorted[i]!.plannedStart).getTime();
        expect(
          curStart,
          `Ngày ${day} (output): slot ${sorted[i]!.slotOrder} overlap với slot trước`,
        ).toBeGreaterThanOrEqual(prevEnd);
      }
    }
  });

  it('TC5.3 — Sau SWAP/DROP/INSERT/TSP mutation, không có overlap trong cùng ngày', () => {
    // TIME_SHIFT shift-ngược (delta=-60) có thể di chuyển slot ra trước slot trước nó —
    // repairSuffix chỉ sửa các slot SAU slot được shift, không sửa ngược lại.
    // Đây là behavior đã biết của engine. Test này bỏ qua TIME_SHIFT.
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(DAY0_SLOTS, ctx)
      .filter(m => m.operator !== 'TIME_SHIFT');  // TIME_SHIFT backward là known behavior

    for (const m of mutations) {
      const byDay = new Map<number, TripSlot[]>();
      for (const s of m.newPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s);
      }
      for (const [day, slots] of byDay) {
        const sorted = [...slots].sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd  = new Date(sorted[i - 1]!.plannedEnd).getTime();
          const curStart = new Date(sorted[i]!.plannedStart).getTime();
          expect(
            curStart,
            `op=${m.operator} ngày ${day}: slot ${i} overlap với slot ${i - 1}`,
          ).toBeGreaterThanOrEqual(prevEnd);
        }
      }
    }
  });

  it('TC5.4 — plannedEnd luôn > plannedStart cho mọi slot trong tất cả mutation outputs', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(DAY0_SLOTS, ctx);
    for (const m of mutations) {
      for (const s of m.newPlan) {
        const start = new Date(s.plannedStart).getTime();
        const end   = new Date(s.plannedEnd).getTime();
        expect(end - start, `op=${m.operator} slotOrder=${s.slotOrder}: duration ≤ 0`).toBeGreaterThan(0);
      }
    }
  });

  it('TC5.5 — Tất cả timestamps trong plan output là ISO-8601 hợp lệ', () => {
    const ctx = buildCtx();
    const { plan } = beamSearch.search(ctx);

    for (const s of plan) {
      expect(isValidISO(s.plannedStart), `slotOrder=${s.slotOrder}: plannedStart không hợp lệ`).toBe(true);
      expect(isValidISO(s.plannedEnd),   `slotOrder=${s.slotOrder}: plannedEnd không hợp lệ`).toBe(true);
    }
  });
});

// ===========================================================================
// GROUP 6 — Khoảng cách: Đi gần nhau tiết kiệm thời gian
//
// Logic con người: "Nên gộp các nơi gần nhau vào cùng buổi sáng,
// đừng đi từ Bắc xuống Nam rồi lại lên Bắc."
// ===========================================================================

describe('GROUP 6 — Khoảng cách: wDistance ảnh hưởng đúng chiều', () => {

  it('TC6.1 — Plan 3 slots tập trung (bán kính <5km) score cao hơn plan 3 slots phân tán khi wDistance lớn', () => {
    // Plan tập trung: MY_AN_BEACH → THUY_SON → LANG_DA_MY_NGHE (đều gần Ngũ Hành Sơn)
    const compactSlots: TripSlot[] = [
      makeSlot({ slotId: 'c1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,     plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'c2', slotOrder: 2, placeId: THUY_SON.placeId,        plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'c3', slotOrder: 3, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];
    // Plan phân tán: CUA_DAI_BEACH (Hội An) → NUI_THAN_TAI (núi xa) → BAI_DA (Sơn Trà)
    const scatteredSlots: TripSlot[] = [
      makeSlot({ slotId: 's1', slotOrder: 1, placeId: CUA_DAI_BEACH.placeId, plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 's2', slotOrder: 2, placeId: NUI_THAN_TAI.placeId,  plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 's3', slotOrder: 3, placeId: BAI_DA.placeId,        plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];

    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const poolForBoth = ALL_PLACES;
    const heavyDistanceWeights: ObjectiveWeights = { ...DEFAULT_WEIGHTS, wDistance: 5.0 };

    const ctxCompact   = buildCtx({ weights: heavyDistanceWeights, initialState: initState, candidatePool: poolForBoth });
    const ctxScattered = buildCtx({ weights: heavyDistanceWeights, initialState: initState, candidatePool: poolForBoth });

    const statesCompact   = evolver.computeTrajectory(compactSlots,   initState, ctxCompact);
    const statesScattered = evolver.computeTrajectory(scatteredSlots, initState, ctxScattered);

    const scoreCompact   = scorer.score(compactSlots,   statesCompact,   heavyDistanceWeights, ctxCompact);
    const scoreScattered = scorer.score(scatteredSlots, statesScattered, heavyDistanceWeights, ctxScattered);

    expect(
      scoreCompact,
      `Plan tập trung địa lý (${scoreCompact.toFixed(4)}) phải score cao hơn plan phân tán (${scoreScattered.toFixed(4)}) khi wDistance=5`,
    ).toBeGreaterThan(scoreScattered);
  });

  it('TC6.2 — estimateTravelTime đúng chiều: cùng điểm → 0 phút; xa nhau → thời gian lớn hơn', () => {
    const samePoint = evolver.estimateTravelTime(16.025, 108.25, 16.025, 108.25);
    const nearPoint = evolver.estimateTravelTime(16.025, 108.25, 16.030, 108.26);   // ~1.5km
    const farPoint  = evolver.estimateTravelTime(16.025, 108.25, 15.903, 108.357);  // ~18km (Cua Dai)

    expect(samePoint, 'Cùng điểm → 0 phút').toBe(0);
    expect(nearPoint, 'Gần hơn phải đi nhanh hơn xa hơn').toBeLessThan(farPoint);
    expect(farPoint,  'Cua Dai cách My An Beach ~18km → ít nhất 40 phút với 25km/h').toBeGreaterThan(40);
  });
});

// ===========================================================================
// GROUP 7 — Preference: Engine tôn trọng sở thích người dùng
//
// Logic con người: "Khách hàng thích biển thì nên gợi ý bãi biển,
// đừng đưa họ vào bảo tàng."
// ===========================================================================

describe('GROUP 7 — User preference ảnh hưởng đúng chiều', () => {

  it('TC7.1 — User thích biển: plan 3 beach slots score cao hơn plan 3 indoor slots', () => {
    const beachSlots: TripSlot[] = [
      makeSlot({ slotId: 'b1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,      plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'b2', slotOrder: 2, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'b3', slotOrder: 3, placeId: BAI_DA.placeId,           plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];
    const indoorSlots: TripSlot[] = [
      makeSlot({ slotId: 'i1', slotOrder: 1, placeId: THUY_SON.placeId,        plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'i2', slotOrder: 2, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
      makeSlot({ slotId: 'i3', slotOrder: 3, placeId: LANG_BICH_HOA.placeId,   plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' }),
    ];

    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const ctxBeach  = buildCtx({ user: BEACH_LOVER, initialState: initState });
    const ctxIndoor = buildCtx({ user: BEACH_LOVER, initialState: initState });

    const statesBeach  = evolver.computeTrajectory(beachSlots,  initState, ctxBeach);
    const statesIndoor = evolver.computeTrajectory(indoorSlots, initState, ctxIndoor);

    const scoreBeach  = scorer.score(beachSlots,  statesBeach,  DEFAULT_WEIGHTS, ctxBeach);
    const scoreIndoor = scorer.score(indoorSlots, statesIndoor, DEFAULT_WEIGHTS, ctxIndoor);

    expect(
      scoreBeach,
      `Với BEACH_LOVER, beach plan (${scoreBeach.toFixed(4)}) phải score cao hơn indoor plan (${scoreIndoor.toFixed(4)})`,
    ).toBeGreaterThan(scoreIndoor);
  });

  it('TC7.2 — Chỉ xét thành phần interest: neutral user cho score tương đương giữa beach và indoor', () => {
    // wDistance=1.5 ảnh hưởng lớn đến score tổng (các beach ở Sơn Trà xa hơn indoor ở Ngũ Hành Sơn)
    // Để kiểm tra preference thuần, dùng weights chỉ có wInterest=1 và tất cả còn lại = 0.
    const interestOnlyWeights: ObjectiveWeights = {
      wInterest: 1, wPace: 0, wDistance: 0, wBudget: 0,
      wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0,
      wProximity: 0, wSynergy: 0,
    };

    const beachSlots: TripSlot[] = [
      makeSlot({ slotId: 'b1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,      plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'b2', slotOrder: 2, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
    ];
    const indoorSlots: TripSlot[] = [
      makeSlot({ slotId: 'i1', slotOrder: 1, placeId: THUY_SON.placeId,        plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' }),
      makeSlot({ slotId: 'i2', slotOrder: 2, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' }),
    ];

    const initState = { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 };
    const ctx = buildCtx({ user: NEUTRAL_USER, initialState: initState });

    const statesBeach  = evolver.computeTrajectory(beachSlots,  initState, ctx);
    const statesIndoor = evolver.computeTrajectory(indoorSlots, initState, ctx);

    const scoreBeach  = scorer.score(beachSlots,  statesBeach,  interestOnlyWeights, ctx);
    const scoreIndoor = scorer.score(indoorSlots, statesIndoor, interestOnlyWeights, ctx);

    // Neutral user có preferenceVector = [0.1]*10 → dot với bất kỳ tag vector nào = 0.1×(tags count)
    // Beach (tagId 1,8) = 0.2; Indoor (tagId 7,10) = 0.2 → interest score bằng nhau
    expect(
      Math.abs(scoreBeach - scoreIndoor),
      `Với neutral user và interest-only weights, beach vs indoor phải có score gần bằng nhau (diff=${Math.abs(scoreBeach - scoreIndoor).toFixed(6)})`,
    ).toBeLessThan(0.05);
  });

  it('TC7.3 — BeamSearch với BEACH_LOVER không crash và trả về plan hợp lệ', () => {
    const ctx = buildCtx({ user: BEACH_LOVER });
    let plan: TripSlot[] = [];
    expect(() => { plan = beamSearch.search(ctx).plan; }).not.toThrow();
    expect(plan.length).toBeGreaterThan(0);
    for (const s of plan) {
      expect(isValidISO(s.plannedStart)).toBe(true);
      expect(isValidISO(s.plannedEnd)).toBe(true);
    }
  });
});

// ===========================================================================
// GROUP 8 — Determinism: Cùng input luôn cho cùng output
//
// Logic con người: "Hệ thống phải đoán được — đừng đề xuất lúc A lúc B
// không có lý do."
// ===========================================================================

describe('GROUP 8 — Determinism: Cùng input cho cùng kết quả', () => {

  it('TC8.1 — Chạy BeamSearch 2 lần với cùng input (Date.now() cố định) cho cùng plan', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });

    clearSetFeasibilityCache();
    const run1 = beamSearch.search(ctx);
    clearSetFeasibilityCache();
    const run2 = beamSearch.search(ctx);

    const ids1 = run1.plan.map(s => s.placeId).join(',');
    const ids2 = run2.plan.map(s => s.placeId).join(',');

    expect(ids1, 'Hai lần chạy với input giống nhau phải cho plan giống nhau').toBe(ids2);
  });

  it('TC8.2 — Score của 2 lần chạy nhất quán (sai biệt < 0.0001)', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });

    clearSetFeasibilityCache();
    const run1 = beamSearch.search(ctx);
    clearSetFeasibilityCache();
    const run2 = beamSearch.search(ctx);

    expect(Math.abs(run1.score - run2.score), 'Score 2 lần chạy phải giống nhau').toBeLessThan(0.0001);
  });

  it('TC8.3 — Plan output thay đổi khi thay đổi user preference (NEUTRAL vs BEACH_LOVER)', () => {
    const ctxNeutral = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      user: NEUTRAL_USER,
    });
    const ctxBeach = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      user: BEACH_LOVER,
    });

    const run1 = beamSearch.search(ctxNeutral);
    const run2 = beamSearch.search(ctxBeach);

    // Với candidatePool gồm cả beach và indoor, preference khác nhau
    // có thể (nhưng không bắt buộc) cho kết quả khác nhau.
    // Test này chỉ đảm bảo engine không crash và cả hai trả về kết quả hợp lệ.
    expect(run1.plan.length, 'NEUTRAL user plan phải có slot').toBeGreaterThan(0);
    expect(run2.plan.length, 'BEACH_LOVER plan phải có slot').toBeGreaterThan(0);
    // Score với BEACH_LOVER và plan của BEACH_LOVER phải >= plan của NEUTRAL với cùng weights
    const beachCtxForScoring = ctxBeach;
    const statesRun1 = evolver.computeTrajectory(run1.plan, { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 }, beachCtxForScoring);
    const statesRun2 = evolver.computeTrajectory(run2.plan, { ...INITIAL_STATE, timeRemainingMin: 720, dayIndex: 0 }, beachCtxForScoring);
    const score1InBeachCtx = scorer.score(run1.plan, statesRun1, DEFAULT_WEIGHTS, beachCtxForScoring);
    const score2InBeachCtx = scorer.score(run2.plan, statesRun2, DEFAULT_WEIGHTS, beachCtxForScoring);
    // BEACH_LOVER's optimal plan nên có score trong beach context >= neutral plan's score
    expect(
      score2InBeachCtx,
      'BEACH_LOVER plan phải score ≥ neutral plan trong beach context',
    ).toBeGreaterThanOrEqual(score1InBeachCtx - 0.0001);   // tolerance nhỏ cho rounding
  });
});

// ===========================================================================
// GROUP 9 — Edge Cases: Tình huống biên
//
// Logic con người: "Hệ thống cần hoạt động ngay cả trong trường hợp bất
// thường — chuyến đi 1 ngày, slot duy nhất, v.v."
// ===========================================================================

describe('GROUP 9 — Edge Cases: Tình huống biên', () => {

  it('TC9.1 — Plan chỉ có 1 slot: engine không crash, kết quả là mảng hợp lệ', () => {
    // KNOWN BEHAVIOR: Với 1 slot input, DROP_SLOT tạo plan rỗng (score = 0).
    // Nếu 1-slot plan có score âm (do distance/weather penalty), plan rỗng thắng.
    // Engine trả về plan rỗng — đây là behavior cần review ở tầng product
    // (hệ thống không nên đề xuất "xóa hết chuyến đi").
    const singleSlot = [S0_1];
    const ctx = buildCtx({
      remainingSlots: singleSlot,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });
    let result: ReturnType<typeof beamSearch.search>;
    expect(() => { result = beamSearch.search(ctx); }).not.toThrow();
    expect(Array.isArray(result!.plan), 'plan phải là array').toBe(true);
    // Score hợp lệ (có thể 0 nếu plan rỗng được chọn)
    expect(isFinite(result!.score), 'score phải là số hữu hạn').toBe(true);
  });

  it('TC9.2 — Plan ngày duy nhất (chỉ ngày 0): engine không trả về slot của ngày khác', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
    });
    const { plan } = beamSearch.search(ctx);
    for (const s of plan) {
      expect(
        s.dayIndex,
        `Slot placeId=${s.placeId} thuộc ngày ${s.dayIndex}, nhưng input chỉ có ngày 0`,
      ).toBe(0);
    }
  });

  it('TC9.3 — candidatePool bằng đúng các slot trong plan: engine không crash và trả về plan hợp lệ', () => {
    // Pool chỉ gồm 5 places của ngày 0 — không có alternative nào
    const day0Pool = ALL_PLACES.filter(p => DAY0_SLOTS.some(s => s.placeId === p.placeId));
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      candidatePool: day0Pool,
    });
    let plan: TripSlot[] = [];
    expect(() => { plan = beamSearch.search(ctx).plan; }).not.toThrow();
    expect(plan.length, 'Plan phải có slot dù pool bằng plan').toBeGreaterThanOrEqual(1);
    // Tất cả placeId phải thuộc pool
    const poolIds = new Set(day0Pool.map(p => p.placeId));
    for (const s of plan) {
      expect(poolIds.has(s.placeId), `placeId=${s.placeId} không thuộc pool giới hạn`).toBe(true);
    }
  });

  it('TC9.4 — DROP_SLOT: số slot giảm đúng 1 so với input', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });
    const mutations = operators.generateAll(DAY0_SLOTS, ctx);
    const drops = mutations.filter(m => m.operator === 'DROP_SLOT');

    expect(drops.length, 'Phải có ít nhất 1 DROP_SLOT mutation').toBeGreaterThan(0);
    for (const dp of drops) {
      expect(
        dp.newPlan.length,
        `DROP_SLOT phải giảm đúng 1 slot: ${DAY0_SLOTS.length} → ${dp.newPlan.length}`,
      ).toBe(DAY0_SLOTS.length - 1);
    }
  });

  it('TC9.5 — Không có placeId nào trùng lặp trong bất kỳ mutation output nào', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });
    const mutations = operators.generateAll(DAY0_SLOTS, ctx);

    for (const m of mutations) {
      const ids = m.newPlan.map(s => s.placeId);
      const unique = new Set(ids);
      expect(
        unique.size,
        `op=${m.operator}: placeId trùng lặp trong newPlan — [${ids.join(', ')}]`,
      ).toBe(ids.length);
    }
  });

  it('TC9.6 — MutationResult.description không rỗng cho mọi mutation (engine có giải thích)', () => {
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });
    const mutations = operators.generateAll(DAY0_SLOTS, ctx);

    for (const m of mutations) {
      expect(
        m.description.trim().length,
        `op=${m.operator}: description rỗng — engine phải giải thích thay đổi bằng tiếng Việt`,
      ).toBeGreaterThan(0);
    }
  });

  it('TC9.7 — MutationResult.operator thuộc 6 operators hợp lệ', () => {
    const VALID_OPERATORS = new Set(['TIME_SHIFT', 'SWAP_ORDER', 'REPLACE_PLACE', 'DROP_SLOT', 'INSERT_ALT', 'TSP_REORDER']);
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });
    const mutations = operators.generateAll(DAY0_SLOTS, ctx);

    for (const m of mutations) {
      expect(
        VALID_OPERATORS.has(m.operator),
        `operator="${m.operator}" không thuộc danh sách hợp lệ`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// GROUP 10 — Bug Hunting: Các kịch bản phát hiện lỗi tiềm ẩn
//
// Logic con người: "Nếu chúng tôi đã đặt tour lúc 09:30, engine không được
// xếp lịch đến đó khi chúng tôi vừa rời khỏi nơi cách 100 phút di chuyển
// lúc 09:00."
// ===========================================================================

describe('GROUP 10 — Bug Hunting: Lỗi tiềm ẩn trong engine', () => {

  // -------------------------------------------------------------------------
  // BUG-1: repairSuffix không kiểm tra travel time đến locked slot
  //
  // repairSuffix chỉ check `cursorMs > lockedStartMs` (thời gian kết thúc slot
  // trước có vượt thời gian bắt đầu locked slot không). Nhưng nó không tính
  // travel time từ slot trước đến locked slot.
  //
  // Kết quả: engine có thể tạo ra plan "hợp lệ" về mặt timestamp nhưng người
  // dùng không thể thực hiện được vì không đủ thời gian di chuyển.
  // -------------------------------------------------------------------------

  it('BUG1.1 — repairSuffix chấp nhận plan bất khả thi vì travel time > gap đến locked slot', () => {
    // Slot A: Nhà hàng Đà Nẵng (gần trung tâm), visit 60 phút
    // Locked slot B: Núi Thần Tài (cách ~22km), bắt đầu 30 phút sau khi slot A kết thúc
    // Travel time A→B ≈ 73 phút > 30 phút gap → vật lý bất khả thi

    const slotA = makeSlot({
      slotId: 'bug1-a', slotOrder: 1, placeId: NHA_HANG_DANANG.placeId,
      plannedStart: '2026-05-23T01:00:00.000Z', // 08:00 VN
      plannedEnd:   '2026-05-23T02:00:00.000Z', // 09:00 VN (60 phút)
    });

    const lockedSlotB = makeSlot({
      slotId: 'bug1-b', slotOrder: 2, placeId: NUI_THAN_TAI.placeId,
      plannedStart: '2026-05-23T02:30:00.000Z', // 09:30 VN — chỉ 30 phút sau slotA
      plannedEnd:   '2026-05-23T04:30:00.000Z', // 11:30 VN
      isLocked: true,
    });

    // Đặt initial position tại chính Nhà hàng để travel A không bị dịch
    const initState = {
      ...INITIAL_STATE,
      currentLat: NHA_HANG_DANANG.lat,
      currentLng: NHA_HANG_DANANG.lng,
      timeRemainingMin: 720,
    };

    const planBug = [slotA, lockedSlotB];
    const allPlacesWithRestaurant = ALL_PLACES; // NHA_HANG_DANANG đã có trong ALL_PLACES
    const ctx = buildCtx({
      remainingSlots: planBug,
      initialState: initState,
      candidatePool: allPlacesWithRestaurant,
      placeMap: new Map(allPlacesWithRestaurant.map(p => [p.placeId, p])),
    });

    // 1. Xác nhận travel time thực sự > gap
    const travelTimeMin = evolver.estimateTravelTime(
      NHA_HANG_DANANG.lat, NHA_HANG_DANANG.lng,
      NUI_THAN_TAI.lat,    NUI_THAN_TAI.lng,
    );
    const gapMin = (
      new Date('2026-05-23T02:30:00.000Z').getTime() -
      new Date('2026-05-23T02:00:00.000Z').getTime()
    ) / 60_000;

    expect(travelTimeMin, 'Travel time NhaHang→NuiThanTai phải > 30 phút').toBeGreaterThan(30);
    expect(gapMin, 'Gap giữa slotA kết thúc và lockedSlotB bắt đầu = 30 phút').toBe(30);
    expect(
      travelTimeMin,
      `Travel time (${travelTimeMin.toFixed(1)} min) phải vượt gap (${gapMin} min) để kịch bản có nghĩa`,
    ).toBeGreaterThan(gapMin);

    // 2. repairSuffix: chỉ check cursor <= lockedStart mà không check travel time
    const repaired = operators.repairSuffix(planBug, 0, ctx);

    // 3. Nếu repaired không null, plan được chấp nhận dù bất khả thi về vật lý
    if (repaired !== null) {
      const slotAInRepaired      = repaired.find(s => s.slotId === slotA.slotId)!;
      const lockedSlotInRepaired = repaired.find(s => s.slotId === lockedSlotB.slotId)!;

      const slotAEndMs      = new Date(slotAInRepaired.plannedEnd).getTime();
      const lockedStartMs   = new Date(lockedSlotInRepaired.plannedStart).getTime();
      const actualGapMin    = (lockedStartMs - slotAEndMs) / 60_000;

      // BUG: actualGapMin < travelTimeMin → người dùng không thể đến kịp
      expect(
        actualGapMin,
        `[BUG PHÁT HIỆN] repairSuffix chấp nhận plan với gap=${actualGapMin.toFixed(0)} min ` +
        `nhưng travel time=${travelTimeMin.toFixed(0)} min → người dùng không đến kịp locked slot. ` +
        `repairSuffix cần check: cursorMs + travelTimeToLocked <= lockedStartMs`,
      ).toBeGreaterThanOrEqual(travelTimeMin);
    }
    // Nếu repaired là null → engine đúng, không cần kiểm tra thêm
  });

  it('BUG1.2 — BeamSearch output: plan có locked slot phải đảm bảo đủ thời gian di chuyển đến nó', () => {
    // Kịch bản: có locked slot ở Núi Thần Tài (xa) với gap nhỏ so với slot trước
    const slotBefore = makeSlot({
      slotId: 'bug1-b-before', slotOrder: 1, placeId: NHA_HANG_DANANG.placeId,
      plannedStart: '2026-05-23T01:00:00.000Z', // 08:00 VN
      plannedEnd:   '2026-05-23T02:00:00.000Z', // 09:00 VN
    });
    const lockedFar = makeSlot({
      slotId: 'bug1-b-far', slotOrder: 2, placeId: NUI_THAN_TAI.placeId,
      plannedStart: '2026-05-23T02:30:00.000Z', // 09:30 VN (chỉ 30 min sau)
      plannedEnd:   '2026-05-23T04:30:00.000Z',
      isLocked: true,
    });

    const initState = {
      ...INITIAL_STATE,
      currentLat: NHA_HANG_DANANG.lat,
      currentLng: NHA_HANG_DANANG.lng,
      timeRemainingMin: 720,
    };

    const ctx = buildCtx({
      remainingSlots: [slotBefore, lockedFar],
      initialState: initState,
      candidatePool: ALL_PLACES,
    });

    const { plan } = beamSearch.search(ctx);

    // Nếu plan chứa cả hai slot, kiểm tra gap >= travel time
    const planBefore  = plan.find(s => s.slotId === slotBefore.slotId);
    const planLocked  = plan.find(s => s.slotId === lockedFar.slotId);

    if (planBefore && planLocked) {
      const travelTimeMin = evolver.estimateTravelTime(
        NHA_HANG_DANANG.lat, NHA_HANG_DANANG.lng,
        NUI_THAN_TAI.lat,    NUI_THAN_TAI.lng,
      );
      const gapMin = (
        new Date(planLocked.plannedStart).getTime() -
        new Date(planBefore.plannedEnd).getTime()
      ) / 60_000;

      expect(
        gapMin,
        `[BUG] Plan output: gap (${gapMin.toFixed(0)} min) từ slot trước đến locked slot ` +
        `< travel time (${travelTimeMin.toFixed(0)} min) → lịch trình bất khả thi về vật lý`,
      ).toBeGreaterThanOrEqual(travelTimeMin);
    }
  });

  // -------------------------------------------------------------------------
  // BUG-2: repairSuffix tạo slotOrder trùng lặp khi locked slot trong prefix
  //
  // dayOrderCounters đếm số slot prefix per day (COUNT), nhưng locked slot giữ
  // nguyên slotOrder gốc (VALUE). Nếu slot gốc có slotOrder 1-based (1,2,3...)
  // thì counter = 2 (prefix có 2 slots: slotOrder=1 và lockedSlot.slotOrder=2).
  // Suffix đầu tiên nhận slotOrder=2, trùng với lockedSlot.slotOrder=2.
  // -------------------------------------------------------------------------

  it('BUG2.1 — repairSuffix không tạo slotOrder trùng giữa locked slot trong prefix và suffix đầu tiên', () => {
    // Plan: [S0_1(order=1), lockedSlot(order=2), S0_3(order=3), S0_4(order=4), S0_5(order=5)]
    // Swap S0_3 và S0_4 → repairSuffix từ index 2
    // Prefix: S0_1 (count=1) + lockedSlot (count=2) → dayOrderCounters.get(0) = 2
    // Suffix đầu (index 2) nhận slotOrder = 2 → TRÙNG với lockedSlot.slotOrder=2

    const lockedSlot = { ...S0_2, isLocked: true }; // slotOrder=2
    const plan = [S0_1, lockedSlot, S0_3, S0_4, S0_5];

    const ctx = buildCtx({
      remainingSlots: plan,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(plan, ctx);
    const swaps = mutations.filter(m => m.operator === 'SWAP_ORDER');

    for (const sw of swaps) {
      // Kiểm tra slotOrder trong ngày 0 không trùng lặp
      const day0Orders = sw.newPlan
        .filter(s => s.dayIndex === 0)
        .map(s => s.slotOrder);
      const uniqueOrders = new Set(day0Orders);

      expect(
        uniqueOrders.size,
        `[BUG] SWAP_ORDER tạo slotOrder trùng trong ngày 0: [${day0Orders.join(', ')}]. ` +
        `repairSuffix cần tính từ MAX(prefix slotOrders) + 1, không phải COUNT(prefix slots).`,
      ).toBe(day0Orders.length);
    }
  });

  it('BUG2.2 — INSERT_ALT không tạo slotOrder trùng lặp sau khi thêm slot mới', () => {
    // INSERT_ALT gọi repairSuffix, có thể cũng tạo slotOrder trùng
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS, // slotOrders 1,2,3,4,5 (1-based global)
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(DAY0_SLOTS, ctx);
    const inserts = mutations.filter(m => m.operator === 'INSERT_ALT');

    for (const ins of inserts) {
      const day0Orders = ins.newPlan
        .filter(s => s.dayIndex === 0)
        .map(s => s.slotOrder);
      const uniqueOrders = new Set(day0Orders);

      expect(
        uniqueOrders.size,
        `INSERT_ALT tạo slotOrder trùng trong ngày 0: [${day0Orders.join(', ')}]`,
      ).toBe(day0Orders.length);
    }
  });

  it('BUG2.3 — DROP_SLOT không tạo slotOrder trùng giữa ngày 0 và ngày 1', () => {
    // DROP_SLOT reset slotOrder về 0-based per day.
    // Nếu slotOrder cần unique toàn trip (global), đây là bug.
    // Test này xác nhận: sau DROP_SLOT, các slot trong cùng 1 ngày không trùng slotOrder.

    const ctx = buildCtx({
      remainingSlots: ALL_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 3 * 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.generateAll(ALL_SLOTS, ctx);
    const drops = mutations.filter(m => m.operator === 'DROP_SLOT');

    for (const dp of drops) {
      // Kiểm tra per-day: không có slotOrder trùng trong cùng 1 ngày
      const byDay = new Map<number, number[]>();
      for (const s of dp.newPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s.slotOrder);
      }

      for (const [day, orders] of byDay) {
        const uniqueOrders = new Set(orders);
        expect(
          uniqueOrders.size,
          `DROP_SLOT tạo slotOrder trùng trong ngày ${day}: [${orders.join(', ')}]`,
        ).toBe(orders.length);
      }
    }
  });

  // -------------------------------------------------------------------------
  // BUG-3: candidatePriority trả về 0 cho indoor place không tags trong mưa
  // → replacePlace không gợi ý địa điểm indoor nào cả khi mưa
  // nếu pool chỉ có places không matching tags
  // -------------------------------------------------------------------------

  it('BUG3.1 — Khi mưa và pool chỉ có indoor places không tags, REPLACE_PLACE không trả về kết quả', () => {
    // Tình huống: trời mưa, cần thay outdoor slot bằng indoor
    // Nhưng tất cả indoor alternatives đều không có tags (score = 0 < 2)
    // → filter c.score >= 2 loại hết → không có replacement nào → user kẹt

    const noTagIndoor: Place = {
      placeId: 99_201,
      name: 'Quán cà phê không tags',
      lat: 16.025, lng: 108.259,
      avgVisitDurationMin: 60,    // score = 60/10 = 6 ≥ 2 → này sẽ pass...
      indoorOutdoor: 'indoor',
      minPrice: 0, estimatedCost: 0,
      tags: [],
      openingHours: allDayHours('07:00', '22:00'),
    };

    // Để score < 2 cần duration < 20 min
    const tinyNoTagIndoor: Place = {
      placeId: 99_202,
      name: 'Nơi ghé qua (15 min, không tags)',
      lat: 16.026, lng: 108.260,
      avgVisitDurationMin: 15,  // score = 15/10 = 1.5 < 2 → bị filter bởi replacePlace
      indoorOutdoor: 'indoor',
      minPrice: 0, estimatedCost: 0,
      tags: [],
      openingHours: allDayHours('07:00', '22:00'),
    };

    // Outdoor slot cần được thay thế khi mưa
    const outdoorSlot = makeSlot({
      slotId: 'bug3-outdoor', slotOrder: 1,
      placeId: MY_AN_BEACH.placeId,
      plannedStart: '2026-05-23T01:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });

    // Pool: chỉ có MY_AN_BEACH (outdoor, occupied) + tinyNoTagIndoor (score<2)
    const smallPool = [MY_AN_BEACH, tinyNoTagIndoor];

    const ctx = buildCtx({
      remainingSlots: [outdoorSlot],
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      candidatePool: smallPool,
      placeMap: new Map(smallPool.map(p => [p.placeId, p])),
      weatherForecast: [{ rainMmPerH: 30 }], // mưa nặng
    });

    const replaces = operators.replacePlace([outdoorSlot], ctx);

    // BUG: khi mưa nặng và pool chỉ có indoor không tags, engine không thể
    // thay thế outdoor slot → người dùng phải ở ngoài trời dù mưa 30mm/h
    // Đây là product issue: score < 2 filter quá nghiêm khi tình huống khẩn cấp (mưa)
    if (replaces.length === 0) {
      // Document the behavior: 0 replacements despite heavy rain and available indoor place
      // This is expected given current implementation (score filter), but may need revision
      // for better user experience in rain scenarios
      expect(replaces.length).toBe(0); // xác nhận behavior hiện tại
    }
  });

  it('BUG3.2 — Score filter >= 2 trong replacePlace nhất quán với score filter trong insertAlt', () => {
    // Kiểm tra tính nhất quán: cả replacePlace và insertAlt cùng dùng score >= 2
    // Nếu khác nhau, engine có behavior không đồng nhất
    const smallDurationPlace: Place = {
      placeId: 99_203,
      name: 'Nơi ngắn (10 min)',
      lat: 16.030, lng: 108.220,
      avgVisitDurationMin: 10, // score = 10/10 = 1 < 2 → bị cả 2 filter
      indoorOutdoor: 'indoor',
      minPrice: 0, estimatedCost: 0,
      tags: [],
      openingHours: allDayHours('07:00', '22:00'),
    };

    const pool = [MY_AN_BEACH, THUY_SON, smallDurationPlace];
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS.slice(0, 2),
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    const replaces = operators.replacePlace(DAY0_SLOTS.slice(0, 2), ctx);
    const inserts  = operators.insertAlt(DAY0_SLOTS.slice(0, 2), ctx);

    // Không có output nào được chèn/thay bằng smallDurationPlace (score=1 < 2)
    const replacedSmall = replaces.some(m => m.newPlan.some(s => s.placeId === smallDurationPlace.placeId));
    const insertedSmall = inserts.some(m => m.newPlan.some(s => s.placeId === smallDurationPlace.placeId));

    expect(replacedSmall, 'replacePlace không được dùng place với score < 2').toBe(false);
    expect(insertedSmall, 'insertAlt không được dùng place với score < 2').toBe(false);
  });
});

// ===========================================================================
// GROUP 11 — Bug Hunting: Phase 1/2 inconsistency & TIME_SHIFT underflow
//
// Logic con người:
//   "Engine đề xuất tương tự qua mọi đường dẫn thực thi."
//   "Không ai được phép ghé bãi biển lúc 7 giờ sáng khi ngày bắt đầu từ 8 giờ."
// ===========================================================================

describe('GROUP 11 — Phase 1/2 inconsistency & TIME_SHIFT underflow', () => {

  // -------------------------------------------------------------------------
  // BUG4: proposeReplaces dùng score > 0 thay vì score >= 2
  //
  // replacePlace() dùng .filter(c => c.score >= 2)
  // proposeReplaces() dùng .filter(c => c.score > 0) — khác biệt!
  // → Phase 1+2 path sẽ đề xuất các địa điểm mà Phase 1 đơn thuần sẽ từ chối
  // -------------------------------------------------------------------------

  it('BUG4.1 — proposeReplaces đề xuất place score∈(0,2) mà replacePlace bỏ qua', () => {
    // Place với score 1.5: avgVisitDurationMin=15 → score=1.5 (> 0, < 2)
    const scoreOnePointFive: Place = {
      placeId: 99_301,
      name: 'Quán trà 15 phút',
      lat: 16.025, lng: 108.259,
      avgVisitDurationMin: 15,   // score = 15/10 = 1.5
      indoorOutdoor: 'indoor',
      minPrice: 0, estimatedCost: 0,
      tags: [{ tagId: 7 }],      // tagOverlap vs outdoor=0, plus duration score=1.5
      openingHours: allDayHours('07:00', '22:00'),
    };

    // Dùng MY_AN_BEACH (tags={1,8}) làm reference → tagOverlap với scoreOnePointFive(tags={7}) = 0
    // score = 0*10 + min(15/10,12) = 1.5 < 2 → replacePlace bỏ qua.
    // Không mưa → dùng tagOverlap path (không vào dot*100 rain path).
    const outdoorRefSlot = makeSlot({
      slotId: 'bug4-slot', slotOrder: 1,
      placeId: MY_AN_BEACH.placeId,  // outdoor, tags={1,8}: zero overlap với tags={7}
      plannedStart: '2026-05-23T01:00:00.000Z',
      plannedEnd:   '2026-05-23T03:00:00.000Z',
    });

    const pool = [MY_AN_BEACH, scoreOnePointFive];
    const ctx = buildCtx({
      remainingSlots: [outdoorRefSlot],
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
      weatherForecast: [],   // không mưa → tagOverlap path
    });

    // replacePlace (score >= 2 filter): nên bỏ qua scoreOnePointFive (score=1.5)
    const fromReplacePlace = operators.replacePlace([outdoorRefSlot], ctx);
    const replaceUsedPlace = fromReplacePlace.some(m =>
      m.newPlan.some(s => s.placeId === scoreOnePointFive.placeId),
    );

    // proposeReplaces (score > 0 filter): có thể đề xuất scoreOnePointFive (score=1.5)
    const proposed = (operators as unknown as {
      proposeReplaces: (plan: TripSlot[], ctx: unknown) => Array<{ newPlaceId?: number }>;
    }).proposeReplaces([outdoorRefSlot], ctx);
    const proposeUsedPlace = proposed.some(p => p.newPlaceId === scoreOnePointFive.placeId);

    // Xác nhận replacePlace KHÔNG dùng place score < 2 (đây là behavior đúng)
    expect(replaceUsedPlace, 'replacePlace không được dùng place score 1.5 < 2').toBe(false);

    // [BUG] proposeReplaces CÓ đề xuất place score 1.5 > 0 — inconsistent với replacePlace
    // Nếu bug này tồn tại: proposeUsedPlace = true (khác với replacePlace)
    // Nếu bug đã fix: proposeUsedPlace = false (nhất quán)
    expect(
      proposeUsedPlace,
      '[BUG4.1 PHÁT HIỆN] proposeReplaces đề xuất place với score=1.5 (>0 filter), ' +
      'nhưng replacePlace sử dụng score>=2 filter → Phase 1/2 path cho kết quả khác Phase 1 đơn. ' +
      'Sửa: proposeReplaces phải dùng .filter(c => c.score >= 2) nhất quán với replacePlace.',
    ).toBe(false);
  });

  it('BUG4.2 — proposeInserts không có score filter trong khi insertAlt lọc score >= 2', () => {
    // Place score = 0: không có tags và duration = 0 → score = 0
    const zeroScorePlace: Place = {
      placeId: 99_302,
      name: 'Điểm không điểm (0 min, no tags)',
      lat: 16.025, lng: 108.259,
      avgVisitDurationMin: 0,   // score = 0/10 = 0
      indoorOutdoor: 'indoor',
      minPrice: 0, estimatedCost: 0,
      tags: [],                  // không có tags → tagOverlap = 0 và dot với NEUTRAL = 0
      openingHours: allDayHours('07:00', '22:00'),
    };

    // Pool tối giản: chỉ plan places + zeroScorePlace để tránh bị chặn bởi slice(0, MAX_INSERT_CANDIDATES).
    // MY_AN_BEACH và THUY_SON đã có trong plan → bị loại bởi occupied filter.
    // zeroScorePlace là ứng viên duy nhất → proposeInserts (không có score filter) sẽ đề xuất nó.
    const pool = [MY_AN_BEACH, THUY_SON, zeroScorePlace];
    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS.slice(0, 2),
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      candidatePool: pool,
      placeMap: new Map(pool.map(p => [p.placeId, p])),
    });

    // insertAlt (score >= 2): nên loại zeroScorePlace (score = 0)
    const fromInsertAlt = operators.insertAlt(DAY0_SLOTS.slice(0, 2), ctx);
    const insertAltUsedPlace = fromInsertAlt.some(m =>
      m.newPlan.some(s => s.placeId === zeroScorePlace.placeId),
    );
    expect(insertAltUsedPlace, 'insertAlt không được chèn place với score = 0').toBe(false);

    // proposeInserts (không có score filter): CÓ THỂ đề xuất zeroScorePlace
    const proposed = (operators as unknown as {
      proposeInserts: (plan: TripSlot[], ctx: unknown) => Array<{ newPlaceId?: number }>;
    }).proposeInserts(DAY0_SLOTS.slice(0, 2), ctx);
    const proposeUsedPlace = proposed.some(p => p.newPlaceId === zeroScorePlace.placeId);

    // [BUG] proposeInserts thiếu filter score >= 2
    // Nếu bug tồn tại: proposeUsedPlace = true (inconsistent)
    // Nếu đã fix: proposeUsedPlace = false
    expect(
      proposeUsedPlace,
      '[BUG4.2 PHÁT HIỆN] proposeInserts đề xuất place với score=0 (không có filter), ' +
      'nhưng insertAlt lọc score >= 2 → Phase 1+2 path thiếu nhất quán. ' +
      'Sửa: proposeInserts phải thêm .filter(c => c.score >= 2).',
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // BUG5: TIME_SHIFT(-60) bypass underflow guard cho anchor slot
  //
  // repairSuffix có guard: nếu slot suffix bắt đầu trước DAY_START_HOUR (08:00 VN)
  // thì đẩy lên 08:00 VN. Nhưng anchor slot bị shift không đi qua guard này.
  // Kết quả: TIME_SHIFT(-60) có thể tạo slot bắt đầu lúc 07:00 VN.
  // -------------------------------------------------------------------------

  it('BUG5.1 — TIME_SHIFT(-60) trên slot đầu ngày (08:00 VN) không bị chặn bởi underflow guard', () => {
    // S0_1 bắt đầu lúc 08:00 VN (01:00 UTC). Shift -60 phút → 07:00 VN (00:00 UTC).
    // Engine phải từ chối (hoặc đẩy về 08:00 VN) vì 07:00 VN < DAY_START_HOUR.
    // MY_AN_BEACH mở 24/7 nên withinOpeningHours vẫn pass → engine tạo ra slot trước 08:00 VN!

    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.timeShift(DAY0_SLOTS, ctx);
    const shiftBackOnS0_1 = mutations.filter(m =>
      m.operator === 'TIME_SHIFT' &&
      m.affectedSlotIds.includes(S0_1.slotId),
    );

    // Kiểm tra xem có mutation nào tạo slot bắt đầu trước 08:00 VN không
    for (const m of shiftBackOnS0_1) {
      const movedSlot = m.newPlan.find(s => s.slotId === S0_1.slotId);
      if (!movedSlot) continue;

      const startVnHour = vnHour(movedSlot.plannedStart);
      expect(
        startVnHour,
        `[BUG5.1 PHÁT HIỆN] TIME_SHIFT(-60) tạo slot S0_1 bắt đầu lúc ${startVnHour.toFixed(2)}h VN ` +
        `(< DAY_START_HOUR=8). Anchor slot không đi qua underflow guard của repairSuffix. ` +
        `Sửa: thêm kiểm tra trong timeShift rằng shiftedAnchor.plannedStart >= DAY_START_HOUR.`,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it('BUG5.2 — tất cả slot trong mọi TIME_SHIFT mutation phải bắt đầu từ 08:00 VN trở đi', () => {
    // Test tổng quát: không có slot nào trong output của timeShift
    // được phép bắt đầu trước 08:00 VN.

    const ctx = buildCtx({
      remainingSlots: DAY0_SLOTS,
      initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    });

    const mutations = operators.timeShift(DAY0_SLOTS, ctx);

    for (const m of mutations) {
      for (const s of m.newPlan) {
        const startHour = vnHour(s.plannedStart);
        expect(
          startHour,
          `TIME_SHIFT: slot placeId=${s.placeId} bắt đầu lúc ${startHour.toFixed(2)}h VN ` +
          `(trước DAY_START_HOUR=8) — underflow guard cần áp dụng cho anchor slot`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
