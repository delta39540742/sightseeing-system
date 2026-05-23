/**
 * Scenario Generator — Tạo các scenario benchmark đa dạng.
 *
 * Mỗi scenario mô phỏng một tình huống replan thực tế tại Đà Nẵng,
 * với các mức độ khó khác nhau để stress-test engine.
 */

import {
  BenchmarkScenario,
  TripSlot,
  TripState,
  PlaceCandidate,
  WeatherForecast,
  UserPreferences,
  ScenarioCategory,
} from './types';

// ─────────────────────────────────────────────────────────
// PLACE DATABASE — Mô phỏng Đà Nẵng
// ─────────────────────────────────────────────────────────

const DA_NANG_PLACES: PlaceCandidate[] = [
  // Sightseeing
  { placeId: 1,  name: 'Cầu Rồng',              lat: 16.0611, lng: 108.2278, tags: [1,0,0,0,1,0], avgVisitDurationMin: 45,  estimatedCost: 0,      activityType: 'sightseeing', openingHour: 0,  closingHour: 24 },
  { placeId: 2,  name: 'Bà Nà Hills',            lat: 15.9977, lng: 107.9875, tags: [1,0,0,1,0,0], avgVisitDurationMin: 240, estimatedCost: 900000, activityType: 'sightseeing', openingHour: 7,  closingHour: 22 },
  { placeId: 3,  name: 'Ngũ Hành Sơn',           lat: 16.0044, lng: 108.2631, tags: [1,0,1,0,0,0], avgVisitDurationMin: 120, estimatedCost: 40000,  activityType: 'sightseeing', openingHour: 7,  closingHour: 17 },
  { placeId: 4,  name: 'Bảo tàng Chăm',          lat: 16.0604, lng: 108.2241, tags: [0,1,0,0,0,0], avgVisitDurationMin: 90,  estimatedCost: 60000,  activityType: 'sightseeing', openingHour: 7,  closingHour: 17 },
  { placeId: 5,  name: 'Chùa Linh Ứng',          lat: 16.1001, lng: 108.2772, tags: [0,1,1,0,0,0], avgVisitDurationMin: 60,  estimatedCost: 0,      activityType: 'sightseeing', openingHour: 6,  closingHour: 18 },
  { placeId: 6,  name: 'Bãi biển Mỹ Khê',        lat: 16.0471, lng: 108.2460, tags: [0,0,0,0,1,1], avgVisitDurationMin: 90,  estimatedCost: 0,      activityType: 'activity',    openingHour: 5,  closingHour: 22 },
  { placeId: 7,  name: 'Cầu Tình Yêu',           lat: 16.0608, lng: 108.2272, tags: [1,0,0,0,1,0], avgVisitDurationMin: 30,  estimatedCost: 0,      activityType: 'sightseeing', openingHour: 0,  closingHour: 24 },
  { placeId: 8,  name: 'Công viên Châu Á',        lat: 16.0390, lng: 108.2271, tags: [0,0,0,1,0,1], avgVisitDurationMin: 180, estimatedCost: 200000, activityType: 'activity',    openingHour: 15, closingHour: 22 },
  { placeId: 9,  name: 'Bãi biển Non Nước',       lat: 15.9933, lng: 108.2681, tags: [0,0,0,0,1,1], avgVisitDurationMin: 90,  estimatedCost: 0,      activityType: 'activity',    openingHour: 5,  closingHour: 22 },
  { placeId: 10, name: 'Cầu Thuận Phước',         lat: 16.0856, lng: 108.2142, tags: [1,0,0,0,1,0], avgVisitDurationMin: 30,  estimatedCost: 0,      activityType: 'sightseeing', openingHour: 0,  closingHour: 24 },

  // Meals
  { placeId: 101, name: 'Mì Quảng Bà Mua',       lat: 16.0600, lng: 108.2100, tags: [0,0,0,0,0,0], avgVisitDurationMin: 45, estimatedCost: 50000,   activityType: 'meal', openingHour: 6,  closingHour: 21 },
  { placeId: 102, name: 'Bún chả cá Bà Liên',    lat: 16.0680, lng: 108.2200, tags: [0,0,0,0,0,0], avgVisitDurationMin: 40, estimatedCost: 45000,   activityType: 'meal', openingHour: 6,  closingHour: 14 },
  { placeId: 103, name: 'Hải sản Bé Mặn',        lat: 16.0550, lng: 108.2400, tags: [0,0,0,0,0,0], avgVisitDurationMin: 60, estimatedCost: 350000,  activityType: 'meal', openingHour: 10, closingHour: 22 },
  { placeId: 104, name: 'Bánh xèo Bà Dưỡng',     lat: 16.0700, lng: 108.2150, tags: [0,0,0,0,0,0], avgVisitDurationMin: 45, estimatedCost: 60000,   activityType: 'meal', openingHour: 10, closingHour: 21 },
  { placeId: 105, name: 'Cơm gà A Hải',          lat: 16.0630, lng: 108.2180, tags: [0,0,0,0,0,0], avgVisitDurationMin: 40, estimatedCost: 55000,   activityType: 'meal', openingHour: 10, closingHour: 21 },

  // Rest
  { placeId: 201, name: 'Cộng Cà Phê',           lat: 16.0590, lng: 108.2250, tags: [0,0,0,0,0,0], avgVisitDurationMin: 45, estimatedCost: 50000,   activityType: 'rest', openingHour: 7,  closingHour: 22 },
  { placeId: 202, name: '43 Factory Coffee',     lat: 16.0550, lng: 108.2300, tags: [0,0,0,0,0,0], avgVisitDurationMin: 50, estimatedCost: 65000,   activityType: 'rest', openingHour: 7,  closingHour: 23 },

  // Activity
  { placeId: 301, name: 'Lặn biển Sơn Trà',      lat: 16.1100, lng: 108.2700, tags: [0,0,0,1,0,1], avgVisitDurationMin: 150, estimatedCost: 800000, activityType: 'activity', openingHour: 7,  closingHour: 16 },
  { placeId: 302, name: 'Kayak sông Hàn',         lat: 16.0600, lng: 108.2260, tags: [0,0,0,1,0,1], avgVisitDurationMin: 90,  estimatedCost: 300000, activityType: 'activity', openingHour: 6,  closingHour: 17 },
  { placeId: 303, name: 'Chợ đêm Sơn Trà',       lat: 16.0670, lng: 108.2350, tags: [0,0,0,0,1,0], avgVisitDurationMin: 60,  estimatedCost: 100000, activityType: 'activity', openingHour: 18, closingHour: 23 },
];

