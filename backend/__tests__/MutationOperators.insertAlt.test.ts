import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { StateEvolver } from '../src/replanner/StateEvolver';
import type { TripSlot, Place, TripState, UserPreference, PlaceTag } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories (Copied from MutationOperators.test.ts)
// ---------------------------------------------------------------------------

function makeTag(tagId: number): PlaceTag {
  return { tagId, name: `tag${tagId}`, displayName: `Tag ${tagId}` };
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 101,
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
    placeId: 101,
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
    capturedAt: '2026-04-20T01:00:00.000Z', // One day earlier to avoid clamping
    source: 'simulated',
    ...overrides,
  };
}

function makeUser(): UserPreference {
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
    preferenceVector: new Array(10).fill(0),
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PLACE_1 = makePlace({ placeId: 101, name: 'Place 101' });
const PLACE_2 = makePlace({ placeId: 102, name: 'Place 102' });
const PLACE_3 = makePlace({ placeId: 103, name: 'Place 103' });

const SLOT_1 = makeSlot({ slotId: 's1', placeId: 101, slotOrder: 0 });

function makeCtx(
  candidatePool: Place[],
  overrides: Partial<any> = {},
): any {
  return {
    candidatePool,
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite: INSERT_ALT (OP-5)
// ---------------------------------------------------------------------------

describe('MutationOperators.insertAlt', () => {
  let evolver: StateEvolver;
  let ops: MutationOperators;

  beforeEach(() => {
    vi.restoreAllMocks();
    evolver = new StateEvolver();
    ops = new MutationOperators(evolver);
    // Mock estimateTravelTime to return a constant 15 mins for predictable timing
    vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(15);
    // Mock isPlanFeasible to return true by default
    vi.spyOn(evolver, 'isPlanFeasible').mockReturnValue(true);
  });

  describe('1. Nhóm kiểm thử: Lựa chọn ứng viên (Candidate Selection)', () => {
    it('TC1.1: Landmark-inject hợp lệ: Khi forceIncludePlaceId được truyền vào và chưa tồn tại trong plan', () => {
      const ctx = makeCtx([PLACE_1, PLACE_2, PLACE_3], {
        forceIncludePlaceId: 103
      });
      const results = ops.insertAlt([SLOT_1], ctx);

      // Kỳ vọng: Hệ thống chỉ đánh giá duy nhất ứng viên này
      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        const insertedSlot = r.newPlan.find(s => r.affectedSlotIds.includes(s.slotId));
        expect(insertedSlot?.placeId).toBe(103);
      });
      
      // Đảm bảo không có PLACE_2 (mặc dù nó có trong pool)
      const hasPlace2 = results.some(r => r.newPlan.some(s => s.placeId === 102));
      expect(hasPlace2).toBe(false);
    });

    it('TC1.2: Landmark-inject bị trùng lặp (Occupied): Khi forceIncludePlaceId trỏ đến một địa điểm đã có trong plan', () => {
      const statuses: Array<'planned' | 'completed' | 'skipped' | 'replaced'> = ['planned', 'completed', 'skipped', 'replaced'];
      
      for (const status of statuses) {
        const plan = [makeSlot({ placeId: 101, status })];
        const ctx = makeCtx([PLACE_1, PLACE_2], { forceIncludePlaceId: 101 });
        const results = ops.insertAlt(plan, ctx);
        
        // Kỳ vọng: Trả về mảng rỗng [] ngay lập tức
        expect(results).toEqual([]);
      }
    });

    it('TC1.3: Lọc và sắp xếp ứng viên thông thường: Không có forceIncludePlaceId', () => {
      // 10 địa điểm, 3 địa điểm đã occupied
      const pool = Array.from({ length: 10 }, (_, i) => makePlace({ placeId: 200 + i, name: `Pool${i}` }));
      const plan = [
        makeSlot({ placeId: 200 }),
        makeSlot({ placeId: 201 }),
        makeSlot({ placeId: 202 }),
      ];
      
      const ctx = makeCtx(pool);
      // Mock candidatePriority to return descending scores based on placeId
      const prioritySpy = vi.spyOn(MutationOperators as any, 'candidatePriority').mockImplementation((p: Place) => p.placeId);

      const results = ops.insertAlt(plan, ctx);

      // MAX_INSERT_CANDIDATES is 5 (internal constant)
      // Candidates should be 203, 204, 205, 206, 207, 208, 209 (7 total available)
      // Top 5 should be 209, 208, 207, 206, 205
      const insertedPlaceIds = new Set(results.map(r => {
        const inserted = r.newPlan.find(s => r.affectedSlotIds.includes(s.slotId));
        return inserted?.placeId;
      }));

      expect(insertedPlaceIds.size).toBeLessThanOrEqual(5);
      expect(insertedPlaceIds.has(209)).toBe(true);
      expect(insertedPlaceIds.has(205)).toBe(true);
      expect(insertedPlaceIds.has(202)).toBe(false); // Occupied
      
      prioritySpy.mockRestore();
    });

    it('TC1.4: Không có ứng viên khả dĩ: Khi mọi địa điểm trong pool đều đã occupied, hoặc pool rỗng', () => {
      // Trường hợp pool rỗng
      expect(ops.insertAlt([SLOT_1], makeCtx([]))).toEqual([]);

      // Trường hợp mọi địa điểm đã occupied
      const ctx = makeCtx([PLACE_1], {});
      expect(ops.insertAlt([SLOT_1], ctx)).toEqual([]);
    });
  });

  describe('2. Nhóm kiểm thử: Xác định ranh giới chèn (Start Position Boundary)', () => {
    it('TC2.1: Lịch trình hoàn toàn mới: Toàn bộ slot trong plan đều có status: \'planned\' và actualStart: null', () => {
      const plan = [
        makeSlot({ slotId: 's1', status: 'planned', actualStart: null }),
        makeSlot({ slotId: 's2', status: 'planned', actualStart: null }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]); // Must include PLACE_1 for s1/s2
      const results = ops.insertAlt(plan, ctx);

      // Kỳ vọng: startPos = 0. Hàm thử chèn từ vị trí đầu tiên.
      // Kiểm tra xem có kết quả nào chèn ở vị trí 0 không
      const hasInsertAtPos0 = results.some(r => r.repairedFromIndex === 0);
      expect(hasInsertAtPos0).toBe(true);
    });

    it('TC2.2: Lịch trình đang thực thi (In-progress): Slot 0 là completed, slot 1 là planned nhưng có actualStart', () => {
      const plan = [
        makeSlot({ slotId: 's1', status: 'completed' }),
        makeSlot({ slotId: 's2', status: 'planned', actualStart: '2026-04-21T01:30:00Z' }),
        makeSlot({ slotId: 's3', status: 'planned' }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt(plan, ctx);

      // Kỳ vọng: startPos = 2.
      results.forEach(r => {
        expect(r.repairedFromIndex).toBeGreaterThanOrEqual(2);
      });
      const pos0or1 = results.some(r => r.repairedFromIndex === 0 || r.repairedFromIndex === 1);
      expect(pos0or1).toBe(false);
    });

    it('TC2.3: Lịch trình có chứa slot bị huỷ/thay thế: [completed, skipped, replaced, planned]', () => {
      const plan = [
        makeSlot({ slotId: 's1', status: 'completed' }),
        makeSlot({ slotId: 's2', status: 'skipped' }),
        makeSlot({ slotId: 's3', status: 'replaced' }),
        makeSlot({ slotId: 's4', status: 'planned' }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt(plan, ctx);

      // Ranh giới: slot index 0 status completed -> startPos=1, index 1 skipped -> startPos=2, index 2 replaced is NOT skipped/completed but it IS NOT status !== 'planned' or actualStart !== null?
      // Check logic: if (slot.status !== 'planned' || (slot.status === 'planned' && slot.actualStart !== null)) { startPos = i + 1; break; }
      // status 'skipped' and 'replaced' are NOT 'planned'.
      // so s1(completed) -> startPos=1, then s2(skipped) -> startPos=2, then s3(replaced) -> startPos=3.
      
      results.forEach(r => {
        expect(r.repairedFromIndex).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe('3. Nhóm kiểm thử: Cập nhật Slot Order và Day Index', () => {
    it('TC3.1: Dồn lịch trong cùng một ngày', () => {
      const plan = [
        makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 }),
        makeSlot({ slotId: 's2', dayIndex: 0, slotOrder: 1 }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt(plan, ctx);

      // Chèn ở pos 1
      const r = results.find(x => x.repairedFromIndex === 1);
      expect(r).toBeDefined();
      expect(r?.newPlan[0].slotOrder).toBe(0);
      expect(r?.newPlan[1].slotOrder).toBe(1); // New slot
      expect(r?.newPlan[2].slotOrder).toBe(2); // Old s2 pushed back
      expect(r?.newPlan.every(s => s.dayIndex === 0)).toBe(true);
    });

    it('TC3.2: Dồn lịch tràn qua ngày mới (Day boundary crossing)', () => {
      const plan = [
        makeSlot({ slotId: 's1', dayIndex: 0, slotOrder: 0 }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      
      // Mock repairSuffix to return a plan where the last slot is pushed to next day
      vi.spyOn(ops, 'repairSuffix').mockImplementation((mutatedPlan: TripSlot[]) => {
        const repaired = mutatedPlan.map(s => ({ ...s }));
        if (repaired.length > 1) {
          repaired[repaired.length - 1].dayIndex = 1; // Push last slot to day 1
        }
        return repaired;
      });

      const results = ops.insertAlt(plan, ctx);
      const r = results[0];
      
      expect(r.newPlan[0].dayIndex).toBe(0);
      expect(r.newPlan[0].slotOrder).toBe(0);
      
      // The second slot was pushed to day 1
      expect(r.newPlan[1].dayIndex).toBe(1);
      expect(r.newPlan[1].slotOrder).toBe(0); // Reset to 0 for new day
    });
  });

  describe('4. Nhóm kiểm thử: Lọc và Thẩm định kết quả (Validation & Guard Clauses)', () => {
    it('TC4.1: Không thể sửa lịch trình (Repair fail)', () => {
      vi.spyOn(ops, 'repairSuffix').mockReturnValue(null);
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt([SLOT_1], ctx);
      expect(results).toEqual([]);
    });

    it('TC4.2: Chặn Time-Travel (Time Clamping)', () => {
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      // capturedAt: 2026-04-21T01:00:00Z
      ctx.initialState.capturedAt = '2026-04-21T10:00:00Z'; // 10:00 AM UTC
      
      // SLOT_1 is at 02:00 AM UTC. 
      // synthesizeSlot will likely produce a slot earlier than capturedAt if pos=0
      const results = ops.insertAlt([SLOT_1], ctx);
      
      results.forEach(r => {
        const insertedSlot = r.newPlan[r.repairedFromIndex!];
        const start = new Date(insertedSlot.plannedStart).getTime();
        const captured = new Date(ctx.initialState.capturedAt).getTime();
        expect(start).toBeGreaterThanOrEqual(captured);
      });
    });

    it('TC4.3: Lịch trình không khả thi (Infeasible)', () => {
      // simulateIfFeasible calls computeTrajectory then isFeasible on each produced state.
      // Mocking isFeasible(false) makes every simulated state fail the constraint check.
      vi.spyOn(evolver, 'isFeasible').mockReturnValue(false);
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt([SLOT_1], ctx);
      expect(results).toEqual([]);
    });
  });

  describe('5. Nhóm kiểm thử: Giới hạn và Đầu ra cấu trúc (Output Structure)', () => {
    it('TC5.1: Cắt ngọn số lượng tổ hợp (Result limit)', () => {
      // 5 candidates (MAX_INSERT_CANDIDATES)
      const pool = Array.from({ length: 5 }, (_, i) => makePlace({ placeId: 500 + i }));
      // 4 slots -> 5 insertion positions
      const plan = [
        makeSlot({ slotId: 'p1' }),
        makeSlot({ slotId: 'p2' }),
        makeSlot({ slotId: 'p3' }),
        makeSlot({ slotId: 'p4' }),
      ];
      // 5 * 5 = 25 total possible results. Should be capped at 20.
      const ctx = makeCtx([...pool, PLACE_1]);
      const results = ops.insertAlt(plan, ctx);
      
      expect(results.length).toBe(20);
    });

    it('TC5.2: Truy vết nhân quả chính xác (Affected Slot IDs)', () => {
      const plan = [
        makeSlot({ slotId: 's0', slotOrder: 0 }),
        makeSlot({ slotId: 's1', slotOrder: 1 }),
        makeSlot({ slotId: 's2', slotOrder: 2 }),
        makeSlot({ slotId: 's3', slotOrder: 3 }),
        makeSlot({ slotId: 's4', slotOrder: 4 }),
      ];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      const results = ops.insertAlt(plan, ctx);

      // Chèn tại pos = 2
      const r = results.find(x => x.repairedFromIndex === 2);
      expect(r).toBeDefined();
      // affectedSlotIds should contain IDs from index 2 to end of repaired plan
      expect(r?.affectedSlotIds.length).toBe(4); // new slot + s2 + s3 + s4
      expect(r?.affectedSlotIds).toContain(r.newPlan[2].slotId);
      expect(r?.affectedSlotIds).toContain(r.newPlan[3].slotId);
      expect(r?.affectedSlotIds).toContain(r.newPlan[4].slotId);
      expect(r?.affectedSlotIds).toContain(r.newPlan[5].slotId);
    });

    it('TC5.3: Immutability của dữ liệu gốc', () => {
      const slot = makeSlot({ slotId: 'orig', dayIndex: 0, slotOrder: 0 });
      const plan = [slot];
      const ctx = makeCtx([PLACE_1, PLACE_3]);
      
      ops.insertAlt(plan, ctx);
      
      expect(slot.dayIndex).toBe(0);
      expect(slot.slotOrder).toBe(0);
      expect(plan[0]).toBe(slot);
    });
  });
});
