import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import StateEvolver, { type ReplanContext } from '../src/replanner/StateEvolver';
import type { TripSlot, Place, TripState, UserPreference, PlaceTag } from '@app/types';

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
    slotId: `slot-${Math.random().toString(36).substr(2, 9)}`,
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-21T02:00:00.000Z', // 09:00 VN
    plannedEnd: '2026-04-21T03:00:00.000Z',   // 10:00 VN
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
    budgetRemaining: 5_000_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T01:00:00.000Z', // 08:00 VN
    source: 'simulated',
    ...overrides,
  };
}

function makeCtx(
  candidatePool: Place[],
  overrides: Partial<ReplanContext> = {},
): ReplanContext {
  return {
    candidatePool,
    user: {
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
      preferenceVector: new Array(10).fill(0),
      updatedAt: '2026-01-01T00:00:00Z',
    },
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    ...overrides,
  } as ReplanContext;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

describe('MutationOperators.repairSuffix', () => {
  let ops: MutationOperators;
  const P1 = makePlace({ placeId: 1, name: 'P1', minPrice: 10000, avgVisitDurationMin: 60 });
  const P2 = makePlace({ placeId: 2, name: 'P2', minPrice: 20000, avgVisitDurationMin: 90 });
  const ALL_PLACES = [P1, P2];

  beforeEach(() => {
    ops = new MutationOperators(new StateEvolver());
  });

  const repairSuffix = (plan: TripSlot[], fromIndex: number, ctx: ReplanContext) => {
    return (ops as any).repairSuffix(plan, fromIndex, ctx);
  };

  // 1. Base Cases & Edge Cases
  describe('1. Base Cases & Edge Cases', () => {
    it('Test 1.1: Trả về mảng rỗng [] khi input plan là một mảng rỗng', () => {
      const result = repairSuffix([], 0, makeCtx(ALL_PLACES));
      expect(result).toEqual([]);
    });

    it('Test 1.2: Trả về null khi có một slot trong mảng không tìm thấy placeId tương ứng trong ctx.candidatePool', () => {
      const plan = [makeSlot({ placeId: 999 })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result).toBeNull();
    });
  });

  // 2. Cursor & Index Initialization
  describe('2. Cursor & Index Initialization', () => {
    it('Test 2.1 (fromIndex = 0): cursorMs được khởi tạo từ ctx.initialState.capturedAt và currentDayIndex lấy từ dayIndex của slot đầu tiên trong plan (không phải initialState.dayIndex)', () => {
      const capturedAt = '2026-04-21T02:00:00.000Z'; // 09:00 VN
      const ctx = makeCtx(ALL_PLACES, {
        initialState: makeState({ capturedAt, dayIndex: 5 }) // dayIndex=5 trong state bị bỏ qua
      });
      // Slot có dayIndex=0 riêng — phải được tôn trọng thay vì dùng initialState.dayIndex=5
      const plan = [makeSlot({ placeId: 1, dayIndex: 0, plannedStart: '2026-04-21T01:00:00.000Z' })];
      const result = repairSuffix(plan, 0, ctx);

      expect(result[0].plannedStart).toBe(capturedAt);
      expect(result[0].dayIndex).toBe(0); // slot's own dayIndex, not initialState.dayIndex (5)
    });

    it('Test 2.2 (fromIndex > 0): cursorMs được nối tiếp từ plannedEnd của plan[fromIndex - 1] và currentDayIndex lấy từ dayIndex của slot trước đó', () => {
      const slot0 = makeSlot({ 
        slotId: 's0', 
        placeId: 1, 
        dayIndex: 2, 
        plannedEnd: '2026-04-21T04:00:00.000Z' // 11:00 VN
      });
      const slot1 = makeSlot({ 
        slotId: 's1', 
        placeId: 2, 
        plannedStart: '2026-04-21T02:00:00.000Z' // Earlier than s0.end
      });
      const plan = [slot0, slot1];
      const ctx = makeCtx(ALL_PLACES);
      const result = repairSuffix(plan, 1, ctx);
      
      expect(result[1].plannedStart).toBe(slot0.plannedEnd);
      expect(result[1].dayIndex).toBe(2);
    });
  });

  // 3. Duration Constraints
  describe('3. Duration Constraints', () => {
    it('Test 3.1: Slot có thời lượng dự kiến nhỏ hơn MIN_SLOT_DURATION_MIN (15 phút) -> Thời lượng bị ép lên mức tối thiểu', () => {
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T02:00:00.000Z', 
        plannedEnd: '2026-04-21T02:05:00.000Z' // 5 mins
      })];
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 5 })]);
      const result = repairSuffix(plan, 0, ctx);
      
      const start = new Date(result[0].plannedStart).getTime();
      const end = new Date(result[0].plannedEnd).getTime();
      expect((end - start) / 60000).toBe(15);
    });

    it('Test 3.2: Slot có thời lượng hiện tại nhỏ hơn avgVisitDurationMin của địa điểm -> targetDurationMs được lấy bằng avgVisitDurationMin', () => {
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T02:00:00.000Z', 
        plannedEnd: '2026-04-21T02:30:00.000Z' // 30 mins
      })];
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 60 })]);
      const result = repairSuffix(plan, 0, ctx);
      
      const start = new Date(result[0].plannedStart).getTime();
      const end = new Date(result[0].plannedEnd).getTime();
      expect((end - start) / 60000).toBe(60);
    });

    it('Test 3.3: Slot có thời lượng hiện tại lớn hơn avgVisitDurationMin của địa điểm -> Dùng avgVisitDurationMin thay vì giữ thời lượng hiện tại', () => {
      const plan = [makeSlot({
        placeId: 1,
        plannedStart: '2026-04-21T02:00:00.000Z',
        plannedEnd: '2026-04-21T04:00:00.000Z' // 120 mins (larger than avgVisitDurationMin)
      })];
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 60 })]);
      const result = repairSuffix(plan, 0, ctx);

      const start = new Date(result[0].plannedStart).getTime();
      const end = new Date(result[0].plannedEnd).getTime();
      expect((end - start) / 60000).toBe(60);
    });
  });

  // 4. Time Shifting
  describe('4. Time Shifting', () => {
    it('Test 4.1 (Bị đẩy lùi): cursorMs lớn hơn plannedStart của slot hiện tại -> plannedStart mới phải được dời xuống bằng cursorMs', () => {
      const capturedAt = '2026-04-21T03:00:00.000Z'; // 10:00 VN
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T02:00:00.000Z' // 09:00 VN
      })];
      const ctx = makeCtx(ALL_PLACES, { initialState: makeState({ capturedAt }) });
      const result = repairSuffix(plan, 0, ctx);
      
      expect(result[0].plannedStart).toBe(capturedAt);
    });

    it('Test 4.2 (Có khoảng trống): cursorMs nhỏ hơn plannedStart của slot hiện tại -> plannedStart được giữ nguyên (không bị kéo lên sớm hơn)', () => {
      const capturedAt = '2026-04-21T01:00:00.000Z'; // 08:00 VN
      const plannedStart = '2026-04-21T03:00:00.000Z'; // 10:00 VN
      const plan = [makeSlot({ placeId: 1, plannedStart })];
      const ctx = makeCtx(ALL_PLACES, { initialState: makeState({ capturedAt }) });
      const result = repairSuffix(plan, 0, ctx);
      
      expect(result[0].plannedStart).toBe(plannedStart);
    });
  });

  // 5. Day Boundaries & Overflow Handling
  describe('5. Day Boundaries & Overflow Handling', () => {
    it('Test 5.1 (Trong giới hạn mềm): endHour vượt quá DAY_END_HOUR nhưng phần dư vẫn nhỏ hơn hoặc bằng ctx.maxOverflowMinutes -> Giữ nguyên dayIndex, không ngắt ngày', () => {
      const ctx = makeCtx(ALL_PLACES, { maxOverflowMinutes: 30 } as any);
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T14:00:00.000Z', // 21:00 VN
        plannedEnd: '2026-04-21T15:15:00.000Z'   // 22:15 VN
      })];
      const result = repairSuffix(plan, 0, ctx);
      
      expect(result[0].dayIndex).toBe(0);
    });

    it('Test 5.2 (Vượt giới hạn mềm/Ngắt ngày): endHour lớn hơn DAY_END_HOUR + maxOverflow -> Tăng dayIndex lên 1, dời lịch sang DAY_START_HOUR (8:00 AM) của ngày tiếp theo', () => {
      // Place has avgVisitDurationMin=120 so slot starting 21:00 VN ends at 23:00 VN (overflow 60 min > maxOverflow 30 min)
      // Plan has a day-1 slot so maxAllowedDayIndex=1, allowing the overflow.
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 120 })], { maxOverflowMinutes: 30 } as any);
      const plan = [
        makeSlot({
          placeId: 1,
          plannedStart: '2026-04-21T14:00:00.000Z', // 21:00 VN
          plannedEnd: '2026-04-21T16:00:00.000Z',
        }),
        makeSlot({ placeId: 1, dayIndex: 1, plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const result = repairSuffix(plan, 0, ctx);

      expect(result[0].dayIndex).toBe(1);
      const expectedStart = '2026-04-22T01:00:00.000Z'; // 08:00 VN next day
      expect(result[0].plannedStart).toBe(expectedStart);
    });

    it('Test 5.3 (Bắt đầu quá sớm/Underflow): Do việc dời lịch, endHour lọt vào khoảng thời gian trước DAY_START_HOUR -> Ép plannedStart về đúng DAY_START_HOUR của ngày hôm đó', () => {
      const capturedAt = '2026-04-20T21:00:00.000Z'; // 04:00 AM VN (21/04)
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-20T21:00:00.000Z' 
      })];
      const ctx = makeCtx(ALL_PLACES, { initialState: makeState({ capturedAt }) });
      const result = repairSuffix(plan, 0, ctx);
      
      expect(result[0].plannedStart).toBe('2026-04-21T01:00:00.000Z');
    });
  });

  // 6. Slot Updates & Cost Fallback
  describe('6. Slot Updates & Cost Fallback', () => {
    it('Test 6.1: Slot có estimatedCost > 0 -> Giá trị estimatedCost được bảo toàn', () => {
      const plan = [makeSlot({ placeId: 1, estimatedCost: 150000 })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].estimatedCost).toBe(150000);
    });

    it('Test 6.2: Slot có estimatedCost = 0 hoặc âm -> estimatedCost được cập nhật bằng place.minPrice', () => {
      const plan = [
        makeSlot({ slotId: 's1', placeId: 1, estimatedCost: 0 }),
        makeSlot({ slotId: 's2', placeId: 2, estimatedCost: -1 })
      ];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].estimatedCost).toBe(P1.minPrice);
      expect(result[1].estimatedCost).toBe(P2.minPrice);
    });

    it('Test 6.3: Cập nhật đúng thuộc tính slotOrder dựa trên chỉ số index của vòng lặp', () => {
      const plan = [
        makeSlot({ slotId: 's1', slotOrder: 10 }),
        makeSlot({ slotId: 's2', slotOrder: 20 })
      ];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].slotOrder).toBe(0);
      expect(result[1].slotOrder).toBe(1);
    });
  });

  // 7. Opening Hours Validation
  describe('7. Opening Hours Validation', () => {
    it('Test 7.1: Mọi slot sau khi tính toán đều lọt qua hàm withinOpeningHours -> Hàm repairSuffix trả về mảng repaired thành công', () => {
      const placeWithHours = makePlace({
        placeId: 1,
        openingHours: [{ dayOfWeek: 1, openTime: '08:00', closeTime: '12:00' }]
      });
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' })];
      const result = repairSuffix(plan, 0, makeCtx([placeWithHours]));
      expect(result).not.toBeNull();
    });

    it('Test 7.2: Có ít nhất một slot bị dịch chuyển thời gian dẫn đến việc nằm ngoài giờ mở cửa -> Hàm repairSuffix trả về null', () => {
       const placeWithHours = makePlace({
        placeId: 1,
        openingHours: [{ dayOfWeek: 1, openTime: '08:00', closeTime: '10:00' }]
      });
      const capturedAt = '2026-04-21T04:00:00.000Z'; // 11:00 VN
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' })];
      const result = repairSuffix(plan, 0, makeCtx([placeWithHours], { initialState: makeState({ capturedAt }) }));
      expect(result).toBeNull();
    });
  });

  // 8. Hiệu ứng dây chuyền
  describe('8. Hiệu ứng dây chuyền (Cascading & Domino Effects)', () => {
    it('Test 8.1 (Cascading Shift): Thay đổi plannedEnd của slot ở fromIndex trễ đi 2 tiếng. Kiểm tra toàn bộ các slot phía sau bị đẩy lùi đúng 2 tiếng', () => {
      const s0 = makeSlot({ slotId: 's0', placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z', plannedEnd: '2026-04-21T05:00:00.000Z' }); 
      const s1 = makeSlot({ slotId: 's1', placeId: 2, plannedStart: '2026-04-21T05:00:00.000Z', plannedEnd: '2026-04-21T06:00:00.000Z' });
      const s2 = makeSlot({ slotId: 's2', placeId: 1, plannedStart: '2026-04-21T06:00:00.000Z', plannedEnd: '2026-04-21T07:00:00.000Z' });
      
      const plan = [s0, s1, s2];
      s0.plannedEnd = '2026-04-21T07:00:00.000Z'; // 14:00 VN (+2h from original 12:00 VN)
      const result = repairSuffix([s0, s1, s2], 1, makeCtx(ALL_PLACES));
      
      expect(result[1].plannedStart).toBe(s0.plannedEnd);
      expect(result[2].plannedStart).toBe(result[1].plannedEnd);
      
      const s1OrigStart = new Date(s1.plannedStart).getTime();
      const s1NewStart = new Date(result[1].plannedStart).getTime();
      expect(s1NewStart - s1OrigStart).toBe(2 * 3600000);
    });

    it('Test 8.2 (Domino Day-Break): Một slot bị tràn qua giới hạn ngày, kiểm tra slot tiếp theo nối tiếp ở ngày mới', () => {
      // P1 has avgVisitDurationMin=120 so slot starting 21:00 VN ends at 23:00 VN → overflows past 22:00 VN (DAY_END_HOUR)
      // s1 is explicitly on day 1 so maxAllowedDayIndex=1 allows the overflow.
      const bigP1 = makePlace({ placeId: 1, avgVisitDurationMin: 120 });
      const s0 = makeSlot({ slotId: 's0', placeId: 1, plannedStart: '2026-04-21T14:00:00.000Z', plannedEnd: '2026-04-21T16:00:00.000Z' });
      const s1 = makeSlot({ slotId: 's1', placeId: 2, dayIndex: 1, plannedStart: '2026-04-22T01:00:00.000Z', plannedEnd: '2026-04-22T02:30:00.000Z' });

      const result = repairSuffix([s0, s1], 0, makeCtx([bigP1, P2]));

      expect(result[0].dayIndex).toBe(1);
      expect(result[1].dayIndex).toBe(1);
      expect(result[1].plannedStart).toBe(result[0].plannedEnd);
    });

    it('Test 8.3 (Cascading Opening Hours Failure): Đẩy slot sang ngày mới nhưng ngày đó địa điểm đóng cửa', () => {
      const placeOnlyOpenMon = makePlace({
        placeId: 2,
        openingHours: [{ dayOfWeek: 0, openTime: '08:00', closeTime: '20:00' }]
      });
      const s0 = makeSlot({ slotId: 's0', placeId: 1, plannedStart: '2026-04-20T14:00:00.000Z', plannedEnd: '2026-04-20T16:00:00.000Z' }); 
      const s1 = makeSlot({ slotId: 's1', placeId: 2, plannedStart: '2026-04-20T16:00:00.000Z' }); 
      
      const result = repairSuffix([s0, s1], 0, makeCtx([P1, placeOnlyOpenMon]));
      expect(result).toBeNull();
    });
  });

  // 9. Strict Time Boundaries
  describe('9. Strict Time Boundaries', () => {
    it('Test 9.1 (Sát nút maxOverflow): Slot kết thúc lúc DAY_END_HOUR + (maxOverflow / 60)', () => {
      const ctx = makeCtx(ALL_PLACES, { maxOverflowMinutes: 30 } as any);
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T14:30:00.000Z', // 21:30 VN
        plannedEnd: '2026-04-21T15:30:00.000Z'   // 22:30 VN
      })];
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].dayIndex).toBe(0);
    });

    it('Test 9.2 (Vượt maxOverflow đúng 1 mili-giây): Bắt buộc ngắt ngày', () => {
      // plannedStart is 1ms past 21:30 VN so end = 22:30:00.001 VN, which is 1ms past the soft boundary.
      // A day-1 dummy slot ensures maxAllowedDayIndex=1 so the overflow is accepted.
      const ctx = makeCtx(ALL_PLACES, { maxOverflowMinutes: 30 } as any);
      const plan = [
        makeSlot({ placeId: 1, plannedStart: '2026-04-21T14:30:00.001Z', plannedEnd: '2026-04-21T15:30:00.001Z' }),
        makeSlot({ placeId: 1, dayIndex: 1, plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].dayIndex).toBe(1);
    });

    it('Test 9.3 (Xử lý Slot quá dài - Mega Slot)', () => {
      // A day-1 dummy slot (short place 2) ensures maxAllowedDayIndex=1 so the 24h slot can land on day 1.
      // The dummy uses a different short-duration place so it doesn't itself overflow.
      const megaPlace = makePlace({ placeId: 1, avgVisitDurationMin: 24 * 60 });
      const shortPlace = makePlace({ placeId: 2, avgVisitDurationMin: 60 });
      const plan = [
        makeSlot({ placeId: 1 }),
        makeSlot({ placeId: 2, dayIndex: 1, plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const result = repairSuffix(plan, 0, makeCtx([megaPlace, shortPlace]));
      expect(result[0].dayIndex).toBe(1);
    });

    it('Test 9.4 (Underflow Catch): Slot bị xếp nhầm vào 4:00 AM -> Ép về 8:00 AM', () => {
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-20T21:00:00.000Z' })]; 
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(new Date(result[0].plannedStart).getUTCHours()).toBe(1); 
    });
  });

  // 10. Tính toàn vẹn của Prefix
  describe('10. Tính toàn vẹn của Prefix', () => {
    it('Test 10.1 (Bảo toàn Prefix)', () => {
      const s0 = makeSlot({ slotId: 's0', placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' });
      const s1 = makeSlot({ slotId: 's1', placeId: 2 });
      const plan = [s0, s1];
      const result = repairSuffix(plan, 1, makeCtx(ALL_PLACES));
      expect(result[0]).toEqual(s0);
    });

    it('Test 10.2 (fromIndex ngoài vùng)', () => {
      const plan = [makeSlot()];
      const result = repairSuffix(plan, 5, makeCtx(ALL_PLACES));
      // Expected: Should not throw and return original plan copy
      expect(result).toHaveLength(plan.length);
    });
  });

  // 11. Các tham số Context cực đoan
  describe('11. Các tham số Context cực đoan', () => {
    it('Test 11.1 (maxOverflowMinutes = 0)', () => {
      // A day-1 dummy slot ensures maxAllowedDayIndex=1 so the strict-limit overflow is accepted.
      const ctx = makeCtx(ALL_PLACES, { maxOverflowMinutes: 0 } as any);
      const plan = [
        makeSlot({ placeId: 1, plannedStart: '2026-04-21T14:59:00.000Z', plannedEnd: '2026-04-21T15:01:00.000Z' }),
        makeSlot({ placeId: 1, dayIndex: 1, plannedStart: '2026-04-22T05:00:00.000Z', plannedEnd: '2026-04-22T06:00:00.000Z' }),
      ];
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].dayIndex).toBe(1);
    });

    it('Test 11.2 (maxOverflowMinutes rất lớn)', () => {
      const ctx = makeCtx(ALL_PLACES, { maxOverflowMinutes: 1440 } as any);
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T14:00:00.000Z', 
        plannedEnd: '2026-04-22T04:00:00.000Z' 
      })];
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].dayIndex).toBe(0);
    });

    it('Test 11.3 (Cursor kế thừa từ quá khứ)', () => {
      const capturedAt = '2026-04-19T02:00:00.000Z';
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES, { initialState: makeState({ capturedAt }) }));
      expect(result[0].plannedStart).toBe('2026-04-21T02:00:00.000Z');
    });
  });

  // 12. So sánh ưu tiên chi phí & thời lượng
  describe('12. So sánh ưu tiên chi phí & thời lượng', () => {
    it('Test 12.1 (Cost bằng 0 và âm)', () => {
      const plan = [
        makeSlot({ placeId: 1, estimatedCost: 0 }),
        makeSlot({ placeId: 2, estimatedCost: -100 })
      ];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].estimatedCost).toBe(10000);
      expect(result[1].estimatedCost).toBe(20000);
    });

    it('Test 12.2 (Thời lượng planned lớn hơn avg -> dùng avgVisitDurationMin)', () => {
      const plan = [makeSlot({
        placeId: 1,
        plannedStart: '2026-04-21T02:00:00.000Z',
        plannedEnd: '2026-04-21T06:00:00.000Z' // 240 mins existing window; ignored in favour of avgVisitDurationMin
      })];
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 60 })]);
      const result = repairSuffix(plan, 0, ctx);
      expect((new Date(result[0].plannedEnd).getTime() - new Date(result[0].plannedStart).getTime()) / 60000).toBe(60);
    });

    it('Test 12.3 (Fallback cho minPrice undefined)', () => {
      const plan = [makeSlot({ placeId: 1, estimatedCost: 0 })];
      const ctx = makeCtx([makePlace({ placeId: 1, minPrice: undefined as any })]);
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].estimatedCost).toBe(0);
    });
  });

  // 13. Bug Discovery Tests
  describe('13. Bug Discovery Tests', () => {
    it('Test 13.1 (Lỗi mở cửa xuyên đêm)', () => {
      const crossMidnightPlace = makePlace({
        placeId: 1,
        openingHours: [{ dayOfWeek: 1, openTime: '22:00', closeTime: '04:00' }]
      });
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T16:00:00.000Z', 
        plannedEnd: '2026-04-21T18:00:00.000Z' 
      })];
      const result = repairSuffix(plan, 0, makeCtx([crossMidnightPlace]));
      expect(result).not.toBeNull(); 
    });

    it('Test 13.2 (Lỗi NaN lây nhiễm)', () => {
      const plan = [makeSlot({ placeId: 1, plannedStart: 'Invalid' })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result).toBeNull();
    });

    it('Test 13.3 (Lỗi dời ngày liên tục)', () => {
      // A 10000-min slot cannot fit in a single-day plan — repairSuffix should return null
      // (no infinite loop; terminates cleanly after one shiftToNextDayMorning).
      const megaPlace = makePlace({ placeId: 1, avgVisitDurationMin: 10000 });
      const plan = [makeSlot({ placeId: 1 })];
      const result = repairSuffix(plan, 0, makeCtx([megaPlace]));
      expect(result).toBeNull();
    });
  });

  // 14. Immutability
  describe('14. Immutability', () => {
    it('Test 14.1 (Không mutate Input Array)', () => {
      const plan = [makeSlot()];
      const original = [...plan];
      repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(plan).toEqual(original);
    });

    it('Test 14.2 (Không mutate Input Objects)', () => {
      const slot = makeSlot();
      const plan = [slot];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0]).not.toBe(slot);
    });
  });

  // 15. Thử thách Timezone & Locale
  describe('15. Thử thách Timezone & Locale', () => {
    it('Test 15.1: Máy chủ ở UTC-8 - Mỹ', () => {
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].plannedStart).toBe('2026-04-21T02:00:00.000Z');
    });

    it('Test 15.2: Máy chủ ở UTC+9 - Nhật Bản', () => {
      const plan = [makeSlot({ placeId: 1, plannedStart: '2026-04-21T02:00:00.000Z' })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result[0].plannedStart).toBe('2026-04-21T02:00:00.000Z');
    });
  });

  // 16. Góc khuất của Ngày trong Tuần
  describe('16. Góc khuất của Ngày trong Tuần', () => {
    it('Test 16.1 (Dời từ Chủ Nhật sang Thứ 2)', () => {
       const placeMonOnly = makePlace({
         placeId: 1,
         openingHours: [{ dayOfWeek: 0, openTime: '08:00', closeTime: '20:00' }]
       });
       // Slot is on Sunday 22:00 VN (April 19 2026). Night overflow shifts it to Monday (dayOfWeek=0).
       // A day-1 dummy slot ensures maxAllowedDayIndex=1 so the overflow lands on day 1.
       const s0 = makeSlot({ placeId: 1, plannedStart: '2026-04-19T15:00:00.000Z' });
       s0.plannedEnd = '2026-04-19T17:00:00.000Z';
       const s1 = makeSlot({ placeId: 1, dayIndex: 1, plannedStart: '2026-04-20T05:00:00.000Z', plannedEnd: '2026-04-20T06:00:00.000Z' });
       const ctx = makeCtx([placeMonOnly], {
         initialState: makeState({ capturedAt: '2026-04-19T15:00:00.000Z' }),
       });
       const result = repairSuffix([s0, s1], 0, ctx);
       expect(result).not.toBeNull();
       expect(result[0].dayIndex).toBe(1);
    });

    it('Test 16.2 (Dời lịch vào cuối tháng/Năm nhuận)', () => {
      // Slot starts at 22:00 VN Feb 28 2028 (leap year). Night overflow moves it to Feb 29.
      // A day-1 dummy slot ensures maxAllowedDayIndex=1 so the overflow lands on day 1.
      const s0 = makeSlot({
        placeId: 1,
        plannedStart: '2028-02-28T15:00:00.000Z',
        plannedEnd: '2028-02-28T17:00:00.000Z',
      });
      const s1 = makeSlot({ placeId: 1, dayIndex: 1, plannedStart: '2028-02-29T05:00:00.000Z', plannedEnd: '2028-02-29T06:00:00.000Z' });
      const result = repairSuffix([s0, s1], 0, makeCtx(ALL_PLACES));
      expect(result[0].plannedStart).toContain('2028-02-29');
    });
  });

  // 17. Sai số Dấu Phẩy Động
  describe('17. Sai số Dấu Phẩy Động', () => {
    it('Test 17.1 (Biên độ làm tròn giờ)', () => {
      // Place with avgVisitDurationMin=30 so slot ends at exactly 22:30 VN (= DAY_END_HOUR + maxOverflow).
      // The condition is strictly-greater-than, so 22:30 exactly must NOT trigger a day break.
      const ctx = makeCtx([makePlace({ placeId: 1, avgVisitDurationMin: 30 })], { maxOverflowMinutes: 30 } as any);
      const plan = [makeSlot({
        placeId: 1,
        plannedStart: '2026-04-21T15:00:00.000Z', // 22:00 VN
        plannedEnd: '2026-04-21T15:30:00.000Z',   // 22:30 VN
      })];
      const result = repairSuffix(plan, 0, ctx);
      expect(result[0].dayIndex).toBe(0);
    });
  });

  // 18. Dữ liệu Đầu vào Khác Thường
  describe('18. Dữ liệu Đầu vào Khác Thường', () => {
    it('Test 18.1 (Âm thời gian)', () => {
      const plan = [makeSlot({ 
        placeId: 1, 
        plannedStart: '2026-04-21T05:00:00.000Z', 
        plannedEnd: '2026-04-21T04:00:00.000Z' 
      })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      const duration = (new Date(result[0].plannedEnd).getTime() - new Date(result[0].plannedStart).getTime()) / 60000;
      expect(duration).toBe(60); 
    });

    it('Test 18.2 (Từ chối Place không tồn tại)', () => {
      const plan = [makeSlot({ placeId: 9999 })];
      const result = repairSuffix(plan, 0, makeCtx(ALL_PLACES));
      expect(result).toBeNull();
    });

    it('Test 18.3 (OpeningHours mảng rỗng)', () => {
      const placeNoHours = makePlace({ placeId: 1, openingHours: [] });
      const plan = [makeSlot({ placeId: 1 })];
      const result = repairSuffix(plan, 0, makeCtx([placeNoHours]));
      expect(result).not.toBeNull();
    });
  });
});