// ─────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────

let _slotCounter = 0;
function makeSlotId(): string {
  return `slot-${String(++_slotCounter).padStart(4, '0')}`;
}

function isoTime(dayIndex: number, hour: number, minute: number = 0): string {
  // Base date: 2026-06-01 (giả định chuyến đi bắt đầu)
  const d = new Date(Date.UTC(2026, 5, 1 + dayIndex, hour, minute));
  return d.toISOString();
}

function makeSlot(overrides: Partial<TripSlot> & {
  placeId: number;
  dayIndex: number;
  slotOrder: number;
  startHour: number;
  startMinute?: number;
  durationMin: number;
  activityType: TripSlot['activityType'];
  cost: number;
}): TripSlot {
  const { placeId, dayIndex, slotOrder, startHour, startMinute = 0,
          durationMin, activityType, cost, ...rest } = overrides;

  const endMin = startHour * 60 + startMinute + durationMin;
  const endHour = Math.floor(endMin / 60);
  const endMinute = endMin % 60;

  return {
    slotId: makeSlotId(),
    tripId: 'trip-bench-001',
    dayIndex,
    slotOrder,
    placeId,
    plannedStart: isoTime(dayIndex, startHour, startMinute),
    plannedEnd: isoTime(dayIndex, endHour, endMinute),
    actualStart: null,
    actualEnd: null,
    estimatedCost: cost,
    activityType,
    status: 'planned',
    isLocked: false,
    version: 1,
    rationale: null,
    ...rest,
  };
}

