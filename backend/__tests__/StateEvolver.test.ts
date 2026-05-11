import { describe, it, expect, beforeEach, vi } from 'vitest';
import StateEvolver, {
  type EvolveContext,
  type ReplanContext,
  type WeatherSnapshot,
  clamp,
  dot,
  tagVectorOf,
} from '../src/replanner/StateEvolver';
import type { TripState, TripSlot, Place, UserPreference } from '@app/types';

// ---------------------------------------------------------------------------
// Test fixture factories
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

function makeUser(preferenceVector: number[] = new Array(10).fill(0)): UserPreference {
  return {
    userId: 'user-001',
    primaryPurpose: 'van_hoa',
    preferredTagIds: [],
    pace: 0.5,
    dailyScheduleType: 'normal',
    foodPreferences: [],
    budgetPerDayMin: 200_000,
    budgetPerDayMax: 1_000_000,
    groupType: 'solo',
    mobilityRestrictions: [],
    preferenceVector,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const CLEAR_WEATHER: WeatherSnapshot = { rainMmPerH: 0 };

function makeCtx(overrides: Partial<EvolveContext> = {}): EvolveContext {
  return {
    travelTimeMin: 10,
    place: makePlace(),
    weatherAtSlot: CLEAR_WEATHER,
    user: makeUser(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Main Test Suites
// ---------------------------------------------------------------------------

describe('StateEvolver', () => {
  let evolver: StateEvolver;

  beforeEach(() => {
    evolver = new StateEvolver();
  });

  // ===========================================================================
  // Nhóm Test cho các Hàm Phụ Trợ (Helper Functions)
  // ===========================================================================
  describe('0. Helper Functions (Standalone)', () => {
    describe('clamp(x, lo, hi)', () => {
      it('x nằm giữa khoảng lo và hi (trả về x)', () => {
        expect(clamp(5, 0, 10)).toBe(5);
      });
      it('x nhỏ hơn lo (trả về lo)', () => {
        expect(clamp(-5, 0, 10)).toBe(0);
      });
      it('x lớn hơn hi (trả về hi)', () => {
        expect(clamp(15, 0, 10)).toBe(10);
      });
      it('x bằng đúng lo hoặc bằng đúng hi', () => {
        expect(clamp(0, 0, 10)).toBe(0);
        expect(clamp(10, 0, 10)).toBe(10);
      });
    });

    describe('dot(a, b)', () => {
      it('Hai mảng cùng độ dài, tích vô hướng dương', () => {
        expect(dot([1, 2], [3, 4])).toBe(1*3 + 2*4); // 3 + 8 = 11
      });
      it('Mảng a dài hơn mảng b', () => {
        expect(dot([1, 2, 3], [4, 5])).toBe(1*4 + 2*5 + 3*0); // 4 + 10 = 14
      });
      it('Mảng b dài hơn mảng a', () => {
        expect(dot([1, 2], [3, 4, 5])).toBe(1*3 + 2*4 + 0*5); // 3 + 8 = 11
      });
      it('Một trong hai mảng rỗng [] (trả về 0)', () => {
        expect(dot([], [1, 2])).toBe(0);
        expect(dot([1, 2], [])).toBe(0);
      });
      it('Hai mảng chứa giá trị 0 hoặc số âm', () => {
        expect(dot([1, -1, 0], [2, 3, 5])).toBe(1*2 + (-1)*3 + 0*5); // 2 - 3 = -1
      });
    });

    describe('tagVectorOf(place)', () => {
      it('place.tags là undefined hoặc null (trả về mảng 10 số 0)', () => {
        const v1 = tagVectorOf(makePlace({ tags: undefined as any }));
        expect(v1).toHaveLength(10);
        expect(v1.every(x => x === 0)).toBe(true);

        const v2 = tagVectorOf(makePlace({ tags: null as any }));
        expect(v2).toHaveLength(10);
        expect(v2.every(x => x === 0)).toBe(true);
      });
      it('place.tags là mảng rỗng []', () => {
        const v = tagVectorOf(makePlace({ tags: [] }));
        expect(v.every(x => x === 0)).toBe(true);
      });
      it('Các tagId nằm chính xác ở biên: 1 và 10', () => {
        const place = makePlace({ tags: [{ tagId: 1, name: 'a', displayName: 'a' }, { tagId: 10, name: 'b', displayName: 'b' }] });
        const v = tagVectorOf(place);
        expect(v[0]).toBe(1);
        expect(v[9]).toBe(1);
      });
      it('Các tagId nằm ngoài khoảng: 0, -1, 11, 99 (bị bỏ qua)', () => {
        const place = makePlace({ tags: [{ tagId: 0, name: '0', displayName: '0' }, { tagId: -1, name: '-1', displayName: '-1' }, { tagId: 11, name: '11', displayName: '11' }] });
        const v = tagVectorOf(place);
        expect(v.every(x => x === 0)).toBe(true);
      });
      it('Có các tagId trùng lặp trong mảng tags (vẫn gán v[id-1] = 1)', () => {
        const place = makePlace({ tags: [{ tagId: 5, name: 'x', displayName: 'x' }, { tagId: 5, name: 'x', displayName: 'x' }] });
        const v = tagVectorOf(place);
        expect(v[4]).toBe(1);
      });
    });
  });

  // ===========================================================================
  // 1. Nhóm Test: Tính Bất biến và Giá trị Cơ bản (Immutability & Basic Updates)
  // ===========================================================================
  describe('1. Immutability & Basic Updates', () => {
    it('Trạng thái không bị thay đổi (No Mutation)', () => {
      const oldState = makeState({ timeRemainingMin: 400 });
      const newState = evolver.evolve(oldState, makeSlot(), makeCtx());
      expect(newState).not.toBe(oldState);
      expect(oldState.timeRemainingMin).toBe(400);
    });

    it('Cập nhật thông tin slotOrder: oldState.slotOrder + 1', () => {
      const oldState = makeState({ slotOrder: 5 });
      const newState = evolver.evolve(oldState, makeSlot(), makeCtx());
      expect(newState.slotOrder).toBe(6);
    });

    it('Cập nhật tọa độ & nguồn', () => {
      const place = makePlace({ lat: 10.5, lng: 20.5 });
      const ctx = makeCtx({ place });
      const newState = evolver.evolve(makeState(), makeSlot(), ctx);
      expect(newState.currentLat).toBe(10.5);
      expect(newState.currentLng).toBe(20.5);
      expect(newState.source).toBe('simulated');
    });
  });

  // ===========================================================================
  // 2. Nhóm Test: Logic Thời gian và Ngân sách (Time & Budget Allocation)
  // ===========================================================================
  describe('2. Time & Budget Allocation', () => {
    it('Trường hợp có ctx.actualCost: Ngân sách bị trừ đúng số tiền thực tế', () => {
      const s = makeState({ budgetRemaining: 100_000 });
      const ctx = makeCtx({ actualCost: 30_000 });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.budgetRemaining).toBe(70_000);
    });

    it('Trường hợp không có actualCost: Ngân sách bị trừ dựa trên slot.estimatedCost', () => {
      const s = makeState({ budgetRemaining: 100_000 });
      const slot = makeSlot({ estimatedCost: 40_000 });
      const next = evolver.evolve(s, slot, makeCtx({ actualCost: undefined }));
      expect(next.budgetRemaining).toBe(60_000);
    });

    it('Trường hợp có ctx.actualDurationMin: Thời gian bị trừ đúng bằng travelTimeMin + actualDurationMin', () => {
      const s = makeState({ timeRemainingMin: 200 });
      const ctx = makeCtx({ travelTimeMin: 20, actualDurationMin: 80 });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.timeRemainingMin).toBe(100); // 200 - (20 + 80)
    });

    it('Trường hợp không có actualDurationMin: Thời gian bị trừ dựa trên place.avgVisitDurationMin', () => {
      const s = makeState({ timeRemainingMin: 200 });
      const place = makePlace({ avgVisitDurationMin: 45 });
      const ctx = makeCtx({ travelTimeMin: 15, actualDurationMin: undefined, place });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.timeRemainingMin).toBe(140); // 200 - (15 + 45)
    });

    it('timeRemainingMin có thể âm — isFeasible sẽ phát hiện và loại plan', () => {
      // [Bug 2 fix] Math.max(0,...) đã bị xóa. Giá trị âm được giữ nguyên để
      // isFeasible() có thể phát hiện vi phạm thời gian thay vì che khuất nó.
      const s = makeState({ timeRemainingMin: 30 });
      const ctx = makeCtx({ travelTimeMin: 50, actualDurationMin: 60 });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.timeRemainingMin).toBe(-80); // 30 - (50 + 60) = -80
      expect(evolver.isFeasible(next)).toBe(false);
    });

    it('Kiểm tra budgetRemaining khi chi phí vượt quá ngân sách (trả về số âm)', () => {
      const s = makeState({ budgetRemaining: 10_000 });
      const next = evolver.evolve(s, makeSlot(), makeCtx({ actualCost: 50_000 }));
      expect(next.budgetRemaining).toBe(-40_000);
    });
  });

  // ===========================================================================
  // 3. Nhóm Test: Logic Thể lực (Fatigue Dynamics)
  // ===========================================================================
  describe('3. Fatigue Dynamics', () => {
    it('Tăng mệt mỏi do di chuyển & địa hình (0.05 và 0.10)', () => {
      const s = makeState({ fatigue: 0.2 });
      const ctx = makeCtx({
        travelTimeMin: 120, // travelLoad = 1.0 -> +0.05
        actualDurationMin: 60,
        place: makePlace({ terrainEasiness: 0.5 }), // terrainLoad = 0.5 * 1.0 = 0.5 -> +0.05
      });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.fatigue).toBeCloseTo(0.3, 5);
    });

    it('Phục hồi thể lực: meal (-0.12)', () => {
      const s = makeState({ fatigue: 0.5 });
      const slot = makeSlot({ activityType: 'meal' });
      const ctx = makeCtx({ travelTimeMin: 0, actualDurationMin: 60, place: makePlace({ terrainEasiness: 1.0 }) });
      const next = evolver.evolve(s, slot, ctx);
      expect(next.fatigue).toBeCloseTo(0.38, 5);
    });

    it('Phục hồi thể lực: rest (-0.20)', () => {
      const s = makeState({ fatigue: 0.5 });
      const slot = makeSlot({ activityType: 'rest' });
      const ctx = makeCtx({ travelTimeMin: 0, actualDurationMin: 60, place: makePlace({ terrainEasiness: 1.0 }) });
      const next = evolver.evolve(s, slot, ctx);
      expect(next.fatigue).toBeCloseTo(0.3, 5);
    });

    it('Biên giới hạn: fatigue kẹp về 0', () => {
      const s = makeState({ fatigue: 0.05 });
      const slot = makeSlot({ activityType: 'rest' });
      const next = evolver.evolve(s, slot, makeCtx({ travelTimeMin: 0, actualDurationMin: 0, place: makePlace({ terrainEasiness: 1.0 }) }));
      expect(next.fatigue).toBe(0);
    });

    it('Biên giới hạn: fatigue kẹp về 1', () => {
      const s = makeState({ fatigue: 0.95 });
      const ctx = makeCtx({ travelTimeMin: 300, actualDurationMin: 180, place: makePlace({ terrainEasiness: 0.0 }) });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.fatigue).toBe(1);
    });
  });

  // ===========================================================================
  // 4. Nhóm Test: Logic Thời tiết (Weather Impacts)
  // ===========================================================================
  describe('4. Weather Impacts', () => {
    it('Trời mưa & Hoạt động ngoài trời (Worst-case): fatigue +0.15, mood -0.08', () => {
      const s = makeState({ fatigue: 0.2, moodProxy: 0.6 });
      const ctx = makeCtx({
        weatherAtSlot: { rainMmPerH: 5 },
        place: makePlace({ indoorOutdoor: 'outdoor', terrainEasiness: 1.0 }),
        travelTimeMin: 0,
        actualDurationMin: 60,
      });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.fatigue).toBeCloseTo(0.35, 5);
      expect(next.moodProxy).toBeCloseTo(0.52, 5);
    });

    it('Trời mưa nhưng ở trong nhà (Safe Weather)', () => {
      const s = makeState({ fatigue: 0.2, moodProxy: 0.6 });
      const ctx = makeCtx({
        weatherAtSlot: { rainMmPerH: 5 },
        place: makePlace({ indoorOutdoor: 'indoor', terrainEasiness: 1.0 }),
        travelTimeMin: 0,
        actualDurationMin: 60,
      });
      const next = evolver.evolve(s, makeSlot(), ctx);
      expect(next.fatigue).toBe(0.2);
      expect(next.moodProxy).toBe(0.6);
    });

    it('Trời đẹp (rain < 5)', () => {
      const ctx = makeCtx({ weatherAtSlot: { rainMmPerH: 4.9 }, place: makePlace({ indoorOutdoor: 'outdoor', terrainEasiness: 1.0 }), travelTimeMin: 0, actualDurationMin: 60 });
      const next = evolver.evolve(makeState({ fatigue: 0.2 }), makeSlot(), ctx);
      expect(next.fatigue).toBe(0.2);
    });
  });

  // ===========================================================================
  // 5. Nhóm Test: Logic Tâm trạng (Mood & Interest Match)
  // ===========================================================================
  describe('5. Mood & Interest Match', () => {
    it('Khớp sở thích (High Interest Match): moodProxy +0.08 * interestMatch', () => {
      const prefVec = new Array(10).fill(0); prefVec[0] = 1; prefVec[1] = 1;
      const user = makeUser(prefVec);
      const place = makePlace({ tags: [{ tagId: 1, name: 'a', displayName: 'a' }, { tagId: 2, name: 'b', displayName: 'b' }] });
      const s = makeState({ moodProxy: 0.5, fatigue: 0.2 });
      const next = evolver.evolve(s, makeSlot(), makeCtx({ user, place, travelTimeMin: 0, actualDurationMin: 0 }));
      expect(next.moodProxy).toBeCloseTo(0.66, 5); // 0.5 + 0.16
    });

    it('Lệch sở thích (Zero Interest Match)', () => {
      const prefVec = new Array(10).fill(0); prefVec[0] = 1;
      const user = makeUser(prefVec);
      const place = makePlace({ tags: [] });
      const next = evolver.evolve(makeState({ moodProxy: 0.5, fatigue: 0.2 }), makeSlot(), makeCtx({ user, place }));
      expect(next.moodProxy).toBe(0.5);
    });

    it('Phạt tâm trạng do kiệt sức (Fatigue Penalty on Mood): (fatigue - 0.7) * 0.3', () => {
      const s = makeState({ fatigue: 0.8, moodProxy: 0.6 });
      const next = evolver.evolve(s, makeSlot(), makeCtx({ travelTimeMin: 0, actualDurationMin: 0, place: makePlace({ terrainEasiness: 1.0 }) }));
      expect(next.moodProxy).toBeCloseTo(0.57, 5); // 0.6 - 0.03
    });

    it('Biên giới hạn: mood kẹp về 0 và 1', () => {
      const sH = makeState({ moodProxy: 0.95 });
      const ctxH = makeCtx({ user: makeUser(new Array(10).fill(1)), place: makePlace({ tags: Array.from({ length: 5 }, (_, i) => ({ tagId: i + 1, name: 't', displayName: 't' })) }) });
      expect(evolver.evolve(sH, makeSlot(), ctxH).moodProxy).toBe(1);

      const sL = makeState({ moodProxy: 0.05, fatigue: 0.95 });
      expect(evolver.evolve(sL, makeSlot(), makeCtx({ travelTimeMin: 0, actualDurationMin: 0, place: makePlace({ terrainEasiness: 1.0 }) })).moodProxy).toBe(0);
    });
  });

  // ===========================================================================
  // 6. Nhóm Test: Dữ liệu Khuyết / Nullish Fallback (Robustness)
  // ===========================================================================
  describe('6. Robustness & Nullish Fallback', () => {
    it('Thiếu tags: place.tags là undefined hoặc null', () => {
      expect(() => tagVectorOf(makePlace({ tags: undefined as any }))).not.toThrow();
      expect(() => tagVectorOf(makePlace({ tags: null as any }))).not.toThrow();
    });

    it('Thiếu độ khó địa hình: fallback về 0.8', () => {
      const place = makePlace({ terrainEasiness: undefined as any });
      const next = evolver.evolve(makeState({ fatigue: 0 }), makeSlot(), makeCtx({ place, travelTimeMin: 0, actualDurationMin: 60 }));
      expect(next.fatigue).toBeCloseTo(0.02, 5); // terrainLoad = 0.2 -> delta = 0.02
    });
  });

  // ===========================================================================
  // Core evolve: Môi trường & Bất biến
  // ===========================================================================
  describe('Core evolve: Environment & Invariants', () => {
    it('Tính bất biến tuyệt đối (frozenState)', () => {
      const s = makeState();
      Object.freeze(s);
      expect(() => evolver.evolve(s, makeSlot(), makeCtx())).not.toThrow();
    });

    it('Dữ liệu sinh tự động: capturedAt là ISO valid, source là "simulated"', () => {
      const next = evolver.evolve(makeState(), makeSlot(), makeCtx());
      expect(new Date(next.capturedAt).toISOString()).toBe(next.capturedAt);
      expect(next.source).toBe('simulated');
    });
  });

  // ===========================================================================
  // Core evolve: Ranh giới Ngưỡng (Threshold Boundaries)
  // ===========================================================================
  describe('Core evolve: Threshold Boundaries', () => {
    it('Biên thời tiết (Rain Threshold): 4.9 vs 5.0', () => {
      const p = makePlace({ indoorOutdoor: 'outdoor', terrainEasiness: 1.0 });
      const s = makeState({ fatigue: 0.2 });
      expect(evolver.evolve(s, makeSlot(), makeCtx({ weatherAtSlot: { rainMmPerH: 4.9 }, place: p, travelTimeMin: 0, actualDurationMin: 60 })).fatigue).toBe(0.2);
      expect(evolver.evolve(s, makeSlot(), makeCtx({ weatherAtSlot: { rainMmPerH: 5.0 }, place: p, travelTimeMin: 0, actualDurationMin: 60 })).fatigue).toBeCloseTo(0.35, 5);
    });

    it('Biên kiệt sức (Fatigue Threshold): 0.7 vs 0.71', () => {
      const ctx = makeCtx({ travelTimeMin: 0, actualDurationMin: 0, place: makePlace({ terrainEasiness: 1.0 }) });
      expect(evolver.evolve(makeState({ fatigue: 0.7, moodProxy: 0.6 }), makeSlot(), ctx).moodProxy).toBe(0.6);
      expect(evolver.evolve(makeState({ fatigue: 0.71, moodProxy: 0.6 }), makeSlot(), ctx).moodProxy).toBeCloseTo(0.597, 5);
    });
  });

  // ===========================================================================
  // Core evolve: Kịch bản Tổ hợp (Complex Scenarios)
  // ===========================================================================
  describe('Core evolve: Complex Scenarios', () => {
    it('Tổ hợp Phục hồi (Rest Clamp)', () => {
      const s = makeState({ fatigue: 0.05 });
      expect(evolver.evolve(s, makeSlot({ activityType: 'meal' }), makeCtx({ travelTimeMin: 0, actualDurationMin: 0, place: makePlace({ terrainEasiness: 1.0 }) })).fatigue).toBe(0);
    });

    it('Tổ hợp Tâm trạng kép (Interest vs Rain vs Fatigue)', () => {
      const user = makeUser([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      const place = makePlace({ tags: [{ tagId: 1, name: 'a', displayName: 'a' }], indoorOutdoor: 'outdoor', terrainEasiness: 1.0 });
      const s = makeState({ moodProxy: 0.5, fatigue: 0.9 });
      const ctx = makeCtx({ user, place, weatherAtSlot: { rainMmPerH: 10 }, travelTimeMin: 0, actualDurationMin: 60 });
      
      const next = evolver.evolve(s, makeSlot(), ctx);
      // fatigue becomes 1.0. moodDelta = 0.08 - (1.0-0.7)*0.3 - 0.08 = -0.09
      expect(next.moodProxy).toBeCloseTo(0.41, 5);
    });
  });
});
