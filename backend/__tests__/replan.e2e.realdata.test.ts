/**
 * replan.e2e.realdata.test.ts
 *
 * End-to-end test dùng dữ liệu thật từ DB (tripId = 6286745f-...) để chạy
 * toàn bộ pipeline replan: BeamSearch → MutationOperators → StateEvolver.
 *
 * Dữ liệu gốc từ DB (query ngày 2026-05-23):
 *   - Chuyến đi Đà Nẵng 3 ngày: 2026-05-23 → 2026-05-25
 *   - Budget: 3,000,000 VND
 *   - 11 slots, 3 ngày, tất cả status = 'planned'
 *   - Không có trip_state_snapshot
 *
 * Lưu ý về timestamp trong dữ liệu gốc:
 *   DB lưu "2026-05-23T08:00:00.000Z" cho slot đầu tiên (= 15:00 VN local).
 *   Đây là bug của planner (tạo giờ local nhưng lưu như UTC).
 *   Test dùng timestamp đã sửa (UTC thực) để engine hoạt động đúng
 *   với khung giờ 08:00–22:00 VN (= 01:00–15:00 UTC).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchContext,
  type BeamNode,
} from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference, ObjectiveWeights } from '@app/types';

// ---------------------------------------------------------------------------
// Constant
// ---------------------------------------------------------------------------

const TRIP_ID = '6286745f-0b31-42f0-a7e8-5d1583518704';
const USER_ID = 'e95b135e-ebde-4845-b2db-2b4cc56cc26b';

// Vietnam UTC+7 offset
const VN_OFFSET_H = 7;

// Trip dates
const TRIP_START = '2026-05-23';
const TRIP_END = '2026-05-25';
const BUDGET_TOTAL = 3_000_000;

// ---------------------------------------------------------------------------
// Opening hour helpers
// ---------------------------------------------------------------------------

function allDayHours(open: string, close: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    openTime: open,
    closeTime: close,
  }));
}

// ---------------------------------------------------------------------------
// Places — dữ liệu thật từ DB (placeId, tọa độ, tags, opening hours)
// ---------------------------------------------------------------------------

const MY_AN_BEACH: Place = {
  placeId: 2_221_547,
  name: 'My An Beach',
  lat: 16.025095,
  lng: 108.2595335,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],      // beach, nature
  openingHours: allDayHours('00:00', '23:59'),
};

const THUY_SON: Place = {
  placeId: 2_221_538,
  name: 'Thuỷ Sơn',
  lat: 16.0043044,
  lng: 108.263527,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],     // entertainment, landmark
  openingHours: allDayHours('08:00', '18:00'),
};

const LANG_DA_MY_NGHE: Place = {
  placeId: 2_221_542,
  name: 'Làng đá mỹ nghệ Non Nước',
  lat: 16.0009523,
  lng: 108.2666434,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '17:00'),
};

const LANG_BICH_HOA: Place = {
  placeId: 2_221_530,
  name: 'Lang Bich hoa Da Nang',
  lat: 16.0607097,
  lng: 108.2200254,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const BAI_BIEN_SON_TRA: Place = {
  placeId: 2_221_548,
  name: 'Bãi Biển Sơn Trà',
  lat: 16.099021,
  lng: 108.2549854,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const BAI_DA: Place = {
  placeId: 2_221_549,
  name: 'Bãi Đá',
  lat: 16.0988527,
  lng: 108.3012745,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const CUA_DAI_BEACH: Place = {
  placeId: 2_221_535,
  name: 'Cua Dai Beach',
  lat: 15.9031848,
  lng: 108.3572298,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'outdoor',  // beach thực ra là outdoor dù DB lưu indoor
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const NUI_THAN_TAI: Place = {
  placeId: 2_221_527,
  name: 'Núi Thần Tài',
  lat: 15.9681262,
  lng: 108.0196301,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const NAM_SON_PAGODA: Place = {
  placeId: 2_221_534,
  name: 'Nam Son Pagoda',
  lat: 15.9987986,
  lng: 108.2051036,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const QUEEN_COBRA: Place = {
  placeId: 2_221_546,
  name: 'Queen Cobra',
  lat: 16.0432987,
  lng: 108.22599,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('18:00', '22:00'),
};

const CAY_DA_DO_XU: Place = {
  placeId: 2_221_536,
  name: 'Cây đa Đò Xu',
  lat: 16.0276784,
  lng: 108.2218873,
  avgVisitDurationMin: 120,
  indoorOutdoor: 'indoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

// Địa điểm "ngoại lai" giả để kiểm tra lọc — sẽ KHÔNG được chèn vào plan
const REST_STOP: Place = {
  placeId: 99_999,
  name: 'Điểm dừng chân Quốc lộ 1A',
  lat: 16.05,
  lng: 108.2,
  avgVisitDurationMin: 15,
  indoorOutdoor: 'outdoor',
  minPrice: 0,
  estimatedCost: 0,
  tags: [],   // không có tag → score = 1.5 < 2 → bị lọc
  openingHours: allDayHours('00:00', '23:59'),
};

// ---------------------------------------------------------------------------
// Slots — dùng timestamp UTC đúng (trừ 7h so với dữ liệu DB gốc)
// Planner lưu sai (08:00 local lưu thành 08:00 UTC); test dùng timestamp thực:
//   08:00 VN = 01:00 UTC → "2026-05-23T01:00:00.000Z"
// ---------------------------------------------------------------------------

// Ngày 0: 2026-05-23 — 5 slots
const SLOT_D0_1: TripSlot = {
  slotId: 'd87267a6-5fde-4215-ba42-47474e5da8be',
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 1,
  version: 1,
  placeId: MY_AN_BEACH.placeId,
  plannedStart: '2026-05-23T01:00:00.000Z',  // 08:00 VN
  plannedEnd:   '2026-05-23T03:00:00.000Z',  // 10:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D0_2: TripSlot = {
  slotId: '986e64b5-bbe2-435a-b50a-486c7f8cabfd',
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 2,
  version: 1,
  placeId: THUY_SON.placeId,
  plannedStart: '2026-05-23T03:30:00.000Z',  // 10:30 VN
  plannedEnd:   '2026-05-23T05:30:00.000Z',  // 12:30 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D0_3: TripSlot = {
  slotId: '952086dd-aa6b-48a4-a5e7-5def313f6423',
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 3,
  version: 1,
  placeId: LANG_DA_MY_NGHE.placeId,
  plannedStart: '2026-05-23T06:00:00.000Z',  // 13:00 VN
  plannedEnd:   '2026-05-23T08:00:00.000Z',  // 15:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D0_4: TripSlot = {
  slotId: '7ba45f5b-7a73-4cce-ab00-5dbd94c3bf0a',
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 4,
  version: 1,
  placeId: LANG_BICH_HOA.placeId,
  plannedStart: '2026-05-23T08:30:00.000Z',  // 15:30 VN
  plannedEnd:   '2026-05-23T10:30:00.000Z',  // 17:30 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D0_5: TripSlot = {
  slotId: 'e3f79eee-cf57-48c9-8d19-29e9df82441d',
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 5,
  version: 1,
  placeId: BAI_BIEN_SON_TRA.placeId,
  plannedStart: '2026-05-23T11:00:00.000Z',  // 18:00 VN
  plannedEnd:   '2026-05-23T13:00:00.000Z',  // 20:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

// Ngày 1: 2026-05-24 — 5 slots
const SLOT_D1_1: TripSlot = {
  slotId: 'c472a867-60a3-43f5-88a9-ec78d4fbae25',
  tripId: TRIP_ID,
  dayIndex: 1,
  slotOrder: 6,
  version: 1,
  placeId: BAI_DA.placeId,
  plannedStart: '2026-05-24T01:00:00.000Z',  // 08:00 VN
  plannedEnd:   '2026-05-24T03:00:00.000Z',  // 10:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D1_2: TripSlot = {
  slotId: 'b8303e15-4eb3-4537-8f67-13e77abef70d',
  tripId: TRIP_ID,
  dayIndex: 1,
  slotOrder: 7,
  version: 1,
  placeId: CUA_DAI_BEACH.placeId,
  plannedStart: '2026-05-24T03:30:00.000Z',  // 10:30 VN
  plannedEnd:   '2026-05-24T05:30:00.000Z',  // 12:30 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D1_3: TripSlot = {
  slotId: '8dfd03bb-03aa-4833-9c05-ed91468017b5',
  tripId: TRIP_ID,
  dayIndex: 1,
  slotOrder: 8,
  version: 1,
  placeId: NUI_THAN_TAI.placeId,
  plannedStart: '2026-05-24T06:00:00.000Z',  // 13:00 VN
  plannedEnd:   '2026-05-24T08:00:00.000Z',  // 15:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D1_4: TripSlot = {
  slotId: 'fad50785-47f0-46a7-b3d0-c3d05eeda5ca',
  tripId: TRIP_ID,
  dayIndex: 1,
  slotOrder: 9,
  version: 1,
  placeId: NAM_SON_PAGODA.placeId,
  plannedStart: '2026-05-24T08:30:00.000Z',  // 15:30 VN
  plannedEnd:   '2026-05-24T10:30:00.000Z',  // 17:30 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const SLOT_D1_5: TripSlot = {
  slotId: 'b443145a-1d46-4362-9163-751d930ef1f2',
  tripId: TRIP_ID,
  dayIndex: 1,
  slotOrder: 10,
  version: 1,
  placeId: QUEEN_COBRA.placeId,
  plannedStart: '2026-05-24T11:00:00.000Z',  // 18:00 VN
  plannedEnd:   '2026-05-24T13:00:00.000Z',  // 20:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

// Ngày 2: 2026-05-25 — 1 slot
const SLOT_D2_1: TripSlot = {
  slotId: '24f66d54-c0bf-46b8-9b87-70804ad5bff2',
  tripId: TRIP_ID,
  dayIndex: 2,
  slotOrder: 11,
  version: 1,
  placeId: CAY_DA_DO_XU.placeId,
  plannedStart: '2026-05-25T01:00:00.000Z',  // 08:00 VN
  plannedEnd:   '2026-05-25T03:00:00.000Z',  // 10:00 VN
  actualStart: null, actualEnd: null,
  estimatedCost: 0,
  activityType: 'sightseeing',
  rationale: 'Điểm do người dùng chọn',
  status: 'planned',
};

const ALL_REAL_SLOTS: TripSlot[] = [
  SLOT_D0_1, SLOT_D0_2, SLOT_D0_3, SLOT_D0_4, SLOT_D0_5,
  SLOT_D1_1, SLOT_D1_2, SLOT_D1_3, SLOT_D1_4, SLOT_D1_5,
  SLOT_D2_1,
];

const DAY0_SLOTS: TripSlot[] = [SLOT_D0_1, SLOT_D0_2, SLOT_D0_3, SLOT_D0_4, SLOT_D0_5];

// ---------------------------------------------------------------------------
// Candidate pool — tất cả 11 địa điểm thật + REST_STOP để test lọc
// ---------------------------------------------------------------------------

const REAL_CANDIDATE_POOL: Place[] = [
  MY_AN_BEACH, THUY_SON, LANG_DA_MY_NGHE, LANG_BICH_HOA, BAI_BIEN_SON_TRA,
  BAI_DA, CUA_DAI_BEACH, NUI_THAN_TAI, NAM_SON_PAGODA, QUEEN_COBRA,
  CAY_DA_DO_XU,
  REST_STOP,
];

// ---------------------------------------------------------------------------
// User preference — neutral vector (no explicit preferences)
// ---------------------------------------------------------------------------

const NEUTRAL_USER: UserPreference = {
  preferenceVector: new Array(10).fill(0.1),
  pace: 0.5,
  mobilityRestrictions: [],
};

// User thích thiên nhiên/biển (tagId 1, 8)
const BEACH_LOVER_USER: UserPreference = {
  preferenceVector: [
    0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.0, 0.0,  // tagId 1=beach, 8=nature cao
  ],
  pace: 0.3,
  mobilityRestrictions: [],
};

// ---------------------------------------------------------------------------
// Initial state — tương đương buildDefaultState() cho trip này
// Không có snapshot → dayIndex=0, timeRemaining=720×3=2160 (3 ngày),
// budget=3_000_000, fatigue=0, moodProxy=0.8, tọa độ trung tâm Đà Nẵng
// ---------------------------------------------------------------------------

const INITIAL_STATE: TripState = {
  tripId: TRIP_ID,
  dayIndex: 0,
  slotOrder: 0,
  timeRemainingMin: 3 * 720,   // 3 ngày × 12h = 2160 phút
  budgetRemaining: BUDGET_TOTAL,
  fatigue: 0,
  currentLat: 16.0544,         // Đà Nẵng center
  currentLng: 108.2022,
  moodProxy: 0.8,
  capturedAt: '2026-05-23T08:28:23.000Z',   // ~= trip.created_at (VN 15:28)
  source: 'simulated',
};

// ---------------------------------------------------------------------------
// Objective weights — default từ PlanLoader.DEFAULT_WEIGHTS
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1,
  wPace: 1,
  wDistance: 1.5,
  wBudget: 1,
  wWeather: 1,
  wRisk: 1,
  wStability: 0.5,
  wPotentialBias: 1.0,
  wProximity: 0,
  wSynergy: 0.3,
};

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

function assertNoRestStop(plan: TripSlot[], label: string) {
  for (const slot of plan) {
    const place = REAL_CANDIDATE_POOL.find((p) => p.placeId === slot.placeId);
    if (!place) continue;
    const nameLower = place.name.toLowerCase();
    expect(
      nameLower.includes('dừng chân') || nameLower.includes('rest stop'),
      `${label}: slot placeId=${slot.placeId} name="${place.name}" là địa điểm dừng chân ngoại lai`,
    ).toBe(false);
  }
}

function assertNoDuplicatePlaceIds(plan: TripSlot[], label: string) {
  const seen = new Set<number>();
  for (const slot of plan) {
    expect(seen.has(slot.placeId), `${label}: placeId=${slot.placeId} bị trùng`).toBe(false);
    seen.add(slot.placeId);
  }
}

function assertValidSlotTimes(plan: TripSlot[], label: string) {
  for (const slot of plan) {
    const startMs = new Date(slot.plannedStart).getTime();
    const endMs = new Date(slot.plannedEnd).getTime();
    expect(isNaN(startMs), `${label} slot ${slot.slotOrder}: plannedStart không hợp lệ`).toBe(false);
    expect(isNaN(endMs), `${label} slot ${slot.slotOrder}: plannedEnd không hợp lệ`).toBe(false);
    expect(endMs > startMs, `${label} slot ${slot.slotOrder}: end <= start`).toBe(true);

    // Kiểm tra giờ VN hợp lệ (08:00–22:00)
    const startVnMs = startMs + VN_OFFSET_H * 3_600_000;
    const endVnMs = endMs + VN_OFFSET_H * 3_600_000;
    const startHour = new Date(startVnMs).getUTCHours() + new Date(startVnMs).getUTCMinutes() / 60;
    const endHour = new Date(endVnMs).getUTCHours() + new Date(endVnMs).getUTCMinutes() / 60;
    expect(startHour, `${label} slot ${slot.slotOrder}: bắt đầu ${startHour.toFixed(1)}h VN < 8:00`).toBeGreaterThanOrEqual(8);
    expect(endHour, `${label} slot ${slot.slotOrder}: kết thúc ${endHour.toFixed(1)}h VN > 22:00`).toBeLessThanOrEqual(22);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let evolver: StateEvolver;
let operators: MutationOperators;
let scorer: ObjectiveScorer;
let beamSearch: BeamSearch;

function buildCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  return {
    remainingSlots: ALL_REAL_SLOTS,
    initialState: INITIAL_STATE,
    candidatePool: REAL_CANDIDATE_POOL,
    user: NEUTRAL_USER,
    weights: DEFAULT_WEIGHTS,
    defaultWeather: { rainMmPerH: 0 },
    weatherForecast: [],
    ...overrides,
  };
}

beforeEach(() => {
  clearSetFeasibilityCache();
  evolver = new StateEvolver();
  operators = new MutationOperators(evolver);
  scorer = new ObjectiveScorer(evolver);
  beamSearch = new BeamSearch(evolver, operators, scorer, {
    beamWidth: 4,
    maxIterations: 10,
    improvementThreshold: 0.001,
    latencyBudgetMs: 5000,
  });
  // Cố định thời gian để latencyBudgetMs không ảnh hưởng kết quả
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-23T08:28:23.000Z').getTime());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Test suite
// ===========================================================================

describe('E2E Replan — Trip 6286745f (Đà Nẵng 3 ngày)', () => {

  // -------------------------------------------------------------------------
  // Group 1: Smoke tests — engine không crash
  // -------------------------------------------------------------------------

  describe('Smoke test', () => {
    it('TC1.1 — BeamSearch.search() hoàn thành không throw với 11 slots thật', () => {
      const ctx = buildCtx();
      let result: BeamNode;
      expect(() => {
        result = beamSearch.search(ctx);
      }).not.toThrow();
      expect(result!).toBeDefined();
      expect(Array.isArray(result!.plan)).toBe(true);
      expect(result!.plan.length).toBeGreaterThan(0);
    });

    it('TC1.2 — Plan kết quả chỉ chứa placeId thuộc candidatePool', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      const poolIds = new Set(REAL_CANDIDATE_POOL.map((p) => p.placeId));
      for (const slot of plan) {
        expect(poolIds.has(slot.placeId), `placeId=${slot.placeId} không tồn tại trong pool`).toBe(true);
      }
    });

    it('TC1.3 — Chỉ replanning ngày 0 (5 slots) cũng hoạt động', () => {
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      });
      const { plan } = beamSearch.search(ctx);
      expect(plan.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Group 2: Không có địa điểm ngoại lai (REST_STOP)
  // -------------------------------------------------------------------------

  describe('Lọc địa điểm ngoại lai', () => {
    it('TC2.1 — Không chèn REST_STOP vào plan với thời tiết bình thường', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      assertNoRestStop(plan, 'TC2.1 (no rain)');
    });

    it('TC2.2 — Không chèn REST_STOP khi mưa nặng (kịch bản cần INSERT_ALT)', () => {
      const ctx = buildCtx({
        weatherForecast: [
          { rainMmPerH: 30 },  // day 0: mưa xối xả
          { rainMmPerH: 20 },  // day 1: mưa vừa
          { rainMmPerH: 0 },   // day 2: tạnh
        ],
      });
      const { plan } = beamSearch.search(ctx);
      assertNoRestStop(plan, 'TC2.2 (heavy rain)');
    });

    it('TC2.3 — candidatePriority của REST_STOP < 2 (bị lọc ngay tại source)', () => {
      // candidatePriority = tagOverlap×10 + min(duration/10, 12)
      // REST_STOP: tags=[], duration=15 → 0 + min(1.5, 12) = 1.5 < 2
      const ctx = buildCtx();
      const ctxWithMap = { ...ctx, placeMap: new Map(ctx.candidatePool.map((p) => [p.placeId, p])) };
      const score = MutationOperators.candidatePriority(REST_STOP, undefined, ctxWithMap);
      expect(score, 'REST_STOP score phải < 2').toBeLessThan(2);
    });
  });

  // -------------------------------------------------------------------------
  // Group 3: Feasibility constraints
  // -------------------------------------------------------------------------

  describe('Ràng buộc feasibility', () => {
    it('TC3.1 — Trạng thái cuối không âm budget (budget=3tr, tất cả slot free)', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      const states = evolver.computeTrajectory(plan, INITIAL_STATE, ctx);
      const finalState = states[states.length - 1]!;
      expect(finalState.budgetRemaining, 'budgetRemaining không được âm').toBeGreaterThanOrEqual(0);
    });

    it('TC3.2 — Trạng thái cuối không âm timeRemainingMin với 2160 phút khởi đầu', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      const states = evolver.computeTrajectory(plan, INITIAL_STATE, ctx);
      const finalState = states[states.length - 1]!;
      expect(finalState.timeRemainingMin, 'timeRemainingMin không được âm').toBeGreaterThanOrEqual(0);
    });

    it('TC3.3 — Fatigue không vượt ngưỡng 0.95 trong plan ngày 0', () => {
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      });
      const { plan } = beamSearch.search(ctx);
      const states = evolver.computeTrajectory(plan, { ...INITIAL_STATE, timeRemainingMin: 720 }, ctx);
      for (let i = 1; i < states.length; i++) {
        expect(states[i]!.fatigue, `Fatigue tại slot ${i} vượt FATIGUE_CAP`).toBeLessThanOrEqual(0.95);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group 4: Tính đúng của slot times
  // -------------------------------------------------------------------------

  describe('Tính đúng timestamp slot', () => {
    it('TC4.1 — Tất cả plannedStart/plannedEnd là ISO-8601 hợp lệ (plan gốc)', () => {
      for (const slot of ALL_REAL_SLOTS) {
        const start = new Date(slot.plannedStart);
        const end = new Date(slot.plannedEnd);
        expect(isNaN(start.getTime()), `slot ${slot.slotOrder}: plannedStart="${slot.plannedStart}" không hợp lệ`).toBe(false);
        expect(isNaN(end.getTime()), `slot ${slot.slotOrder}: plannedEnd="${slot.plannedEnd}" không hợp lệ`).toBe(false);
      }
    });

    it('TC4.2 — Plan gốc: tất cả slots nằm trong 08:00–22:00 VN (sau khi sửa timestamp)', () => {
      assertValidSlotTimes(ALL_REAL_SLOTS, 'Plan gốc');
    });

    it('TC4.3 — Plan output sau replan: timestamps hợp lệ', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      // Chỉ kiểm tra ISO hợp lệ (không kiểm tra VN window vì repairSuffix
      // có thể tạo lại giờ khác nhau tuỳ vào mutation)
      for (const slot of plan) {
        const start = new Date(slot.plannedStart);
        const end = new Date(slot.plannedEnd);
        expect(isNaN(start.getTime()), `output slot ${slot.slotOrder}: plannedStart không hợp lệ`).toBe(false);
        expect(isNaN(end.getTime()), `output slot ${slot.slotOrder}: plannedEnd không hợp lệ`).toBe(false);
        expect(end.getTime(), `output slot ${slot.slotOrder}: end <= start`).toBeGreaterThan(start.getTime());
      }
    });

    it('TC4.4 — Ngày 0: planned dates phải trong ngày 2026-05-23 (VN)', () => {
      for (const slot of DAY0_SLOTS) {
        const startVn = new Date(new Date(slot.plannedStart).getTime() + VN_OFFSET_H * 3_600_000);
        // VN date string: YYYY-MM-DD
        const dateStr = startVn.toISOString().slice(0, 10);
        expect(dateStr, `slot ${slot.slotOrder}: ngày VN phải là 2026-05-23 nhưng là ${dateStr}`).toBe('2026-05-23');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group 5: Tính đúng sau sự kiện thời tiết (mưa)
  // -------------------------------------------------------------------------

  describe('Sự kiện thời tiết — mưa nặng ngày 0', () => {
    it('TC5.1 — Khi mưa nặng, plan vẫn trả về kết quả hợp lệ (không crash)', () => {
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        weatherForecast: [{ rainMmPerH: 25 }],  // mưa xối xả ngày 0
      });
      expect(() => beamSearch.search(ctx)).not.toThrow();
      const { plan } = beamSearch.search(ctx);
      expect(plan.length).toBeGreaterThan(0);
    });

    it('TC5.2 — Không chèn REST_STOP kể cả khi mưa buộc thay slot outdoor', () => {
      const ctx = buildCtx({
        weatherForecast: [{ rainMmPerH: 25 }, { rainMmPerH: 10 }, { rainMmPerH: 0 }],
      });
      const { plan } = beamSearch.search(ctx);
      assertNoRestStop(plan, 'TC5.2 rain replacement');
    });

    it('TC5.3 — Score khi mưa không cao hơn score không mưa cho plan có nhiều outdoor slot', () => {
      const ctxNoRain = buildCtx({ remainingSlots: DAY0_SLOTS, initialState: { ...INITIAL_STATE, timeRemainingMin: 720 } });
      const ctxRain = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        weatherForecast: [{ rainMmPerH: 25 }],
      });

      const nodeNoRain = beamSearch.search(ctxNoRain);
      const nodeRain = beamSearch.search(ctxRain);

      // Plan gốc có 2 outdoor slots (My An Beach, Bãi Biển Sơn Trà) → mưa làm điểm giảm
      // Score khi mưa phải ≤ score khi không mưa với cùng plan gốc
      const states = evolver.computeTrajectory(DAY0_SLOTS, { ...INITIAL_STATE, timeRemainingMin: 720 }, ctxNoRain);
      const scoreNoRain = scorer.score(DAY0_SLOTS, states, DEFAULT_WEIGHTS, ctxNoRain);
      const scoreRain = scorer.score(DAY0_SLOTS, states, DEFAULT_WEIGHTS, ctxRain);
      expect(scoreRain, 'Score khi mưa phải ≤ score không mưa với outdoor slots').toBeLessThanOrEqual(scoreNoRain);
    });
  });

  // -------------------------------------------------------------------------
  // Group 6: Tính đúng của plan structure
  // -------------------------------------------------------------------------

  describe('Cấu trúc plan output', () => {
    it('TC6.1 — Không có placeId trùng lặp trong plan output', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      assertNoDuplicatePlaceIds(plan, 'TC6.1');
    });

    it('TC6.2 — slotOrder tăng dần trong cùng một ngày', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      const byDay = new Map<number, number[]>();
      for (const slot of plan) {
        if (!byDay.has(slot.dayIndex)) byDay.set(slot.dayIndex, []);
        byDay.get(slot.dayIndex)!.push(slot.slotOrder);
      }
      for (const [day, orders] of byDay) {
        for (let i = 1; i < orders.length; i++) {
          expect(orders[i]!, `Ngày ${day}: slotOrder không tăng dần`).toBeGreaterThan(orders[i - 1]!);
        }
      }
    });

    it('TC6.3 — dayIndex của các slot tương ứng với 0/1/2 (3 ngày)', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      for (const slot of plan) {
        expect(slot.dayIndex, `dayIndex=${slot.dayIndex} nằm ngoài [0,2]`).toBeGreaterThanOrEqual(0);
        expect(slot.dayIndex, `dayIndex=${slot.dayIndex} nằm ngoài [0,2]`).toBeLessThanOrEqual(2);
      }
    });

    it('TC6.4 — Tất cả slots trong plan output có status = planned', () => {
      const ctx = buildCtx();
      const { plan } = beamSearch.search(ctx);
      for (const slot of plan) {
        expect(slot.status, `slot ${slot.slotOrder}: status phải là 'planned'`).toBe('planned');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group 7: User preference phù hợp
  // -------------------------------------------------------------------------

  describe('User preference — BEACH_LOVER', () => {
    it('TC7.1 — BeamSearch vẫn hoàn thành với user thích biển', () => {
      const ctx = buildCtx({ user: BEACH_LOVER_USER });
      expect(() => beamSearch.search(ctx)).not.toThrow();
      const { plan } = beamSearch.search(ctx);
      expect(plan.length).toBeGreaterThan(0);
    });

    it('TC7.2 — Score với BEACH_LOVER cao hơn neutral khi plan có beach slots', () => {
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      });
      const states = evolver.computeTrajectory(DAY0_SLOTS, { ...INITIAL_STATE, timeRemainingMin: 720 }, ctx);
      const scoreNeutral = scorer.score(DAY0_SLOTS, states, DEFAULT_WEIGHTS, ctx);
      const scoreBeachLover = scorer.score(DAY0_SLOTS, states, DEFAULT_WEIGHTS, {
        ...ctx,
        user: BEACH_LOVER_USER,
      });
      // Day 0 có 2 beach slots → BEACH_LOVER nên score cao hơn
      expect(scoreBeachLover, 'BEACH_LOVER score phải ≥ neutral với beach plan').toBeGreaterThanOrEqual(scoreNeutral);
    });
  });

  // -------------------------------------------------------------------------
  // Group 8: MutationOperators với dữ liệu thật
  // -------------------------------------------------------------------------

  describe('MutationOperators với data thật', () => {
    it('TC8.1 — generateAll() sinh ít nhất 1 mutation hợp lệ từ plan ngày 0', () => {
      const ctx: BeamSearchContext = {
        ...buildCtx({
          remainingSlots: DAY0_SLOTS,
          initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        }),
        placeMap: new Map(REAL_CANDIDATE_POOL.map((p) => [p.placeId, p])),
      };
      const results = operators.generateAll(DAY0_SLOTS, ctx);
      expect(results.length, 'Phải có ít nhất 1 mutation khả thi').toBeGreaterThanOrEqual(1);
    });

    it('TC8.2 — Mọi mutation result đều có newPlan hợp lệ (không rỗng)', () => {
      const ctx: BeamSearchContext = {
        ...buildCtx({
          remainingSlots: DAY0_SLOTS,
          initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        }),
        placeMap: new Map(REAL_CANDIDATE_POOL.map((p) => [p.placeId, p])),
      };
      const results = operators.generateAll(DAY0_SLOTS, ctx);
      for (const result of results) {
        expect(result.newPlan, 'newPlan phải là array').toBeDefined();
        expect(Array.isArray(result.newPlan)).toBe(true);
        expect(result.newPlan.length, 'newPlan không được rỗng').toBeGreaterThan(0);
      }
    });

    it('TC8.3 — Không có mutation nào chèn REST_STOP', () => {
      const ctx: BeamSearchContext = {
        ...buildCtx({
          remainingSlots: DAY0_SLOTS,
          initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        }),
        placeMap: new Map(REAL_CANDIDATE_POOL.map((p) => [p.placeId, p])),
      };
      const results = operators.generateAll(DAY0_SLOTS, ctx);
      for (const result of results) {
        assertNoRestStop(result.newPlan, `mutation ${result.operator}`);
      }
    });

    it('TC8.4 — DROP_SLOT giảm số slot, INSERT_ALT giữ nguyên hoặc tăng số slot', () => {
      const ctx: BeamSearchContext = {
        ...buildCtx({
          remainingSlots: DAY0_SLOTS,
          initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
        }),
        placeMap: new Map(REAL_CANDIDATE_POOL.map((p) => [p.placeId, p])),
      };
      const results = operators.generateAll(DAY0_SLOTS, ctx);
      const drops = results.filter((r) => r.operator === 'DROP_SLOT');
      const inserts = results.filter((r) => r.operator === 'INSERT_ALT');

      for (const drop of drops) {
        expect(drop.newPlan.length, 'DROP_SLOT phải giảm số slot').toBeLessThan(DAY0_SLOTS.length);
      }
      for (const insert of inserts) {
        expect(insert.newPlan.length, 'INSERT_ALT phải giữ nguyên hoặc tăng số slot').toBeGreaterThanOrEqual(DAY0_SLOTS.length);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Group 9: StateEvolver.computeTrajectory với data thật
  // -------------------------------------------------------------------------

  describe('StateEvolver.computeTrajectory với data thật', () => {
    it('TC9.1 — computeTrajectory trả về states.length = slots.length + 1', () => {
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: { ...INITIAL_STATE, timeRemainingMin: 720 },
      });
      const states = evolver.computeTrajectory(DAY0_SLOTS, { ...INITIAL_STATE, timeRemainingMin: 720 }, ctx);
      expect(states.length).toBe(DAY0_SLOTS.length + 1);
    });

    it('TC9.2 — State đầu tiên = initialState, budget và time giảm dần', () => {
      const initState = { ...INITIAL_STATE, timeRemainingMin: 720 };
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: initState,
      });
      const states = evolver.computeTrajectory(DAY0_SLOTS, initState, ctx);

      expect(states[0]).toEqual(initState);
      // Budget giảm dần (tất cả slots free = 0 VND)
      for (let i = 1; i < states.length; i++) {
        expect(states[i]!.budgetRemaining, `budgetRemaining[${i}] tăng bất thường`).toBeLessThanOrEqual(
          states[i - 1]!.budgetRemaining,
        );
      }
      // TimeRemainingMin giảm dần
      for (let i = 1; i < states.length; i++) {
        expect(states[i]!.timeRemainingMin, `timeRemaining[${i}] tăng bất thường`).toBeLessThanOrEqual(
          states[i - 1]!.timeRemainingMin,
        );
      }
    });

    it('TC9.3 — Fatigue tăng dần (visit nhiều outdoor slot)', () => {
      const initState = { ...INITIAL_STATE, timeRemainingMin: 720 };
      const ctx = buildCtx({
        remainingSlots: DAY0_SLOTS,
        initialState: initState,
        weatherForecast: [],
      });
      const states = evolver.computeTrajectory(DAY0_SLOTS, initState, ctx);
      // Fatigue chỉ có thể bằng hoặc tăng (không có meal/rest slot trong plan)
      for (let i = 2; i < states.length; i++) {
        expect(states[i]!.fatigue, `fatigue[${i}] giảm bất thường`).toBeGreaterThanOrEqual(
          states[i - 1]!.fatigue,
        );
      }
    });
  });
});
