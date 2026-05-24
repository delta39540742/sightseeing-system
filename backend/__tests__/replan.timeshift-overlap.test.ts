/**
 * replan.timeshift-overlap.test.ts
 *
 * Kiểm tra xem TIME_SHIFT backward (-60 min) có tạo ra plan với
 * 2 slot trùng giờ nhau hay không.
 *
 * S0_1 kết thúc lúc 03:00 UTC. S0_2 bắt đầu lúc 03:30 UTC (gap = 30 min).
 * TIME_SHIFT -60 trên S0_2 → S0_2 bắt đầu lúc 02:30 UTC.
 * 02:30 < 03:00 → OVERLAP với S0_1.
 *
 * Engine phải detect và reject plan này.
 * Hiện tại engine không làm vậy (repairSuffix chỉ sửa từ i+1, không kiểm tra i với i-1).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BeamSearchContext } from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference, ObjectiveWeights } from '@app/types';

function allDayHours(open: string, close: string) {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d, openTime: open, closeTime: close,
  }));
}

const MY_AN_BEACH: Place = {
  placeId: 2_221_547, name: 'My An Beach',
  lat: 16.025095, lng: 108.259534,
  avgVisitDurationMin: 120, indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const THUY_SON: Place = {
  placeId: 2_221_538, name: 'Thuy Son',
  lat: 16.004304, lng: 108.263527,
  avgVisitDurationMin: 120, indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const LANG_DA_MY_NGHE: Place = {
  placeId: 2_221_542, name: 'Lang da my nghe',
  lat: 16.000952, lng: 108.266643,
  avgVisitDurationMin: 120, indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '17:00'),
};

const LANG_BICH_HOA: Place = {
  placeId: 2_221_530, name: 'Lang Bich Hoa',
  lat: 16.060710, lng: 108.220025,
  avgVisitDurationMin: 120, indoorOutdoor: 'indoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 7 }, { tagId: 10 }],
  openingHours: allDayHours('08:00', '18:00'),
};

const BAI_BIEN_SON_TRA: Place = {
  placeId: 2_221_548, name: 'Bai Bien Son Tra',
  lat: 16.099021, lng: 108.254985,
  avgVisitDurationMin: 120, indoorOutdoor: 'outdoor',
  minPrice: 0, estimatedCost: 0,
  tags: [{ tagId: 1 }, { tagId: 8 }],
  openingHours: allDayHours('00:00', '23:59'),
};

const ALL_PLACES = [MY_AN_BEACH, THUY_SON, LANG_DA_MY_NGHE, LANG_BICH_HOA, BAI_BIEN_SON_TRA];

const TRIP_ID = 'bug-test-trip-id';

function makeSlot(overrides: Partial<TripSlot> & Pick<TripSlot, 'slotId' | 'slotOrder' | 'placeId' | 'plannedStart' | 'plannedEnd'>): TripSlot {
  return {
    tripId: TRIP_ID, dayIndex: 0, version: 1,
    actualStart: null, actualEnd: null, estimatedCost: 0,
    activityType: 'sightseeing', rationale: null,
    status: 'planned', isLocked: false,
    ...overrides,
  };
}

// 5 slots ngay 0: 08:00-10:00, 10:30-12:30, 13:00-15:00, 15:30-17:30, 18:00-20:00 VN
// = UTC: 01:00-03:00, 03:30-05:30, 06:00-08:00, 08:30-10:30, 11:00-13:00
const S0_1 = makeSlot({ slotId: 's1', slotOrder: 1, placeId: MY_AN_BEACH.placeId,     plannedStart: '2026-05-23T01:00:00.000Z', plannedEnd: '2026-05-23T03:00:00.000Z' });
const S0_2 = makeSlot({ slotId: 's2', slotOrder: 2, placeId: THUY_SON.placeId,        plannedStart: '2026-05-23T03:30:00.000Z', plannedEnd: '2026-05-23T05:30:00.000Z' });
const S0_3 = makeSlot({ slotId: 's3', slotOrder: 3, placeId: LANG_DA_MY_NGHE.placeId, plannedStart: '2026-05-23T06:00:00.000Z', plannedEnd: '2026-05-23T08:00:00.000Z' });
const S0_4 = makeSlot({ slotId: 's4', slotOrder: 4, placeId: LANG_BICH_HOA.placeId,   plannedStart: '2026-05-23T08:30:00.000Z', plannedEnd: '2026-05-23T10:30:00.000Z' });
const S0_5 = makeSlot({ slotId: 's5', slotOrder: 5, placeId: BAI_BIEN_SON_TRA.placeId, plannedStart: '2026-05-23T11:00:00.000Z', plannedEnd: '2026-05-23T13:00:00.000Z' });

const DAY0_SLOTS = [S0_1, S0_2, S0_3, S0_4, S0_5];

const INITIAL_STATE: TripState = {
  tripId: TRIP_ID, dayIndex: 0, slotOrder: 0,
  timeRemainingMin: 720, budgetRemaining: 3_000_000, fatigue: 0,
  currentLat: 16.0544, currentLng: 108.2022, moodProxy: 0.8,
  capturedAt: '2026-05-23T01:00:00.000Z', source: 'simulated',
};

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

let evolver: StateEvolver;
let operators: MutationOperators;

beforeEach(() => {
  clearSetFeasibilityCache();
  evolver = new StateEvolver();
  operators = new MutationOperators(evolver);
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-23T01:00:00.000Z').getTime());
});

afterEach(() => { vi.restoreAllMocks(); });

describe('GROUP 10 — TIME_SHIFT overlap regression', () => {

  it('TC10.1 — timeShift khong tra ve plan nao co slot overlap cung ngay', () => {
    // S0_2 starts at 03:30 UTC. S0_1 ends at 03:00 UTC. Gap = 30 min.
    // TIME_SHIFT -60 tren S0_2 → starts at 02:30 UTC → OVERLAP voi S0_1 (03:00 UTC).
    // Engine PHAI reject mutation nay.
    const ctx: BeamSearchContext = {
      remainingSlots: DAY0_SLOTS,
      initialState: INITIAL_STATE,
      candidatePool: ALL_PLACES,
      user: NEUTRAL_USER,
      weights: DEFAULT_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    };

    const mutations = operators.timeShift(DAY0_SLOTS, ctx);

    let foundOverlap = false;
    let overlapDetail = '';

    for (const m of mutations) {
      const byDay = new Map<number, TripSlot[]>();
      for (const s of m.newPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s);
      }
      for (const [day, slots] of byDay) {
        const sorted = [...slots].sort((a, b) =>
          new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
        );
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd  = new Date(sorted[i - 1]!.plannedEnd).getTime();
          const curStart = new Date(sorted[i]!.plannedStart).getTime();
          if (curStart < prevEnd) {
            foundOverlap = true;
            overlapDetail = `Ngay ${day}: slot "${sorted[i]!.slotId}" bat dau ${sorted[i]!.plannedStart} truoc khi slot "${sorted[i - 1]!.slotId}" ket thuc ${sorted[i - 1]!.plannedEnd}`;
          }
        }
      }
    }

    expect(
      foundOverlap,
      `TIME_SHIFT khong duoc tra ve plan co slot trung gio — ${overlapDetail}`
    ).toBe(false);
  });

  it('TC10.2 — Xac nhan dieu kien bug: THUY_SON mo cua luc 09:30 VN → withinOpeningHours pass', () => {
    // Day la dieu kien khien bug xuat hien: vi opening hours check pass,
    // engine khong reject shift -60 tren S0_2, du tao overlap voi S0_1.
    const s0_2_shifted_startMs = new Date('2026-05-23T02:30:00.000Z').getTime(); // 09:30 VN
    const s0_1_endMs           = new Date('2026-05-23T03:00:00.000Z').getTime(); // 10:00 VN

    // Xac nhan overlap ton tai
    expect(s0_2_shifted_startMs).toBeLessThan(s0_1_endMs);

    // Xac nhan THUY_SON mo cua vao 09:30 VN
    const vnHour = 9.5;
    const thuyson_open  = 8;
    const thuyson_close = 18;
    expect(
      vnHour >= thuyson_open && vnHour + 2 <= thuyson_close,
      'THUY_SON phai mo cua tu 08:00-18:00 VN, cover duoc slot 09:30-11:30 VN'
    ).toBe(true);
  });

  it('TC10.3 — backward shift tren S0_2: tat ca output phai bat dau SAU S0_1 ket thuc', () => {
    const ctx: BeamSearchContext = {
      remainingSlots: DAY0_SLOTS,
      initialState: INITIAL_STATE,
      candidatePool: ALL_PLACES,
      user: NEUTRAL_USER,
      weights: DEFAULT_WEIGHTS,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      placeMap: new Map(ALL_PLACES.map(p => [p.placeId, p])),
    };

    const mutations = operators.timeShift(DAY0_SLOTS, ctx);

    // Lay cac mutation co shift S0_2 ve truoc
    const s0_2_backwardShifts = mutations.filter(m => {
      const s2 = m.newPlan.find(s => s.slotId === S0_2.slotId);
      if (!s2) return false;
      return new Date(s2.plannedStart).getTime() < new Date(S0_2.plannedStart).getTime();
    });

    for (const m of s0_2_backwardShifts) {
      const s1 = m.newPlan.find(s => s.slotId === S0_1.slotId)!;
      const s2 = m.newPlan.find(s => s.slotId === S0_2.slotId)!;

      const s1EndMs   = new Date(s1.plannedEnd).getTime();
      const s2StartMs = new Date(s2.plannedStart).getTime();

      expect(
        s2StartMs,
        `S0_2 shifted to ${s2.plannedStart} phai >= S0_1 end ${s1.plannedEnd}`
      ).toBeGreaterThanOrEqual(s1EndMs);
    }
  });
});