function makeInitialState(overrides: Partial<TripState> = {}): TripState {
  return {
    timeRemainingMin: 600,
    budgetRemaining: 3000000,
    fatigue: 0.05,
    moodProxy: 0.7,
    currentLat: 16.0544,    // Trung tâm Đà Nẵng
    currentLng: 108.2022,
    dayIndex: 0,
    slotOrder: 0,
    capturedAt: isoTime(0, 8, 0),
    ...overrides,
  };
}

function makeWeather(days: number, pattern: 'clear' | 'mixed' | 'rainy'): WeatherForecast[] {
  return Array.from({ length: days }, (_, i) => {
    switch (pattern) {
      case 'clear':
        return { dayIndex: i, precipMmPerHour: 0, tempCelsius: 30, condition: 'clear' as const };
      case 'rainy':
        return { dayIndex: i, precipMmPerHour: 8, tempCelsius: 24, condition: 'rain' as const };
      case 'mixed':
        return {
          dayIndex: i,
          precipMmPerHour: i % 2 === 0 ? 0 : 6,
          tempCelsius: i % 2 === 0 ? 31 : 23,
          condition: (i % 2 === 0 ? 'clear' : 'rain') as 'clear' | 'rain',
        };
    }
  });
}

function defaultPreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    preferenceVector: [0.8, 0.5, 0.3, 0.6, 0.7, 0.4], // match tag length
    preferredPace: 4,
    budgetTotal: 3000000,
    fatigueThreshold: 0.95,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────
// SCENARIO DEFINITIONS
// ─────────────────────────────────────────────────────────

function S01_baseline_simple(): BenchmarkScenario {
  _slotCounter = 0;
  return {
    id: 'S01',
    name: 'Baseline — 1 ngày, 4 slots, đã gần optimal',
    description: 'Plan đơn giản, ít room for improvement. Kiểm tra engine không làm hỏng plan tốt.',
    category: 'baseline',
    difficulty: 'easy',
    initialPlan: [
      makeSlot({ placeId: 5,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 60,  activityType: 'sightseeing', cost: 0 }),
      makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 1, startHour: 9,  startMinute: 30, durationMin: 45, activityType: 'meal', cost: 50000 }),
      makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 2, startHour: 10, startMinute: 45, durationMin: 90, activityType: 'activity', cost: 0 }),
      makeSlot({ placeId: 103, dayIndex: 0, slotOrder: 3, startHour: 12, startMinute: 30, durationMin: 60, activityType: 'meal', cost: 350000 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences(),
    initialState: makeInitialState(),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: false, // đã tốt, không yêu cầu improve
      minSlotsInResult: 3,          // ít nhất 3 slots (có thể drop 1)
    },
  };
}

function S02_disruption_delay(): BenchmarkScenario {
  _slotCounter = 100;
  const plan = [
    makeSlot({ placeId: 5,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 60,  activityType: 'sightseeing', cost: 0, status: 'completed', actualStart: isoTime(0, 8, 0), actualEnd: isoTime(0, 9, 15) }),
    makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 1, startHour: 9,  startMinute: 30, durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
    makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 2, startHour: 12, durationMin: 45,  activityType: 'meal', cost: 50000 }),
    makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 3, startHour: 13, durationMin: 90,  activityType: 'activity', cost: 0 }),
    makeSlot({ placeId: 103, dayIndex: 0, slotOrder: 4, startHour: 15, durationMin: 60,  activityType: 'meal', cost: 350000 }),
    makeSlot({ placeId: 8,   dayIndex: 0, slotOrder: 5, startHour: 16, startMinute: 30, durationMin: 180, activityType: 'activity', cost: 200000 }),
  ];

  // Slot 0 hoàn thành trễ 15 phút → remaining slots cần replan
  return {
    id: 'S02',
    name: 'Disruption — Slot đầu tiên hoàn thành trễ 15 phút',
    description: 'Slot 0 completed nhưng kết thúc 9:15 thay vì 9:00. Replan 5 slots còn lại.',
    category: 'disruption',
    difficulty: 'medium',
    initialPlan: plan.slice(1), // remaining slots (chỉ planned slots)
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences(),
    initialState: makeInitialState({
      timeRemainingMin: 510, // 8h30 - đã dùng 1h30 (bao gồm 15' trễ)
      budgetRemaining: 3000000,
      fatigue: 0.10,
      currentLat: 16.1001, // vị trí Chùa Linh Ứng (vừa xong)
      currentLng: 108.2772,
      capturedAt: isoTime(0, 9, 15),
    }),
    capturedAt: isoTime(0, 9, 15),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
      minSlotsInResult: 3,
    },
  };
}

