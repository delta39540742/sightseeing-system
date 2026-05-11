/**
 * algorithm.behavior.test.ts
 *
 * Kiểm tra hành vi thuật toán với dữ liệu đầu vào hợp lệ cho các hàm
 * chưa được test trực tiếp:
 *   - StateEvolver.computeTrajectory  (không có test)
 *   - StateEvolver.isFeasible         (không có test trực tiếp)
 *   - StateEvolver.estimateTravelTime (chỉ bị mock, chưa test formula)
 *   - StateEvolver.isPlanFeasible     (không có test)
 *   - MutationOperators.prepareContext (không có test)
 *   - BeamSearch với multi-slot plan   (tất cả test cũ chỉ dùng 1 slot)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import StateEvolver from '../src/replanner/StateEvolver';
import type { ReplanContext } from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import BeamSearch, {
  ObjectiveScorer,
  type BeamSearchConfig,
  type BeamSearchContext,
} from '../src/replanner/BeamSearch';
import type {
  TripSlot,
  TripState,
  Place,
  UserPreference,
  ObjectiveWeights,
  PlaceTag,
} from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeTag(tagId: number): PlaceTag {
  return { tagId, name: `tag${tagId}`, displayName: `Tag ${tagId}` };
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    minPrice: 10_000,
    maxPrice: null,
    priceType: 'paid',
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
    plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
    plannedEnd:   '2026-04-21T03:00:00.000Z', // 10:00 VN
    actualStart: null,
    actualEnd: null,
    estimatedCost: 50_000,
    activityType: 'sightseeing',
    rationale: null,
    status: 'planned',
    ...overrides,
  };
}

function makeState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 600,
    budgetRemaining: 500_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T01:00:00.000Z', // 08:00 VN
    source: 'simulated',
    ...overrides,
  };
}

function makeUser(preferenceVector: number[] = new Array(10).fill(0)): UserPreference {
  return {
    userId: 'user-001',
    primaryPurpose: 'van_hoa',
    preferredTagIds: [],
    pace: 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: [],
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 3_000_000,
    groupType: 'solo',
    mobilityRestrictions: [],
    preferenceVector,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeReplanCtx(pool: Place[], overrides: Partial<ReplanContext> = {}): ReplanContext {
  return {
    candidatePool: pool,
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    ...overrides,
  };
}

function makeBeamCtx(
  pool: Place[],
  slots: TripSlot[],
  overrides: Partial<BeamSearchContext> = {},
): BeamSearchContext {
  return {
    candidatePool: pool,
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    remainingSlots: slots,
    weights: {
      wInterest: 1, wPace: 0, wDistance: 0, wBudget: 0,
      wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0, wProximity: 0,
    },
    ...overrides,
  };
}

const FAST_CONFIG: BeamSearchConfig = {
  beamWidth: 3,
  maxIterations: 10,
  improvementThreshold: 0.01,
  latencyBudgetMs: 4500,
};

// ===========================================================================
// 1. StateEvolver.computeTrajectory
// ===========================================================================

describe('StateEvolver.computeTrajectory', () => {
  let evolver: StateEvolver;
  const PLACE = makePlace({ placeId: 1, avgVisitDurationMin: 60, minPrice: 50_000 });
  const CTX = makeReplanCtx([PLACE]);

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  // Mong đợi: plan rỗng → trả về mảng 1 phần tử = [initialState],
  // vì không có slot nào để evolve.
  // Kết quả thực tế: states.length === 1 và states[0] === initialState → PASS
  it('empty plan returns [initialState] — length 1', () => {
    const initial = makeState();
    const states = evolver.computeTrajectory([], initial, CTX);
    expect(states).toHaveLength(1);
    expect(states[0]).toBe(initial);
  });

  // Mong đợi: plan có N slot → trajectory dài N+1 (index 0 = trước khi thăm bất kỳ slot nào,
  // index k = sau khi thăm slot k-1). Đây là bất biến cốt lõi của trajectory.
  // Kết quả thực tế: states.length === plan.length + 1 → PASS
  it('trajectory length equals plan.length + 1 for any non-empty plan', () => {
    const slot1 = makeSlot({ slotId: 's1', placeId: 1, slotOrder: 0 });
    const slot2 = makeSlot({ slotId: 's2', placeId: 1, slotOrder: 1,
      plannedStart: '2026-04-21T03:00:00.000Z',
      plannedEnd:   '2026-04-21T04:00:00.000Z' });
    const slot3 = makeSlot({ slotId: 's3', placeId: 1, slotOrder: 2,
      plannedStart: '2026-04-21T04:00:00.000Z',
      plannedEnd:   '2026-04-21T05:00:00.000Z' });

    expect(evolver.computeTrajectory([slot1], makeState(), CTX)).toHaveLength(2);
    expect(evolver.computeTrajectory([slot1, slot2], makeState(), CTX)).toHaveLength(3);
    expect(evolver.computeTrajectory([slot1, slot2, slot3], makeState(), CTX)).toHaveLength(4);
  });

  // Mong đợi: states[0] phải là chính xác initialState (cùng object reference),
  // không phải bản copy — đây là tính chất "starts from initial".
  // Kết quả thực tế: states[0] === initial (reference equality) → PASS
  it('states[0] is the exact initialState reference, not a copy', () => {
    const initial = makeState({ budgetRemaining: 999_999 });
    const slot = makeSlot({ placeId: 1 });
    const states = evolver.computeTrajectory([slot], initial, CTX);
    expect(states[0]).toBe(initial);
  });

  // Mong đợi: capturedAt của states[i+1] phải bằng slot[i].plannedStart —
  // đây là cách trajectory ghi nhận "mốc thời gian thực tế" của từng bước thăm.
  // Kết quả thực tế: states[1].capturedAt === slot.plannedStart → PASS
  it('states[i+1].capturedAt equals slot[i].plannedStart (time is pinned to planned start)', () => {
    const plannedStart = '2026-04-21T04:30:00.000Z';
    const slot = makeSlot({ placeId: 1, plannedStart });
    const states = evolver.computeTrajectory([slot], makeState(), CTX);
    expect(states[1]!.capturedAt).toBe(plannedStart);
  });

  // Mong đợi: ngân sách giảm đơn điệu qua từng bước (mỗi slot tốn tiền) —
  // states[i+1].budgetRemaining < states[i].budgetRemaining khi estimatedCost > 0.
  // Kết quả thực tế: budget giảm đều ở mỗi bước → PASS
  it('budgetRemaining decreases monotonically across trajectory when slots have cost', () => {
    const slot1 = makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 50_000, slotOrder: 0 });
    const slot2 = makeSlot({ slotId: 's2', placeId: 1, estimatedCost: 30_000, slotOrder: 1,
      plannedStart: '2026-04-21T03:00:00.000Z',
      plannedEnd:   '2026-04-21T04:00:00.000Z' });

    const initial = makeState({ budgetRemaining: 500_000 });
    const states = evolver.computeTrajectory([slot1, slot2], initial, CTX);

    expect(states[1]!.budgetRemaining).toBe(450_000); // 500k - 50k
    expect(states[2]!.budgetRemaining).toBe(420_000); // 450k - 30k
  });

  // Mong đợi: slotOrder trong trajectory tăng lên 1 sau mỗi bước —
  // đây là cách hệ thống theo dõi "đang ở slot thứ mấy trong ngày".
  // Kết quả thực tế: states[k].slotOrder = initialState.slotOrder + k → PASS
  it('slotOrder increments by 1 after each slot visit', () => {
    const slot1 = makeSlot({ slotId: 's1', placeId: 1, slotOrder: 0 });
    const slot2 = makeSlot({ slotId: 's2', placeId: 1, slotOrder: 1,
      plannedStart: '2026-04-21T03:00:00.000Z',
      plannedEnd:   '2026-04-21T04:00:00.000Z' });

    const initial = makeState({ slotOrder: 0 });
    const states = evolver.computeTrajectory([slot1, slot2], initial, CTX);

    expect(states[0]!.slotOrder).toBe(0);
    expect(states[1]!.slotOrder).toBe(1);
    expect(states[2]!.slotOrder).toBe(2);
  });

  // Mong đợi: currentLat/Lng của states[i+1] phải bằng tọa độ của place[i] —
  // sau khi thăm một nơi, vị trí "hiện tại" phải cập nhật sang nơi đó.
  // Kết quả thực tế: states[1].currentLat === PLACE.lat và .currentLng === PLACE.lng → PASS
  it('currentLat/Lng updates to the visited place coordinates after each slot', () => {
    const farPlace = makePlace({ placeId: 2, lat: 10.5, lng: 106.7 });
    const ctx = makeReplanCtx([farPlace]);
    const slot = makeSlot({ placeId: 2 });
    const initial = makeState({ currentLat: 16.0, currentLng: 108.0 });
    const states = evolver.computeTrajectory([slot], initial, ctx);

    expect(states[1]!.currentLat).toBe(10.5);
    expect(states[1]!.currentLng).toBe(106.7);
  });

  // Mong đợi: computeTrajectory không có skip-logic cho completed/skipped slots
  // (khác với isPlanFeasible). Slot 'completed' vẫn được evolve và trừ tiền bình thường.
  // Kết quả thực tế: states[1].budgetRemaining = initial - cost (không bỏ qua slot) → PASS
  it('does NOT skip completed slots — evolves them like any other slot (unlike isPlanFeasible)', () => {
    const slot = makeSlot({ placeId: 1, estimatedCost: 100_000, status: 'completed' });
    const initial = makeState({ budgetRemaining: 500_000 });
    const states = evolver.computeTrajectory([slot], initial, CTX);

    // Budget was deducted for the completed slot
    expect(states[1]!.budgetRemaining).toBe(400_000);
  });

  // Mong đợi: khi placeId của slot không có trong candidatePool, hàm ném Error
  // chứa placeId trong message — lỗi này giúp debug nhanh hơn khi pool bị thiếu.
  // Kết quả thực tế: throw Error với /9999/ trong message → PASS
  it('throws an Error containing the missing placeId when slot placeId is not in candidatePool', () => {
    const slot = makeSlot({ placeId: 9999 });
    expect(() => evolver.computeTrajectory([slot], makeState(), CTX)).toThrow(/9999/);
  });
});

// ===========================================================================
// 2. StateEvolver.isFeasible
// ===========================================================================

describe('StateEvolver.isFeasible', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  // Mong đợi: state hoàn toàn hợp lệ (time≥0, budget≥0, fatigue≤0.95) → true.
  // Kết quả thực tế: true → PASS
  it('returns true when all constraints are satisfied', () => {
    expect(evolver.isFeasible(makeState({
      timeRemainingMin: 100,
      budgetRemaining: 100_000,
      fatigue: 0.5,
    }))).toBe(true);
  });

  // Mong đợi: timeRemainingMin = 0 là biên dưới hợp lệ (≥ 0 trong code) → true.
  // Kết quả thực tế: true → PASS
  it('returns true at timeRemainingMin boundary of 0 (inclusive)', () => {
    expect(evolver.isFeasible(makeState({ timeRemainingMin: 0 }))).toBe(true);
  });

  // Mong đợi: timeRemainingMin = -1 vi phạm ràng buộc → false.
  // Kết quả thực tế: false → PASS
  it('returns false when timeRemainingMin is negative (< 0)', () => {
    expect(evolver.isFeasible(makeState({ timeRemainingMin: -1 }))).toBe(false);
  });

  // Mong đợi: budgetRemaining = 0 là biên dưới hợp lệ (≥ 0 trong code) → true.
  // Kết quả thực tế: true → PASS
  it('returns true at budgetRemaining boundary of 0 (inclusive)', () => {
    expect(evolver.isFeasible(makeState({ budgetRemaining: 0 }))).toBe(true);
  });

  // Mong đợi: budgetRemaining âm vi phạm ràng buộc ngân sách → false.
  // Kết quả thực tế: false → PASS
  it('returns false when budgetRemaining is negative', () => {
    expect(evolver.isFeasible(makeState({ budgetRemaining: -0.01 }))).toBe(false);
  });

  // Mong đợi: fatigue = 0.95 = FATIGUE_CAP là biên trên hợp lệ (≤ 0.95 trong code) → true.
  // Kết quả thực tế: true → PASS
  it('returns true at fatigue = 0.95 (FATIGUE_CAP boundary — inclusive)', () => {
    expect(evolver.isFeasible(makeState({ fatigue: 0.95 }))).toBe(true);
  });

  // Mong đợi: fatigue = 0.951 vượt FATIGUE_CAP → false.
  // Kết quả thực tế: false → PASS
  it('returns false when fatigue exceeds 0.95 (FATIGUE_CAP)', () => {
    expect(evolver.isFeasible(makeState({ fatigue: 0.951 }))).toBe(false);
  });

  // Mong đợi: khi nhiều vi phạm xảy ra đồng thời (time âm VÀ budget âm),
  // hàm vẫn trả về false ngay lập tức — không cần check hết các điều kiện.
  // Kết quả thực tế: false → PASS
  it('returns false when multiple constraints are violated simultaneously', () => {
    expect(evolver.isFeasible(makeState({
      timeRemainingMin: -10,
      budgetRemaining: -1,
      fatigue: 0.99,
    }))).toBe(false);
  });
});

// ===========================================================================
// 3. StateEvolver.estimateTravelTime
// ===========================================================================

describe('StateEvolver.estimateTravelTime', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  // Mong đợi: cùng tọa độ → 0 phút (code có early-return khi lat1===lat2 && lng1===lng2).
  // Kết quả thực tế: 0 → PASS
  it('returns 0 when origin and destination are the same coordinates', () => {
    expect(evolver.estimateTravelTime(16.0614, 108.2273, 16.0614, 108.2273)).toBe(0);
  });

  // Mong đợi: A→B và B→A phải cho cùng thời gian (Haversine là đối xứng).
  // Nếu không đối xứng, hành trình "đi về" sẽ tính thời gian khác nhau — sai.
  // Kết quả thực tế: time(A→B) === time(B→A) → PASS
  it('is symmetric — travel time A→B equals B→A', () => {
    const timeAB = evolver.estimateTravelTime(16.0614, 108.2273, 15.8794, 108.3378);
    const timeBA = evolver.estimateTravelTime(15.8794, 108.3378, 16.0614, 108.2273);
    expect(timeAB).toBeCloseTo(timeBA, 10);
  });

  // Mong đợi: địa điểm xa hơn cho thời gian lớn hơn — monotone với khoảng cách.
  // Kết quả thực tế: timeNear < timeFar → PASS
  it('returns more travel time for farther destinations (monotone with distance)', () => {
    const base = { lat: 0, lng: 0 };
    const near = { lat: 0.5, lng: 0 };
    const far  = { lat: 2.0, lng: 0 };

    const timeNear = evolver.estimateTravelTime(base.lat, base.lng, near.lat, near.lng);
    const timeFar  = evolver.estimateTravelTime(base.lat, base.lng, far.lat,  far.lng);

    expect(timeNear).toBeGreaterThan(0);
    expect(timeFar).toBeGreaterThan(timeNear);
  });

  // Mong đợi: (0,0) → (1°lat, 0°lng) ≈ 111.2 km thẳng.
  // Với road_factor=1.4, speed=25 km/h:
  //   time = 111.2 × 1.4 / 25 × 60 ≈ 373–374 phút.
  // Kết quả thực tế: time ≈ 373.6 phút (trong khoảng [373, 374]) → PASS
  it('computes correct Haversine travel time for a 1-degree lat shift (~111 km)', () => {
    const time = evolver.estimateTravelTime(0, 0, 1, 0);
    // 111.2 km × 1.4 road-factor / 25 km/h × 60 min ≈ 373.6 min
    expect(time).toBeGreaterThan(373);
    expect(time).toBeLessThan(374);
  });

  // Mong đợi: kết quả luôn ≥ 0 ngay cả khi tọa độ phủ định (bán cầu Nam/Tây).
  // Kết quả thực tế: time > 0 → PASS
  it('returns non-negative time for negative coordinates (southern/western hemisphere)', () => {
    const time = evolver.estimateTravelTime(-33.9, 18.4, -23.5, -46.6); // Cape Town → São Paulo
    expect(time).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. StateEvolver.isPlanFeasible
// ===========================================================================

describe('StateEvolver.isPlanFeasible', () => {
  let evolver: StateEvolver;
  const PLACE = makePlace({ placeId: 1, avgVisitDurationMin: 60 });
  const CTX = makeReplanCtx([PLACE]);

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  // Mong đợi: plan rỗng không có gì để vi phạm → true (trừ khi initialState tự nó infeasible).
  // Kết quả thực tế: true → PASS
  it('returns true for an empty plan with a feasible initial state', () => {
    expect(evolver.isPlanFeasible([], makeState(), CTX)).toBe(true);
  });

  // Mong đợi: nếu initialState không hợp lệ (fatigue > 0.95), hàm trả về false ngay
  // mà không cần evolve bất kỳ slot nào (short-circuit).
  // Kết quả thực tế: false → PASS
  it('returns false immediately when initialState itself violates hard constraints', () => {
    const badInit = makeState({ fatigue: 0.99 }); // > FATIGUE_CAP
    expect(evolver.isPlanFeasible([makeSlot({ placeId: 1 })], badInit, CTX)).toBe(false);
  });

  // Mong đợi: slot có estimatedCost > budgetRemaining → sau khi evolve, budget âm → false.
  // Kết quả thực tế: false → PASS
  it('returns false when a slot drives budgetRemaining below 0', () => {
    const slot = makeSlot({ placeId: 1, estimatedCost: 100_000 });
    const init = makeState({ budgetRemaining: 50_000 });
    expect(evolver.isPlanFeasible([slot], init, CTX)).toBe(false);
  });

  // Mong đợi: slot có tổng thời gian (travel + visit) > timeRemainingMin → false.
  // Kết quả thực tế: false → PASS
  it('returns false when a slot drives timeRemainingMin below 0', () => {
    const slot = makeSlot({ placeId: 1 }); // avgVisitDurationMin = 60
    // estimateTravelTime to same location = 0; duration = 60 min
    const init = makeState({ timeRemainingMin: 30 }); // only 30 min left
    expect(evolver.isPlanFeasible([slot], init, CTX)).toBe(false);
  });

  // Mong đợi: slot với status='completed' bị bỏ qua trong isPlanFeasible —
  // nó không tiêu tiền/thời gian trong mô phỏng. Ngược với computeTrajectory.
  // Kết quả thực tế: isPlanFeasible trả về true (completed slot không làm âm budget) → PASS
  it('bypasses completed slots — they do not consume budget or time in simulation', () => {
    // Slot would bankrupt the plan if evolved, but status=completed → skipped
    const bankruptingSlot = makeSlot({ placeId: 1, estimatedCost: 200_000, status: 'completed' });
    const init = makeState({ budgetRemaining: 50_000 });
    expect(evolver.isPlanFeasible([bankruptingSlot], init, CTX)).toBe(true);
  });

  // Mong đợi: slot với status='skipped' bị bỏ qua tương tự như 'completed' —
  // slot bị bỏ lỡ trong hành trình thực tế không được tính vào mô phỏng tương lai.
  // Kết quả thực tế: isPlanFeasible trả về true (skipped slot không làm âm budget) → PASS
  it('bypasses skipped slots — they do not consume budget or time in simulation', () => {
    const bankruptingSlot = makeSlot({ placeId: 1, estimatedCost: 200_000, status: 'skipped' });
    const init = makeState({ budgetRemaining: 50_000 });
    expect(evolver.isPlanFeasible([bankruptingSlot], init, CTX)).toBe(true);
  });

  // Mong đợi: slot với placeId không có trong pool và status='planned' → ném Error —
  // hàm không thể evolve nếu không có thông tin về địa điểm.
  // Kết quả thực tế: throws Error → PASS
  it('throws when a planned slot has a placeId not in candidatePool', () => {
    const missingSlot = makeSlot({ placeId: 9999, status: 'planned' });
    expect(() => evolver.isPlanFeasible([missingSlot], makeState(), CTX)).toThrow();
  });

  // Mong đợi: plan nhiều slot hợp lệ (ngân sách đủ, thời gian đủ) → true.
  // Kết quả thực tế: true → PASS
  it('returns true for a multi-slot plan that satisfies all constraints throughout', () => {
    const slot1 = makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 30_000, slotOrder: 0 });
    const slot2 = makeSlot({ slotId: 's2', placeId: 1, estimatedCost: 20_000, slotOrder: 1,
      plannedStart: '2026-04-21T03:00:00.000Z',
      plannedEnd:   '2026-04-21T04:00:00.000Z' });
    const init = makeState({ budgetRemaining: 500_000, timeRemainingMin: 600 });
    expect(evolver.isPlanFeasible([slot1, slot2], init, CTX)).toBe(true);
  });
});

// ===========================================================================
// 5. MutationOperators.prepareContext
// ===========================================================================

describe('MutationOperators.prepareContext', () => {
  let ops: MutationOperators;

  // PLACE_HIGH: avgVisitDurationMin=120 → candidatePriority = 12 (duration score capped at 12)
  // PLACE_LOW:  avgVisitDurationMin=0   → candidatePriority = 0
  // Slot on day 0: SLOT_HIGH 09:00-11:00 VN (02:00-04:00 UTC), SLOT_LOW 21:00-23:00 VN (14:00-16:00 UTC)
  // endHour of SLOT_LOW = 23:00 > DAY_END_HOUR(22) + maxOverflow(30min)/60 = 22.5
  // → Day 0 is overloaded; SLOT_LOW (priority=0) is removed.
  const PLACE_HIGH = makePlace({ placeId: 1, avgVisitDurationMin: 120, name: 'High Priority' });
  const PLACE_LOW  = makePlace({ placeId: 2, avgVisitDurationMin: 0,   name: 'Low Priority' });
  const ALL_PLACES = [PLACE_HIGH, PLACE_LOW];

  const SLOT_HIGH = makeSlot({
    slotId: 'sh', placeId: 1, slotOrder: 0,
    plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
    plannedEnd:   '2026-04-21T04:00:00.000Z', // 11:00 VN
  });
  const SLOT_LOW = makeSlot({
    slotId: 'sl', placeId: 2, slotOrder: 1,
    plannedStart: '2026-04-21T14:00:00.000Z', // 21:00 VN
    plannedEnd:   '2026-04-21T16:00:00.000Z', // 23:00 VN — overflows 22:30
  });

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  // Mong đợi: khi không có ngày nào bị quá tải, context được trả về nguyên vẹn
  // (không tốn thêm chi phí tính toán khi không cần thiết).
  // Kết quả thực tế: context trả về có overflowedPlaceIds.length = 0 → trả về cùng ctx → PASS
  it('returns the same ctx object when no day is overloaded', () => {
    const fitSlot = makeSlot({
      slotId: 'fit', placeId: 1, slotOrder: 0,
      plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
      plannedEnd:   '2026-04-21T04:00:00.000Z', // 11:00 VN — no overflow
    });
    const ctx = makeBeamCtx([PLACE_HIGH], [fitSlot], { maxOverflowMinutes: 30 });
    const result = ops.prepareContext(ctx);
    expect(result).toBe(ctx); // same reference — no copy needed
  });

  // Mong đợi: khi ngày bị quá tải, slot có priority thấp nhất bị xóa khỏi remainingSlots —
  // SLOT_LOW (priority=0) phải bị loại, SLOT_HIGH (priority=12) phải giữ lại.
  // Kết quả thực tế: result.remainingSlots không chứa slotId='sl' → PASS
  it('removes the lowest-priority slot from an overloaded day', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_HIGH, SLOT_LOW], { maxOverflowMinutes: 30 });
    const result = ops.prepareContext(ctx);

    const slotIds = result.remainingSlots.map((s) => s.slotId);
    expect(slotIds).not.toContain(SLOT_LOW.slotId);
  });

  // Mong đợi: placeId của slot bị xóa phải được thêm vào potentialPlaceIds —
  // để BeamSearch có thể cân nhắc thêm lại địa điểm này sau.
  // Kết quả thực tế: result.potentialPlaceIds chứa PLACE_LOW.placeId (2) → PASS
  it('adds the removed slot placeId to potentialPlaceIds for consideration by BeamSearch', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_HIGH, SLOT_LOW], { maxOverflowMinutes: 30 });
    const result = ops.prepareContext(ctx);

    expect(result.potentialPlaceIds).toContain(PLACE_LOW.placeId);
  });

  // Mong đợi: potentialPlaceIds không chứa placeId trùng lặp —
  // nếu ctx đã có potentialPlaceIds bao gồm placeId bị xóa, không được duplicate.
  // Kết quả thực tế: potentialPlaceIds.filter(p => p === 2).length === 1 → PASS
  it('deduplicates potentialPlaceIds — removed placeId appears at most once', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_HIGH, SLOT_LOW], {
      maxOverflowMinutes: 30,
      potentialPlaceIds: [PLACE_LOW.placeId], // already there
    });
    const result = ops.prepareContext(ctx);

    const count = (result.potentialPlaceIds ?? []).filter((id) => id === PLACE_LOW.placeId).length;
    expect(count).toBe(1);
  });
});

// ===========================================================================
// 6. BeamSearch với multi-slot plan
// ===========================================================================

describe('BeamSearch.search — multi-slot plan behavior', () => {
  let evolver: StateEvolver;
  let ops: MutationOperators;
  let scorer: ObjectiveScorer;

  // Shared fixtures: 3 places, prefVec matches tagIds 1 and 5
  //   PLACE_A: tags=[5]    → interest = 1
  //   PLACE_B: tags=[1,5]  → interest = 2
  //   PLACE_C: tags=[1,2,5]→ interest = 3 (best)
  const PREF_VEC = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // tagId 1 at idx 0, tagId 5 at idx 4

  const PLACE_A = makePlace({ placeId: 10, lat: 16.060, lng: 108.220, tags: [makeTag(5)] });
  const PLACE_B = makePlace({ placeId: 20, lat: 16.062, lng: 108.223, tags: [makeTag(1), makeTag(5)] });
  const PLACE_C = makePlace({ placeId: 30, lat: 16.064, lng: 108.225, tags: [makeTag(1), makeTag(2), makeTag(5)] });
  const ALL_PLACES = [PLACE_A, PLACE_B, PLACE_C];

  // 2-slot plan: both visit PLACE_A (interest=1 each) → rootScore=2
  const SLOT_1 = makeSlot({ slotId: 's1', placeId: PLACE_A.placeId, slotOrder: 0 });
  const SLOT_2 = makeSlot({
    slotId: 's2', placeId: PLACE_A.placeId, slotOrder: 1,
    plannedStart: '2026-04-21T03:00:00.000Z',
    plannedEnd:   '2026-04-21T04:00:00.000Z',
  });

  const INTEREST_WEIGHTS: ObjectiveWeights = {
    wInterest: 1, wPace: 0, wDistance: 0, wBudget: 0,
    wWeather: 0, wRisk: 0, wStability: 0, wPotentialBias: 0, wProximity: 0,
  };

  beforeEach(() => {
    evolver = new StateEvolver();
    ops = new MutationOperators(evolver);
    scorer = new ObjectiveScorer(evolver);
  });

  // Mong đợi: BeamSearch với 2-slot plan tìm ra plan tốt hơn bằng cách thay thế
  // ít nhất 1 PLACE_A bằng PLACE_B/C (interest cao hơn) — score kết quả > rootScore.
  // rootScore = 2 × interest(A)=1 = 2.
  // bestScore ≥ 1 + 2 = 3 (thay 1 slot A bằng B).
  // Kết quả thực tế: result.score > rootScore → PASS
  it('finds a strictly better plan for a 2-slot input with suboptimal places', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });

    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);
    const result = beam.search(ctx);

    const rootStates = evolver.computeTrajectory([SLOT_1, SLOT_2], ctx.initialState, ctx);
    const rootScore = scorer.score([SLOT_1, SLOT_2], rootStates, INTEREST_WEIGHTS, ctx);

    expect(result.score).toBeGreaterThan(rootScore);
  });

  // Mong đợi: result.plan phải chứa ít nhất 1 slot tới PLACE_B hoặc PLACE_C —
  // đây là bằng chứng trực tiếp rằng thuật toán đã thực hiện REPLACE_PLACE.
  // Kết quả thực tế: result.plan.some(s => s.placeId === B hoặc C) → PASS
  it('result plan contains at least one slot to a higher-interest place (B or C)', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });
    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);
    const result = beam.search(ctx);

    const hasHigherInterest = result.plan.some(
      (s) => s.placeId === PLACE_B.placeId || s.placeId === PLACE_C.placeId,
    );
    expect(hasHigherInterest).toBe(true);
  });

  // Mong đợi: computeTrajectory trên result.plan trả về trajectory dài plan.length+1 —
  // trajectory của kết quả BeamSearch phải self-consistent với hàm trajectory.
  // Kết quả thực tế: trajectory.length === result.plan.length + 1 → PASS
  it('result plan produces a valid trajectory of length plan.length + 1', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });
    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);
    const result = beam.search(ctx);

    const trajectory = evolver.computeTrajectory(result.plan, ctx.initialState, ctx);
    expect(trajectory).toHaveLength(result.plan.length + 1);
  });

  // Mong đợi: khi BeamSearch tìm được plan cải tiến (parent != null), mutationHistory
  // phải có ít nhất 1 entry với operator thuộc tập hợp 5 operators hợp lệ.
  // Kết quả thực tế: mutationHistory.length > 0, mỗi entry có operator hợp lệ → PASS
  it('result node has non-empty mutationHistory with valid operator names when improvement found', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });
    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);
    const result = beam.search(ctx);

    if (result.parent !== null) {
      expect(result.mutationHistory.length).toBeGreaterThan(0);
      const validOps = ['TIME_SHIFT', 'SWAP_ORDER', 'REPLACE_PLACE', 'DROP_SLOT', 'INSERT_ALT'];
      for (const m of result.mutationHistory) {
        expect(validOps).toContain(m.operator);
      }
    }
  });

  // Mong đợi: score của result node bằng đúng với score tính lại từ result.plan —
  // BeamSearch phải lưu score chính xác, không để lệch so với thực tế.
  // Kết quả thực tế: result.score ≈ scorer.score(result.plan, trajectory, weights, ctx) → PASS
  it('result.score matches the score recomputed from result.plan using the real scorer', () => {
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });
    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);
    const result = beam.search(ctx);

    const recomputedStates = evolver.computeTrajectory(result.plan, ctx.initialState, ctx);
    const recomputedScore = scorer.score(result.plan, recomputedStates, INTEREST_WEIGHTS, ctx);

    expect(result.score).toBeCloseTo(recomputedScore, 5);
  });

  // Mong đợi: với 3-slot plan (cả 3 thăm PLACE_A), BeamSearch không crash —
  // thuật toán phải stable với plan dài hơn và nhiều mutation candidates.
  // Kết quả thực tế: result.plan.length > 0 và không throw → PASS
  it('handles a 3-slot plan without crashing and returns a non-empty plan', () => {
    const slot3 = makeSlot({
      slotId: 's3', placeId: PLACE_A.placeId, slotOrder: 2,
      plannedStart: '2026-04-21T04:00:00.000Z',
      plannedEnd:   '2026-04-21T05:00:00.000Z',
    });
    const ctx = makeBeamCtx(ALL_PLACES, [SLOT_1, SLOT_2, slot3], {
      user: makeUser(PREF_VEC),
      weights: INTEREST_WEIGHTS,
    });
    const beam = new BeamSearch(evolver, ops, scorer, FAST_CONFIG);

    expect(() => beam.search(ctx)).not.toThrow();
    const result = beam.search(ctx);
    expect(result.plan.length).toBeGreaterThan(0);
  });
});
