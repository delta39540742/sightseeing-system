import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectiveScorer, type BeamSearchContext } from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationResult } from '../src/replanner/MutationOperators';
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
    slotId: 'slot-001',
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    version: 1,
    placeId: 1,
    plannedStart: '2026-04-21T02:00:00.000Z',
    plannedEnd: '2026-04-21T03:00:00.000Z',
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
    timeRemainingMin: 720,
    budgetRemaining: 5_000_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-21T01:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makeUser(preferenceVector = new Array(10).fill(0)): UserPreference {
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

const ZERO_WEIGHTS: ObjectiveWeights = {
  wInterest: 0,
  wPace: 0,
  wDistance: 0,
  wBudget: 0,
  wWeather: 0,
  wRisk: 0,
  wStability: 0,
  wPotentialBias: 0,
  wProximity: 0,
};

function makeCtx(overrides: Partial<BeamSearchContext> = {}): BeamSearchContext {
  return {
    candidatePool: [],
    user: makeUser(),
    weatherForecast: [],
    defaultWeather: { rainMmPerH: 0 },
    initialState: makeState(),
    remainingSlots: [],
    weights: ZERO_WEIGHTS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ObjectiveScorer', () => {
  let evolver: StateEvolver;
  let scorer: ObjectiveScorer;

  beforeEach(() => {
    evolver = new StateEvolver();
    scorer = new ObjectiveScorer(evolver);
  });

  // 1. Nhóm Test Cơ Bản & Trường Hợp Biên (Edge Cases)
  describe('1. Basic & Edge Cases', () => {
    it('handles Empty Plan correctly: paceFit = 1, others = 0', () => {
      const weights: ObjectiveWeights = { ...ZERO_WEIGHTS, wPace: 1, wInterest: 1 };
      const ctx = makeCtx({ weights });
      const score = scorer.score([], [makeState()], weights, ctx);
      expect(score).toBe(1.0);
    });

    it('skips slot safely when Place is missing from Candidate Pool', () => {
      const weights: ObjectiveWeights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const ctx = makeCtx({ candidatePool: [], weights });
      const plan = [makeSlot({ placeId: 999 })];
      const states = [makeState(), makeState()];
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(0);
    });

    it('skips slot safely when stateAfter is missing (length mismatch)', () => {
      const weights: ObjectiveWeights = { ...ZERO_WEIGHTS, wRisk: 1 };
      const place = makePlace({ placeId: 10 });
      const ctx = makeCtx({ candidatePool: [place], weights });
      const plan = [makeSlot({ placeId: 10 })];
      const states = [makeState()]; 
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(0);
    });

    it('returns 0 travel time (no penalty) when coordinates are missing', () => {
      const weights: ObjectiveWeights = { ...ZERO_WEIGHTS, wDistance: 1 };
      const place = makePlace({ placeId: 10, lat: 16, lng: 108 });
      const ctx = makeCtx({ candidatePool: [place], weights });
      const plan = [makeSlot({ placeId: 10 })];
      const states = [
        makeState({ currentLat: null as any, currentLng: undefined as any }),
        makeState(),
      ];
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(0);
    });

    it('handles Tag Deduplication: identical tags are not counted twice', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(2), makeTag(2)] });
      const prefVec = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(prefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(1.0);
    });

    it('handles Out-of-bounds Tags: tagIds outside 1-10 are ignored', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(0), makeTag(11), makeTag(-1)] });
      const prefVec = new Array(10).fill(1);
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(prefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(0);
    });

    it('handles Vector Length Mismatch safely in dot product', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(1)] });
      const shortPrefVec = [1, 1, 1, 1, 1]; 
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(shortPrefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(1.0);
    });
  });

  // 2. Nhóm Test Thành Phần: Interest (Sở thích)
  describe('2. Interest Component', () => {
    it('calculates high interest for full tag match', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(1), makeTag(5)] });
      const prefVec = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(prefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(2.0);
    });

    it('calculates 0 interest for no tag match', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(2)] });
      const prefVec = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(prefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(0);
    });

    it('multiplies interest by weights.wInterest', () => {
      const place = makePlace({ placeId: 10, tags: [makeTag(1)] });
      const prefVec = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const ctx = makeCtx({ candidatePool: [place], user: makeUser(prefVec) });
      const weights = { ...ZERO_WEIGHTS, wInterest: 5 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(5.0);
    });
  });

  // 3. Nhóm Test Thành Phần: Distance (Khoảng cách)
  describe('3. Distance Component', () => {
    it('penalizes travel time in hours', () => {
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(120);
      const place = makePlace({ placeId: 10 });
      const ctx = makeCtx({ candidatePool: [place] });
      const weights = { ...ZERO_WEIGHTS, wDistance: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(-2.0);
    });
  });

  // 4. Nhóm Test Thành Phần: Budget (Ngân sách)
  describe('4. Budget Component', () => {
    it('applies no penalty when budget is surplus or exactly 0', () => {
      const place = makePlace({ placeId: 10 });
      const ctx = makeCtx({ candidatePool: [place] });
      const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
      const scoreSurplus = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState({ budgetRemaining: 100 })], weights, ctx);
      expect(scoreSurplus).toBe(0);
    });

    it('penalizes budget deficit with hard cliff: -(10000 + |r|×0.1)', () => {
      const place = makePlace({ placeId: 10 });
      const ctx = makeCtx({ candidatePool: [place] });
      const weights = { ...ZERO_WEIGHTS, wBudget: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState({ budgetRemaining: -0.1 })], weights, ctx);
      // formula: -(10000 + 0.1 * 0.1) = -10000.01
      expect(score).toBeCloseTo(-10000.01, 5);
    });
  });

  // 5. Nhóm Test Thành Phần: Weather (Thời tiết)
  describe('5. Weather Component', () => {
    it('handles Short Weather Forecast: missing forecast elements are treated as 0 rain', () => {
      const indoorPlace = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const ctx = makeCtx({ 
        candidatePool: [indoorPlace], 
        weatherForecast: [{ rainMmPerH: 10 }] 
      });
      const plan = [makeSlot({ placeId: 10, dayIndex: 0 }), makeSlot({ placeId: 10, dayIndex: 1 })];
      const states = [makeState(), makeState(), makeState()];
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(1);
    });

    it('rewards indoor place during heavy rain', () => {
      const place = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(1);
    });

    it('penalizes outdoor place during heavy rain', () => {
      const place = makePlace({ placeId: 10, indoorOutdoor: 'outdoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(-1);
    });

    it('remains neutral if indoorOutdoor is invalid string', () => {
      const place = makePlace({ placeId: 10, indoorOutdoor: 'both' as any });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(0);
    });
  });

  // 5b. Rain transit penalty
  describe('5b. Rain Transit Penalty', () => {
    it('no transit penalty when rain < 5mm/h', () => {
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(30);
      const place = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 4 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      // No rain → no transit penalty, no indoor reward
      expect(score).toBe(0);
    });

    it('penalizes 30 min transit in rain by -1 on top of indoor reward', () => {
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(30);
      const place = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      // +1 (indoor) - 30/30 (transit) = 0
      expect(score).toBe(0);
    });

    it('penalizes 60 min transit in rain by -2; net = -1 even for indoor destination', () => {
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(60);
      const place = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      // +1 (indoor) - 60/30 (transit) = -1
      expect(score).toBe(-1);
    });

    it('nearby indoor place (5 min transit) still scores positive', () => {
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(5);
      const place = makePlace({ placeId: 10, indoorOutdoor: 'indoor' });
      const ctx = makeCtx({ candidatePool: [place], weatherForecast: [{ rainMmPerH: 10 }] });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      // +1 - 5/30 ≈ 0.833
      expect(score).toBeCloseTo(0.833, 3);
    });

    it('nearby indoor scores better than far indoor in rain (proximity matters)', () => {
      const placeNear = makePlace({ placeId: 10, indoorOutdoor: 'indoor', lat: 16.06, lng: 108.22 });
      const placeFar  = makePlace({ placeId: 11, indoorOutdoor: 'indoor', lat: 16.20, lng: 108.40 });
      const ctx = makeCtx({
        candidatePool: [placeNear, placeFar],
        weatherForecast: [{ rainMmPerH: 10 }],
        initialState: makeState({ currentLat: 16.0614, currentLng: 108.2273 }),
      });
      const weights = { ...ZERO_WEIGHTS, wWeather: 1 };
      const stateNear = [makeState(), makeState()];
      const stateFar  = [makeState(), makeState()];
      const slotNear  = makeSlot({ placeId: 10 });
      const slotFar   = makeSlot({ placeId: 11 });
      const scoreNear = scorer.score([slotNear], stateNear, weights, ctx);
      const scoreFar  = scorer.score([slotFar],  stateFar,  weights, ctx);
      // Nearby indoor should score higher (less rain transit penalty)
      expect(scoreNear).toBeGreaterThan(scoreFar);
    });
  });

  // 6. Nhóm Test Thành Phần: Risk (Độ mỏi/Rủi ro)
  describe('6. Risk Component', () => {
    it('penalizes accumulated fatigue', () => {
      const place = makePlace({ placeId: 10 });
      const ctx = makeCtx({ candidatePool: [place] });
      const weights = { ...ZERO_WEIGHTS, wRisk: 1 };
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState({ fatigue: 0.8 })], weights, ctx);
      expect(score).toBe(-0.8);
    });

    it('rewards negative fatigue (Negative Risk behavior)', () => {
      const weights = { ...ZERO_WEIGHTS, wRisk: 1 };
      const ctx = makeCtx({ candidatePool: [makePlace({ placeId: 10 })] });
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState({ fatigue: -10 })], weights, ctx);
      expect(score).toBe(10);
    });
  });

  // 7. Nhóm Test Thành Phần: Potential & Required Bias (Ưu tiên địa điểm)
  describe('7. Bias Component', () => {
    it('adds bonus for Potential Place', () => {
      const weights = { ...ZERO_WEIGHTS, wPotentialBias: 1 };
      const ctx = makeCtx({ potentialPlaceIds: [10], candidatePool: [makePlace({ placeId: 10 })] });
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(0.75);
    });

    it('adds bonus for Required Place', () => {
      const weights = { ...ZERO_WEIGHTS, wPotentialBias: 1 };
      const ctx = makeCtx({ requiredPlaceIds: [20], candidatePool: [makePlace({ placeId: 20 })] });
      const score = scorer.score([makeSlot({ placeId: 20 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(1.25);
    });

    it('adds both bonuses if placeId is in both lists (Bias Overlap)', () => {
      const weights = { ...ZERO_WEIGHTS, wPotentialBias: 1 };
      const ctx = makeCtx({ 
        potentialPlaceIds: [10], 
        requiredPlaceIds: [10],
        candidatePool: [makePlace({ placeId: 10 })] 
      });
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(2.0);
    });

    it('handles missing bias lists safely', () => {
      const weights = { ...ZERO_WEIGHTS, wPotentialBias: 1 };
      const ctx = makeCtx({ potentialPlaceIds: undefined, requiredPlaceIds: undefined });
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(0);
    });
  });

  // 8. Nhóm Test Thành Phần: Pace Fit (Tốc độ lịch trình)
  describe('8. Pace Fit Component', () => {
    const weights = { ...ZERO_WEIGHTS, wPace: 1 };

    it('perfect match for Slow Pace (0) -> 3 slots/day', () => {
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = 0; 
      const plan = [makeSlot({ dayIndex: 0, placeId: 1 }), makeSlot({ dayIndex: 0, placeId: 1 }), makeSlot({ dayIndex: 0, placeId: 1 })];
      const score = scorer.score(plan, new Array(4).fill(makeState()), weights, ctx);
      expect(score).toBe(1.0);
    });

    it('perfect match for Fast Pace (1) -> 7 slots/day', () => {
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = 1; 
      const plan = new Array(7).fill(0).map(() => makeSlot({ dayIndex: 0, placeId: 1 }));
      const score = scorer.score(plan, new Array(8).fill(makeState()), weights, ctx);
      expect(score).toBe(1.0);
    });

    it('calculates mismatch: high density leads to negative Pace Fit', () => {
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = 0; 
      const plan = new Array(15).fill(0).map(() => makeSlot({ dayIndex: 0, placeId: 1 }));
      const score = scorer.score(plan, new Array(16).fill(makeState()), weights, ctx);
      expect(score).toBe(-2);
    });

    it('handles multi-day distribution correctly', () => {
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = 0.5; 
      const plan = [
        makeSlot({ dayIndex: 0, placeId: 1 }), 
        makeSlot({ dayIndex: 1, placeId: 1 }), 
        makeSlot({ dayIndex: 1, placeId: 1 }),
        makeSlot({ dayIndex: 1, placeId: 1 }),
      ];
      const score = scorer.score(plan, new Array(5).fill(makeState()), weights, ctx);
      expect(score).toBe(0.25);
    });
  });

  // 9. Nhóm Test Thành Phần: Stability (Tính ổn định)
  describe('9. Stability Component', () => {
    it('returns 0 stability penalty if history is empty or not provided', () => {
      const weights = { ...ZERO_WEIGHTS, wStability: 1 };
      const ctx = makeCtx();
      expect(scorer.score([], [makeState()], weights, ctx)).toBe(0);
      expect(scorer.score([], [makeState()], weights, ctx, [])).toBe(0);
    });

    it('deduplicates affectedSlotIds within a single mutation', () => {
      const weights = { ...ZERO_WEIGHTS, wStability: 1 };
      const ctx = makeCtx();
      const history: MutationResult[] = [
        { operator: 'ADD_PLACE', affectedSlotIds: ['s1', 's1', 's2'], newPlan: [], description: '' },
      ];
      const score = scorer.score([], [makeState()], weights, ctx, history);
      expect(score).toBe(-2);
    });

    it('deduplicates the same slot appearing across different mutations', () => {
      // s1 appears in two separate mutations but should be counted only once globally.
      // countChanges uses a single Set across the full history (not a sum of per-mutation Sets).
      const weights = { ...ZERO_WEIGHTS, wStability: 1 };
      const ctx = makeCtx();
      const history: MutationResult[] = [
        { operator: 'ADD_PLACE', affectedSlotIds: ['s1'], newPlan: [], description: '' },
        { operator: 'REPLACE_PLACE', affectedSlotIds: ['s1'], newPlan: [], description: '' },
      ];
      const score = scorer.score([], [makeState()], weights, ctx, history);
      expect(score).toBe(-1);
    });
  });

  // 10. Isolation Testing (Weight 0 technique)
  describe('10. Isolation Testing (Zero Weight leak check)', () => {
    it('ensures term value does not leak when weight is 0', () => {
      const indoorPlace = makePlace({ placeId: 10, tags: [makeTag(1)], indoorOutdoor: 'indoor' });
      const complexCtx = makeCtx({
        candidatePool: [indoorPlace],
        user: makeUser([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 
        weatherForecast: [{ rainMmPerH: 10 }], 
        potentialPlaceIds: [10],
      });
      const complexPlan = [makeSlot({ placeId: 10 })];
      const complexStates = [makeState(), makeState({ fatigue: 1.0, budgetRemaining: -1000 })];
      const complexHistory = [{ operator: 'ADD_PLACE', affectedSlotIds: ['s1'], newPlan: [], description: '' }];

      // fatigue=1.0 > 0.95 → hard penalty: -(1.0) - (10000 + 0.05*100000) = -15001
      // budgetRemaining=-1000 → hard penalty: -(10000 + 1000*0.1) = -10100
      const terms = [
        { weight: 'wInterest', expected: 1.0 },
        { weight: 'wWeather', expected: 1.0 },
        { weight: 'wRisk', expected: -15001.0 },
        { weight: 'wBudget', expected: -10100.0 },
        { weight: 'wStability', expected: -1.0 },
        { weight: 'wPotentialBias', expected: 0.75 },
      ] as const;

      for (const t of terms) {
        const weights = { ...ZERO_WEIGHTS, [t.weight]: 1 };
        const score = scorer.score(complexPlan, complexStates, weights, complexCtx, complexHistory);
        expect(score).toBeCloseTo(t.expected, 5);
      }
    });
  });

  // 11. Array Length Mismatches & Holes
  describe('11. Array Mismatches & Holes', () => {
    it('handles Trajectory (States) missing in the middle (undefined holes)', () => {
      const weights = { ...ZERO_WEIGHTS, wRisk: 1 };
      const ctx = makeCtx({ candidatePool: [makePlace({ placeId: 1 })] });
      const plan = [makeSlot({ placeId: 1 }), makeSlot({ placeId: 1 })];
      const states = [makeState(), undefined as any, makeState({ fatigue: 0.5 })];
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(-0.5);
    });
  });

  // 12. Phơi bày lỗ hổng Runtime (Runtime Exceptions)
  describe('12. Runtime Exceptions & Robustness', () => {
    it('ROBUSTNESS TEST: does not crash if place.tags is null or undefined at runtime', () => {
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const placeMissingTags = makePlace({ placeId: 10 }) as any;
      delete placeMissingTags.tags; 
      
      const ctx = makeCtx({ candidatePool: [placeMissingTags], user: makeUser(new Array(10).fill(1)) });
      const plan = [makeSlot({ placeId: 10 })];
      const states = [makeState(), makeState()];

      expect(() => scorer.score(plan, states, weights, ctx)).not.toThrow();
      expect(scorer.score(plan, states, weights, ctx)).toBe(0);
    });

    it('NaN Propagation: check if score becomes NaN when inputs are NaN', () => {
      const weights = { ...ZERO_WEIGHTS, wPace: 1, wBudget: 1, wRisk: 1 };
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = NaN; 

      const plan = [makeSlot({ placeId: 1 })];
      const states = [
        makeState(),
        makeState({ budgetRemaining: NaN, fatigue: NaN })
      ];

      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBeNaN();
    });
  });

  // 13. Hành vi Lặp lại & Ghi đè (Repetition & Overlapping)
  describe('13. Repetition & Overlapping', () => {
    it('Duplicate Visits: awards bias points multiple times for the same placeId', () => {
      const weights = { ...ZERO_WEIGHTS, wPotentialBias: 1 };
      const ctx = makeCtx({ 
        requiredPlaceIds: [10],
        candidatePool: [makePlace({ placeId: 10 })] 
      });
      const plan = [makeSlot({ placeId: 10 }), makeSlot({ placeId: 10 })];
      const states = new Array(3).fill(makeState());
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(2.5);
    });

    it('Duplicate Visits: interest points are also awarded multiple times', () => {
      const weights = { ...ZERO_WEIGHTS, wInterest: 1 };
      const place = makePlace({ placeId: 10, tags: [makeTag(1)] });
      const ctx = makeCtx({ candidatePool: [place], user: makeUser([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
      const plan = [makeSlot({ placeId: 10 }), makeSlot({ placeId: 10 })];
      const states = [makeState(), makeState(), makeState()];
      const score = scorer.score(plan, states, weights, ctx);
      expect(score).toBe(2.0);
    });
  });

  // 14. Lỗ hổng Logic Tính Toán Pace Fit
  describe('14. Pace Fit Logic Flaws', () => {
    it('Sparse Days: paceFit ignores large gaps between active days', () => {
      const weights = { ...ZERO_WEIGHTS, wPace: 1 };
      const ctx = makeCtx({ user: makeUser() });
      ctx.user.pace = 0.5;

      const planA = [makeSlot({ dayIndex: 0, placeId: 1 }), makeSlot({ dayIndex: 1, placeId: 1 })];
      const scoreA = scorer.score(planA, new Array(3).fill(makeState()), weights, ctx);

      const planB = [makeSlot({ dayIndex: 0, placeId: 1 }), makeSlot({ dayIndex: 10, placeId: 1 })];
      const scoreB = scorer.score(planB, new Array(3).fill(makeState()), weights, ctx);

      expect(scoreA).toBe(scoreB);
    });
  });

  // 15. Kiểm thử Tính Bất biến (Immutability Testing)
  describe('15. Immutability Testing', () => {
    it('does not mutate input objects during scoring', () => {
      const weights: ObjectiveWeights = { ...ZERO_WEIGHTS, wInterest: 1, wPace: 1, wDistance: 1 };
      const ctx = makeCtx({
        candidatePool: [makePlace({ placeId: 10 })],
        user: makeUser([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      });
      const plan = [makeSlot({ placeId: 10 })];
      const states = [makeState(), makeState()];
      const history: MutationResult[] = [{ operator: 'ADD_PLACE', affectedSlotIds: ['s1'], newPlan: [], description: '' }];

      Object.freeze(weights);
      Object.freeze(ctx);
      Object.freeze(ctx.user);
      Object.freeze(ctx.candidatePool);
      Object.freeze(plan);
      Object.freeze(plan[0]);
      Object.freeze(states);
      Object.freeze(states[0]);
      Object.freeze(history);
      Object.freeze(history[0]);

      expect(() => scorer.score(plan, states, weights, ctx, history)).not.toThrow();
    });
  });

  // 16. Giới hạn Cực đoan (Extremes & Limits)
  describe('16. Extremes & Limits', () => {
    it('Performance: handles huge mutation history efficiently', () => {
      const weights = { ...ZERO_WEIGHTS, wStability: 1 };
      const ctx = makeCtx();
      const hugeHistory: MutationResult[] = [];
      for (let i = 0; i < 5000; i++) {
        hugeHistory.push({
          operator: 'REPLACE_PLACE',
          affectedSlotIds: Array.from({ length: 50 }, (_, k) => `s-${i}-${k}`),
          newPlan: [],
          description: ''
        });
      }
      const start = performance.now();
      const score = scorer.score([], [makeState()], weights, ctx, hugeHistory);
      const end = performance.now();
      expect(score).toBe(-250_000);
      expect(end - start).toBeLessThan(500); 
    });

    it('Negative Weights: reverses penalty/reward behavior', () => {
      const weights = { ...ZERO_WEIGHTS, wDistance: -1 }; 
      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(60); 
      const ctx = makeCtx({ candidatePool: [makePlace({ placeId: 10 })] });
      const score = scorer.score([makeSlot({ placeId: 10 })], [makeState(), makeState()], weights, ctx);
      expect(score).toBe(1.0);
    });
  });

  // 17. Destructuring & Tham chiếu mặc định
  describe('17. Defaults & Destructuring', () => {
    it('handles explicit undefined history by falling back to []', () => {
      const weights = { ...ZERO_WEIGHTS, wStability: 1 };
      const ctx = makeCtx();
      const score = scorer.score([], [makeState()], weights, ctx, undefined);
      expect(score).toBe(0);
    });
  });

  // 18. Full Integration (Final check)
  describe('18. Full Integration', () => {
    it('calculates final score correctly for a complex scenario', () => {
      const indoorPlace = makePlace({ placeId: 10, tags: [makeTag(1)], indoorOutdoor: 'indoor' });
      const ctx = makeCtx({
        candidatePool: [indoorPlace],
        user: makeUser([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 
        weatherForecast: [{ rainMmPerH: 10 }], 
        potentialPlaceIds: [10],
      });
      ctx.user.pace = 0.5;

      const weights: ObjectiveWeights = {
        wInterest: 1, wPace: 1, wDistance: 1, wBudget: 1,
        wWeather: 1, wRisk: 1, wStability: 1, wPotentialBias: 1, wProximity: 0,
      };

      vi.spyOn(evolver, 'estimateTravelTime').mockReturnValue(60); 

      const plan = [makeSlot({ placeId: 10, dayIndex: 0 })];
      const states = [
        makeState({ currentLat: 16, currentLng: 108 }),
        makeState({ budgetRemaining: -2000, fatigue: 0.5 }), 
      ];
      
      const history: MutationResult[] = [{
        operator: 'ADD_PLACE', affectedSlotIds: ['s1'], newPlan: [], description: '',
      }];

      const score = scorer.score(plan, states, weights, ctx, history);
      // interest=1, pace=0, distance=-1, budget=-(10000+200)=-10200,
      // weather=+1-2=-1, risk=-0.5, stability=-1, potentialBias=+0.75
      // total = 1+0-1-10200-1-0.5-1+0.75 = -10201.75
      expect(score).toBe(-10201.75);
    });
  });
});