function S03_tight_schedule(): BenchmarkScenario {
  _slotCounter = 200;
  return {
    id: 'S03',
    name: 'Tight Schedule — Slots sát night constraint',
    description: 'Plan có slot cuối kết thúc lúc 22:15. Bất kỳ delay nào cũng gây overflow.',
    category: 'tight_schedule',
    difficulty: 'hard',
    initialPlan: [
      makeSlot({ placeId: 1,   dayIndex: 0, slotOrder: 0, startHour: 17, durationMin: 45,  activityType: 'sightseeing', cost: 0 }),
      makeSlot({ placeId: 104, dayIndex: 0, slotOrder: 1, startHour: 18, durationMin: 45,  activityType: 'meal', cost: 60000 }),
      makeSlot({ placeId: 303, dayIndex: 0, slotOrder: 2, startHour: 19, durationMin: 60,  activityType: 'activity', cost: 100000 }),
      makeSlot({ placeId: 8,   dayIndex: 0, slotOrder: 3, startHour: 20, startMinute: 15, durationMin: 120, activityType: 'activity', cost: 200000 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(2, 'clear'), // 2 ngày để cho phép overflow
    userPreferences: defaultPreferences({ preferredPace: 3 }),
    initialState: makeInitialState({
      timeRemainingMin: 330,
      fatigue: 0.45, // đã mệt từ buổi sáng
      capturedAt: isoTime(0, 16, 50),
    }),
    capturedAt: isoTime(0, 16, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
    },
  };
}

function S04_budget_pressure(): BenchmarkScenario {
  _slotCounter = 300;
  return {
    id: 'S04',
    name: 'Budget Pressure — Chỉ còn 200k cho 5 slots',
    description: 'Budget rất thấp. Engine phải drop hoặc replace các slot đắt.',
    category: 'budget_pressure',
    difficulty: 'hard',
    initialPlan: [
      makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
      makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 1, startHour: 10, startMinute: 30, durationMin: 45, activityType: 'meal', cost: 50000 }),
      makeSlot({ placeId: 301, dayIndex: 0, slotOrder: 2, startHour: 12, durationMin: 150, activityType: 'activity', cost: 800000 }),  // QUÁ ĐẮT
      makeSlot({ placeId: 103, dayIndex: 0, slotOrder: 3, startHour: 15, durationMin: 60,  activityType: 'meal', cost: 350000 }),       // ĐẮT
      makeSlot({ placeId: 8,   dayIndex: 0, slotOrder: 4, startHour: 16, startMinute: 30, durationMin: 180, activityType: 'activity', cost: 200000 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences({ budgetTotal: 200000 }),
    initialState: makeInitialState({ budgetRemaining: 200000 }),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
      // Slot 301 (800k) và 103 (350k) phải bị replace hoặc drop
      forbiddenPlaceIds: [301],
    },
  };
}

function S05_fatigue_heavy(): BenchmarkScenario {
  _slotCounter = 400;
  return {
    id: 'S05',
    name: 'Fatigue Heavy — 6 hoạt động liên tục, fatigue 0.70',
    description: 'User đã mệt (0.70), plan còn 6 hoạt động nặng. Engine phải chèn rest hoặc drop.',
    category: 'fatigue_heavy',
    difficulty: 'hard',
    initialPlan: [
      makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 0, startHour: 13, durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
      makeSlot({ placeId: 302, dayIndex: 0, slotOrder: 1, startHour: 15, startMinute: 30, durationMin: 90, activityType: 'activity', cost: 300000 }),
      makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 2, startHour: 17, startMinute: 30, durationMin: 90, activityType: 'activity', cost: 0 }),
      makeSlot({ placeId: 104, dayIndex: 0, slotOrder: 3, startHour: 19, startMinute: 30, durationMin: 45, activityType: 'meal', cost: 60000 }),
      makeSlot({ placeId: 303, dayIndex: 0, slotOrder: 4, startHour: 20, startMinute: 30, durationMin: 60, activityType: 'activity', cost: 100000 }),
      makeSlot({ placeId: 7,   dayIndex: 0, slotOrder: 5, startHour: 21, startMinute: 45, durationMin: 30, activityType: 'sightseeing', cost: 0 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences(),
    initialState: makeInitialState({
      timeRemainingMin: 300,
      fatigue: 0.70,         // ← rất mệt
      capturedAt: isoTime(0, 12, 50),
    }),
    capturedAt: isoTime(0, 12, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
    },
  };
}

function S06_multi_day(): BenchmarkScenario {
  _slotCounter = 500;
  return {
    id: 'S06',
    name: 'Multi-Day — 3 ngày, 12 slots',
    description: 'Chuyến đi 3 ngày tiêu chuẩn. Test scalability và cross-day interactions.',
    category: 'multi_day',
    difficulty: 'medium',
    initialPlan: [
      // Ngày 0
      makeSlot({ placeId: 5,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 60,  activityType: 'sightseeing', cost: 0 }),
      makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 1, startHour: 9,  startMinute: 30, durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
      makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 2, startHour: 12, durationMin: 45,  activityType: 'meal', cost: 50000 }),
      makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 3, startHour: 13, durationMin: 90,  activityType: 'activity', cost: 0 }),
      // Ngày 1
      makeSlot({ placeId: 2,   dayIndex: 1, slotOrder: 0, startHour: 7,  durationMin: 240, activityType: 'sightseeing', cost: 900000 }),
      makeSlot({ placeId: 102, dayIndex: 1, slotOrder: 1, startHour: 12, durationMin: 40,  activityType: 'meal', cost: 45000 }),
      makeSlot({ placeId: 201, dayIndex: 1, slotOrder: 2, startHour: 13, durationMin: 45,  activityType: 'rest', cost: 50000 }),
      makeSlot({ placeId: 4,   dayIndex: 1, slotOrder: 3, startHour: 14, durationMin: 90,  activityType: 'sightseeing', cost: 60000 }),
      // Ngày 2
      makeSlot({ placeId: 301, dayIndex: 2, slotOrder: 0, startHour: 8,  durationMin: 150, activityType: 'activity', cost: 800000 }),
      makeSlot({ placeId: 103, dayIndex: 2, slotOrder: 1, startHour: 11, durationMin: 60,  activityType: 'meal', cost: 350000 }),
      makeSlot({ placeId: 9,   dayIndex: 2, slotOrder: 2, startHour: 12, startMinute: 30, durationMin: 90, activityType: 'activity', cost: 0 }),
      makeSlot({ placeId: 303, dayIndex: 2, slotOrder: 3, startHour: 19, durationMin: 60,  activityType: 'activity', cost: 100000 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(3, 'mixed'),  // ngày 0 nắng, ngày 1 mưa, ngày 2 nắng
    userPreferences: defaultPreferences({ budgetTotal: 3000000 }),
    initialState: makeInitialState({
      timeRemainingMin: 1800, // 3 ngày × 10h
      budgetRemaining: 3000000,
    }),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
      minSlotsInResult: 8,
    },
  };
}

function S07_large_pool(): BenchmarkScenario {
  _slotCounter = 600;

  // Tạo pool lớn bằng cách nhân bản + biến đổi nhẹ
  const bigPool: PlaceCandidate[] = [...DA_NANG_PLACES];
  for (let i = 0; i < 30; i++) {
    const base = DA_NANG_PLACES[i % DA_NANG_PLACES.length];
    bigPool.push({
      ...base,
      placeId: 1000 + i,
      name: `${base.name} (alt ${i})`,
      lat: base.lat + (Math.sin(i) * 0.01),
      lng: base.lng + (Math.cos(i) * 0.01),
      estimatedCost: Math.round(base.estimatedCost * (0.7 + 0.6 * (i % 5) / 5)),
    });
  }

  return {
    id: 'S07',
    name: 'Large Pool — 50+ candidates, 6 slots',
    description: 'Pool rất lớn. REPLACE_PLACE và INSERT_ALT có nhiều lựa chọn → candidate explosion.',
    category: 'large_pool',
    difficulty: 'medium',
    initialPlan: [
      makeSlot({ placeId: 1,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 45,  activityType: 'sightseeing', cost: 0 }),
      makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 1, startHour: 9,  durationMin: 45,  activityType: 'meal', cost: 50000 }),
      makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 2, startHour: 10, durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
      makeSlot({ placeId: 104, dayIndex: 0, slotOrder: 3, startHour: 12, startMinute: 30, durationMin: 45, activityType: 'meal', cost: 60000 }),
      makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 4, startHour: 14, durationMin: 90,  activityType: 'activity', cost: 0 }),
      makeSlot({ placeId: 201, dayIndex: 0, slotOrder: 5, startHour: 16, durationMin: 45,  activityType: 'rest', cost: 50000 }),
    ],
    candidatePool: bigPool,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences(),
    initialState: makeInitialState(),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
    },
  };
}

function S08_locked_slots(): BenchmarkScenario {
  _slotCounter = 700;
  return {
    id: 'S08',
    name: 'Locked Slots — 2 slots bị khóa, 6 slots tổng',
    description: 'Slot 1 (nhà hàng đã đặt bàn) và slot 4 (show diễn) bị khóa. Engine không được thay đổi chúng.',
    category: 'locked_slots',
    difficulty: 'medium',
    initialPlan: [
      makeSlot({ placeId: 1,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 45,  activityType: 'sightseeing', cost: 0 }),
      makeSlot({ placeId: 103, dayIndex: 0, slotOrder: 1, startHour: 9,  startMinute: 30, durationMin: 60, activityType: 'meal', cost: 350000, isLocked: true }),
      makeSlot({ placeId: 3,   dayIndex: 0, slotOrder: 2, startHour: 11, durationMin: 120, activityType: 'sightseeing', cost: 40000 }),
      makeSlot({ placeId: 201, dayIndex: 0, slotOrder: 3, startHour: 13, startMinute: 30, durationMin: 45, activityType: 'rest', cost: 50000 }),
      makeSlot({ placeId: 8,   dayIndex: 0, slotOrder: 4, startHour: 15, durationMin: 180, activityType: 'activity', cost: 200000, isLocked: true }),
      makeSlot({ placeId: 7,   dayIndex: 0, slotOrder: 5, startHour: 18, startMinute: 30, durationMin: 30, activityType: 'sightseeing', cost: 0 }),
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'clear'),
    userPreferences: defaultPreferences(),
    initialState: makeInitialState(),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: false,
    },
  };
}

function S09_worst_case_latency(): BenchmarkScenario {
  _slotCounter = 800;

  // 5 ngày × 5 slots = 25 slots — near max
  const plan: TripSlot[] = [];
  for (let day = 0; day < 5; day++) {
    plan.push(makeSlot({ placeId: DA_NANG_PLACES[day % 10].placeId,
      dayIndex: day, slotOrder: 0, startHour: 8,  durationMin: 90,
      activityType: 'sightseeing', cost: 40000 }));
    plan.push(makeSlot({ placeId: 101 + (day % 5),
      dayIndex: day, slotOrder: 1, startHour: 10, durationMin: 45,
      activityType: 'meal', cost: 55000 }));
    plan.push(makeSlot({ placeId: DA_NANG_PLACES[5 + day % 5].placeId,
      dayIndex: day, slotOrder: 2, startHour: 11, startMinute: 30, durationMin: 120,
      activityType: 'activity', cost: 100000 }));
    plan.push(makeSlot({ placeId: 103,
      dayIndex: day, slotOrder: 3, startHour: 14, durationMin: 60,
      activityType: 'meal', cost: 350000 }));
    plan.push(makeSlot({ placeId: DA_NANG_PLACES[(day + 3) % 10].placeId,
      dayIndex: day, slotOrder: 4, startHour: 15, startMinute: 30, durationMin: 90,
      activityType: 'sightseeing', cost: 0 }));
  }

  // Pool lớn
  const bigPool: PlaceCandidate[] = [...DA_NANG_PLACES];
  for (let i = 0; i < 40; i++) {
    const base = DA_NANG_PLACES[i % DA_NANG_PLACES.length];
    bigPool.push({
      ...base,
      placeId: 2000 + i,
      name: `${base.name} (stress ${i})`,
      lat: base.lat + (Math.sin(i * 0.7) * 0.015),
      lng: base.lng + (Math.cos(i * 0.7) * 0.015),
    });
  }

  return {
    id: 'S09',
    name: 'Worst Case Latency — 5 ngày, 25 slots, pool 60+',
    description: 'Maximum scale. Engine PHẢI hoàn thành trong 4500ms. Stress test latency budget.',
    category: 'worst_case',
    difficulty: 'extreme',
    initialPlan: plan,
    candidatePool: bigPool,
    weatherForecast: makeWeather(5, 'mixed'),
    userPreferences: defaultPreferences({ budgetTotal: 5000000, preferredPace: 5 }),
    initialState: makeInitialState({
      timeRemainingMin: 3000,
      budgetRemaining: 5000000,
    }),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,   // HARD LIMIT
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
      minSlotsInResult: 15,
    },
  };
}

function S10_rainy_day_disruption(): BenchmarkScenario {
  _slotCounter = 900;
  return {
    id: 'S10',
    name: 'Rainy Day — Outdoor slots cần thay thế',
    description: 'Trời mưa to. Các slot outdoor (biển, kayak) bị phạt nặng. Engine nên swap sang indoor.',
    category: 'disruption',
    difficulty: 'medium',
    initialPlan: [
      makeSlot({ placeId: 6,   dayIndex: 0, slotOrder: 0, startHour: 8,  durationMin: 90,  activityType: 'activity', cost: 0 }),       // biển — outdoor
      makeSlot({ placeId: 101, dayIndex: 0, slotOrder: 1, startHour: 10, durationMin: 45,  activityType: 'meal', cost: 50000 }),
      makeSlot({ placeId: 302, dayIndex: 0, slotOrder: 2, startHour: 11, durationMin: 90,  activityType: 'activity', cost: 300000 }),  // kayak — outdoor
      makeSlot({ placeId: 104, dayIndex: 0, slotOrder: 3, startHour: 13, durationMin: 45,  activityType: 'meal', cost: 60000 }),
      makeSlot({ placeId: 9,   dayIndex: 0, slotOrder: 4, startHour: 14, durationMin: 90,  activityType: 'activity', cost: 0 }),       // biển — outdoor
    ],
    candidatePool: DA_NANG_PLACES,
    weatherForecast: makeWeather(1, 'rainy'),  // MƯA TO
    userPreferences: defaultPreferences(),
    initialState: makeInitialState(),
    capturedAt: isoTime(0, 7, 50),
    expectations: {
      mustBeFeasible: true,
      maxLatencyMs: 4500,
      lockedSlotsPreserved: true,
      mustImproveOverInitial: true,
      // Outdoor places nên bị thay
      forbiddenPlaceIds: [302], // kayak trong mưa = nguy hiểm
    },
  };
}

// ─────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────

export const ALL_SCENARIOS: BenchmarkScenario[] = [
  S01_baseline_simple(),
  S02_disruption_delay(),
  S03_tight_schedule(),
  S04_budget_pressure(),
  S05_fatigue_heavy(),
  S06_multi_day(),
  S07_large_pool(),
  S08_locked_slots(),
  S09_worst_case_latency(),
  S10_rainy_day_disruption(),
];

export function getScenario(id: string): BenchmarkScenario | undefined {
  return ALL_SCENARIOS.find(s => s.id === id);
}

export function getScenariosByCategory(cat: ScenarioCategory): BenchmarkScenario[] {
  return ALL_SCENARIOS.filter(s => s.category === cat);
}
