/**
 * EffectivenessEvaluator.test.ts
 *
 * Kiểm thử ReplanEffectivenessEvaluator — đánh giá chất lượng replan theo sự cố:
 *   - classifyRainSeverity / classifyTrafficSeverity
 *   - evaluateRain: low / medium / high severity
 *   - evaluateTrafficDelay: low / medium / high severity
 *   - EffectivenessReport: overallPass, passRate, suggestions, devNote
 */

import { describe, it, expect } from 'vitest';
import {
  ReplanEffectivenessEvaluator,
  classifyRainSeverity,
  classifyTrafficSeverity,
  type EvaluatorInput,
} from '../src/replanner/EffectivenessEvaluator';
import type { Place, TripSlot, TripState, IncidentContext } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    placeId: 1,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    minPrice: 0,
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

function makeUserState(overrides: Partial<TripState> = {}): TripState {
  return {
    tripId: 'trip-001',
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 480,
    budgetRemaining: 500_000,
    fatigue: 0.1,
    currentLat: 16.0614,
    currentLng: 108.2273,
    moodProxy: 0.6,
    capturedAt: '2026-04-20T08:00:00.000Z',
    source: 'simulated',
    ...overrides,
  };
}

function makePlaceMap(places: Place[]): Map<number, Place> {
  return new Map(places.map((p) => [p.placeId, p]));
}

function makeInput(overrides: Partial<EvaluatorInput> = {}): EvaluatorInput {
  return {
    tripId: 'trip-001',
    proposalId: 'proposal-001',
    oldPlan: [],
    newPlan: [],
    placeMap: new Map(),
    incident: {
      type: 'rain',
      severity: 'low',
      rainMmPerH: 2,
      userTransportType: 'covered',
    } as IncidentContext,
    userState: makeUserState(),
    ...overrides,
  };
}

const evaluator = new ReplanEffectivenessEvaluator();

// ---------------------------------------------------------------------------
// 1. Phân loại mức độ sự cố
// ---------------------------------------------------------------------------

describe('1. Nhóm kiểm thử phân loại mức độ sự cố', () => {
  describe('classifyRainSeverity(mmPerH)', () => {
    it('0 mm/h → low', () => expect(classifyRainSeverity(0)).toBe('low'));
    it('4.9 mm/h → low (biên dưới)', () => expect(classifyRainSeverity(4.9)).toBe('low'));
    it('5 mm/h → medium (biên dưới medium)', () => expect(classifyRainSeverity(5)).toBe('medium'));
    it('25 mm/h → medium (biên trên medium)', () => expect(classifyRainSeverity(25)).toBe('medium'));
    it('25.1 mm/h → high', () => expect(classifyRainSeverity(25.1)).toBe('high'));
    it('100 mm/h → high', () => expect(classifyRainSeverity(100)).toBe('high'));
  });

  describe('classifyTrafficSeverity(delayMin)', () => {
    it('0 phút → low', () => expect(classifyTrafficSeverity(0)).toBe('low'));
    it('14 phút → low', () => expect(classifyTrafficSeverity(14)).toBe('low'));
    it('15 phút → medium', () => expect(classifyTrafficSeverity(15)).toBe('medium'));
    it('30 phút → medium', () => expect(classifyTrafficSeverity(30)).toBe('medium'));
    it('31 phút → high', () => expect(classifyTrafficSeverity(31)).toBe('high'));
    it('60 phút → high', () => expect(classifyTrafficSeverity(60)).toBe('high'));
  });
});

// ---------------------------------------------------------------------------
// 2. Mưa nhẹ (low rain)
// ---------------------------------------------------------------------------

describe('2. Nhóm kiểm thử: Mưa nhẹ (low rain)', () => {
  it('kế hoạch không đổi: stability = 1.0 → minimal_disruption pass = true', () => {
    const place = makePlace({ placeId: 1, indoorOutdoor: 'indoor' });
    const slot = makeSlot({ placeId: 1 });
    const input = makeInput({
      oldPlan: [slot],
      newPlan: [slot], // giống hệt nhau
      placeMap: makePlaceMap([place]),
      incident: { type: 'rain', severity: 'low', rainMmPerH: 2, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'minimal_disruption');
    expect(crit).toBeDefined();
    expect(crit!.pass).toBe(true);
  });

  it('thay đổi > 30% địa điểm khi mưa nhẹ: minimal_disruption pass = false', () => {
    const p1 = makePlace({ placeId: 1 });
    const p2 = makePlace({ placeId: 2 });
    const p3 = makePlace({ placeId: 3 });
    const input = makeInput({
      oldPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      newPlan: [makeSlot({ slotId: 's3', placeId: 3 })], // hoàn toàn khác
      placeMap: makePlaceMap([p1, p2, p3]),
      incident: { type: 'rain', severity: 'low', rainMmPerH: 2, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'minimal_disruption');
    expect(crit!.pass).toBe(false);
  });

  it('overallPass = true dù minimal_disruption fail (level = info, không phải error)', () => {
    const p1 = makePlace({ placeId: 1 });
    const p2 = makePlace({ placeId: 2 });
    const input = makeInput({
      oldPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      newPlan: [makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([p1, p2]),
      incident: { type: 'rain', severity: 'low', rainMmPerH: 2, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    expect(report.overallPass).toBe(true); // info level không ảnh hưởng overallPass
  });
});

// ---------------------------------------------------------------------------
// 3. Mưa vừa (medium rain)
// ---------------------------------------------------------------------------

describe('3. Nhóm kiểm thử: Mưa vừa (medium rain)', () => {
  const incident: IncidentContext = { type: 'rain', severity: 'medium', rainMmPerH: 15, userTransportType: 'covered' } as IncidentContext;

  it('tỷ lệ ngoài trời ≤ 50%: pass outdoor_ratio_moderate', () => {
    const indoor = makePlace({ placeId: 1, indoorOutdoor: 'indoor' });
    const outdoor = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([indoor, outdoor]),
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'outdoor_ratio_moderate');
    expect(crit!.pass).toBe(true); // 1/2 = 50% ≤ 50%
  });

  it('tỷ lệ ngoài trời > 50%: fail outdoor_ratio_moderate', () => {
    const outdoor1 = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const outdoor2 = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const indoor = makePlace({ placeId: 3, indoorOutdoor: 'indoor', lat: 16.08, lng: 108.24 });
    const input = makeInput({
      newPlan: [
        makeSlot({ slotId: 's1', placeId: 1 }),
        makeSlot({ slotId: 's2', placeId: 2 }),
        makeSlot({ slotId: 's3', placeId: 3 }),
      ],
      placeMap: makePlaceMap([outdoor1, outdoor2, indoor]),
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'outdoor_ratio_moderate');
    expect(crit!.pass).toBe(false); // 2/3 ≈ 67% > 50%
  });

  it('có place beach (tag=1) outdoor: fail avoids_waterway_outdoor', () => {
    const beach = makePlace({
      placeId: 1,
      indoorOutdoor: 'outdoor',
      tags: [{ tagId: 1 } as any], // BEACH_TAG = 1
    });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([beach]),
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'avoids_waterway_outdoor');
    expect(crit!.pass).toBe(false);
  });

  it('slot ngoài trời kéo dài >90 phút: fail no_long_outdoor_slot', () => {
    const outdoor = makePlace({ placeId: 1, indoorOutdoor: 'outdoor', avgVisitDurationMin: 91 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([outdoor]),
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'no_long_outdoor_slot');
    expect(crit!.pass).toBe(false);
  });

  it('overallPass = true dù có warning (level=warning không phải error)', () => {
    const outdoor1 = makePlace({ placeId: 1, indoorOutdoor: 'outdoor', avgVisitDurationMin: 120 });
    const outdoor2 = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([outdoor1, outdoor2]),
      incident,
    });
    const report = evaluator.evaluate(input);
    expect(report.overallPass).toBe(true); // warning không ảnh hưởng overallPass
  });
});

// ---------------------------------------------------------------------------
// 4. Mưa nặng (high rain)
// ---------------------------------------------------------------------------

describe('4. Nhóm kiểm thử: Mưa nặng (high rain)', () => {
  const baseIncident: IncidentContext = {
    type: 'rain',
    severity: 'high',
    rainMmPerH: 30,
    userTransportType: 'covered',
  } as IncidentContext;

  it('outdoor_ratio ≤ 20%: pass outdoor_ratio', () => {
    const indoor1 = makePlace({ placeId: 1, indoorOutdoor: 'indoor' });
    const indoor2 = makePlace({ placeId: 2, indoorOutdoor: 'indoor', lat: 16.07, lng: 108.23 });
    const indoor3 = makePlace({ placeId: 3, indoorOutdoor: 'indoor', lat: 16.08, lng: 108.24 });
    const indoor4 = makePlace({ placeId: 4, indoorOutdoor: 'indoor', lat: 16.09, lng: 108.25 });
    const outdoor = makePlace({ placeId: 5, indoorOutdoor: 'outdoor', lat: 16.10, lng: 108.26 });
    const input = makeInput({
      newPlan: [
        makeSlot({ slotId: 's1', placeId: 1 }),
        makeSlot({ slotId: 's2', placeId: 2 }),
        makeSlot({ slotId: 's3', placeId: 3 }),
        makeSlot({ slotId: 's4', placeId: 4 }),
        makeSlot({ slotId: 's5', placeId: 5 }),
      ],
      placeMap: makePlaceMap([indoor1, indoor2, indoor3, indoor4, outdoor]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'outdoor_ratio');
    expect(crit!.pass).toBe(true); // 1/5 = 20% ≤ 20%
  });

  it('outdoor_ratio > 30%: fail với level=error → overallPass = false', () => {
    const outdoor1 = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const outdoor2 = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([outdoor1, outdoor2]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'outdoor_ratio');
    expect(crit!.pass).toBe(false);
    expect(crit!.level).toBe('error');
    expect(report.overallPass).toBe(false);
  });

  it('không có địa điểm indoor: fail has_indoor_refuge (error) → overallPass = false', () => {
    const outdoor = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([outdoor]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'has_indoor_refuge');
    expect(crit!.pass).toBe(false);
    expect(crit!.level).toBe('error');
    expect(report.overallPass).toBe(false);
  });

  it('có ít nhất 1 địa điểm indoor: pass has_indoor_refuge', () => {
    const indoor = makePlace({ placeId: 1, indoorOutdoor: 'indoor' });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([indoor]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'has_indoor_refuge');
    expect(crit!.pass).toBe(true);
  });

  it('có beach outdoor (tag=1): fail avoids_waterway_outdoor (error)', () => {
    const beach = makePlace({ placeId: 1, indoorOutdoor: 'outdoor', tags: [{ tagId: 1 } as any] });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([beach]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'avoids_waterway_outdoor');
    expect(crit!.pass).toBe(false);
    expect(crit!.level).toBe('error');
  });

  it('có địa điểm food (tag=4) ≥ 60 phút: pass has_long_service_place', () => {
    const restaurant = makePlace({ placeId: 1, indoorOutdoor: 'indoor', avgVisitDurationMin: 90, tags: [{ tagId: 4 } as any] });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([restaurant]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'has_long_service_place');
    expect(crit!.pass).toBe(true);
  });

  it('có địa điểm shopping (tag=6): pass near_crowded_venue', () => {
    const mall = makePlace({ placeId: 1, indoorOutdoor: 'indoor', tags: [{ tagId: 6 } as any] });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([mall]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'near_crowded_venue');
    expect(crit!.pass).toBe(true);
  });

  it('uncovered transport + có shopping: pass uncovered_transport_shelter', () => {
    const mall = makePlace({ placeId: 1, indoorOutdoor: 'indoor', tags: [{ tagId: 6 } as any] });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([mall]),
      incident: { ...baseIncident, userTransportType: 'uncovered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'uncovered_transport_shelter');
    expect(crit!.pass).toBe(true);
  });

  it('uncovered transport + điểm gần ≤ 2km: pass uncovered_transport_shelter', () => {
    // Địa điểm gần userState (16.0614, 108.2273) — cùng tọa độ → 0km
    const nearby = makePlace({ placeId: 1, indoorOutdoor: 'indoor', lat: 16.0614, lng: 108.2273 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([nearby]),
      incident: { ...baseIncident, userTransportType: 'uncovered' } as IncidentContext,
      userState: makeUserState({ currentLat: 16.0614, currentLng: 108.2273 }),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'uncovered_transport_shelter');
    expect(crit!.pass).toBe(true);
  });

  it('passRate = passed/total', () => {
    const indoor = makePlace({ placeId: 1, indoorOutdoor: 'indoor' });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([indoor]),
      incident: baseIncident,
    });
    const report = evaluator.evaluate(input);
    const passed = report.criteria.filter((c) => c.pass).length;
    const total = report.criteria.length;
    expect(report.passRate).toBeCloseTo(passed / total, 5);
  });
});

// ---------------------------------------------------------------------------
// 5. Tắc xe nhẹ (low traffic)
// ---------------------------------------------------------------------------

describe('5. Nhóm kiểm thử: Tắc xe nhẹ (low traffic)', () => {
  it('luôn trả về trivial_delay pass = true, overallPass = true', () => {
    const input = makeInput({
      incident: { type: 'traffic_delay', severity: 'low', trafficDelayMin: 10 } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'trivial_delay');
    expect(crit!.pass).toBe(true);
    expect(report.overallPass).toBe(true);
    expect(report.passRate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Tắc xe vừa (medium traffic)
// ---------------------------------------------------------------------------

describe('6. Nhóm kiểm thử: Tắc xe vừa (medium traffic)', () => {
  const incident: IncidentContext = { type: 'traffic_delay', severity: 'medium', trafficDelayMin: 20 } as IncidentContext;

  it('stability ≥ 50%: pass medium_traffic_stability', () => {
    const slot = makeSlot({ slotId: 's1', placeId: 1 });
    const input = makeInput({
      oldPlan: [slot],
      newPlan: [slot], // giống nhau → stability = 1.0
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'medium_traffic_stability');
    expect(crit!.pass).toBe(true);
  });

  it('stability < 50%: fail, level=info → overallPass = true', () => {
    const s1 = makeSlot({ slotId: 's1', placeId: 1 });
    const s2 = makeSlot({ slotId: 's2', placeId: 2 });
    const s3 = makeSlot({ slotId: 's3', placeId: 3 });
    const input = makeInput({
      oldPlan: [s1, s2, s3],
      newPlan: [makeSlot({ slotId: 's4', placeId: 4 })], // hoàn toàn khác
      incident,
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'medium_traffic_stability');
    expect(crit!.pass).toBe(false);
    expect(crit!.level).toBe('info');
    expect(report.overallPass).toBe(true); // info không ảnh hưởng
  });
});

// ---------------------------------------------------------------------------
// 7. Tắc xe nặng (high traffic)
// ---------------------------------------------------------------------------

describe('7. Nhóm kiểm thử: Tắc xe nặng (high traffic)', () => {
  const baseIncident: IncidentContext = {
    type: 'traffic_delay',
    severity: 'high',
    trafficDelayMin: 45,
    distanceToOriginalDestKm: 5.0,
  } as IncidentContext;

  it('slot sightseeing bị bỏ trong newPlan: pass non_critical_slots_handled', () => {
    const oldSlot = makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing' });
    const input = makeInput({
      oldPlan: [oldSlot],
      newPlan: [], // slot đã bị bỏ
      incident: baseIncident,
      userState: makeUserState({ currentLat: 16.0614, currentLng: 108.2273 }),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'non_critical_slots_handled');
    expect(crit!.pass).toBe(true);
  });

  it('slot sightseeing giữ nguyên (cùng slotId + cùng plannedStart): fail non_critical_slots_handled', () => {
    const oldSlot = makeSlot({
      slotId: 's1',
      placeId: 1,
      activityType: 'sightseeing',
      plannedStart: '2026-04-20T09:00:00+07:00',
    });
    const sameSlot = { ...oldSlot }; // giữ nguyên hoàn toàn
    const input = makeInput({
      oldPlan: [oldSlot],
      newPlan: [sameSlot],
      incident: baseIncident,
      userState: makeUserState({ currentLat: 16.0614, currentLng: 108.2273 }),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'non_critical_slots_handled');
    expect(crit!.pass).toBe(false);
  });

  it('user ≤ 500m đến điểm đến + giữ điểm đó: pass near_dest_slot_preserved', () => {
    const oldSlot = makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing' });
    const input = makeInput({
      oldPlan: [oldSlot],
      newPlan: [oldSlot], // giữ điểm đến
      incident: { ...baseIncident, distanceToOriginalDestKm: 0.3 } as IncidentContext,
      userState: makeUserState(),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'near_dest_slot_preserved');
    expect(crit!.pass).toBe(true);
  });

  it('slot mới nằm xa >5km từ vị trí hiện tại: fail no_new_distant_slot', () => {
    const oldSlot = makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing' });
    // Địa điểm mới cách userState (16.06, 108.22) khoảng 50km
    const farPlace = makePlace({ placeId: 2, lat: 16.5, lng: 108.2273 });
    const newSlot = makeSlot({ slotId: 's2', placeId: 2, activityType: 'sightseeing' });
    const input = makeInput({
      oldPlan: [oldSlot],
      newPlan: [newSlot],
      placeMap: makePlaceMap([farPlace]),
      incident: baseIncident,
      userState: makeUserState({ currentLat: 16.0614, currentLng: 108.2273 }),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'no_new_distant_slot');
    expect(crit!.pass).toBe(false);
  });

  it('có slot nghỉ/ăn khi tắc >30 phút và ở xa: pass rest_stop_inserted', () => {
    const oldSlot = makeSlot({ slotId: 's1', placeId: 1, activityType: 'sightseeing' });
    const restSlot = makeSlot({ slotId: 's2', placeId: 2, activityType: 'rest' });
    const restPlace = makePlace({ placeId: 2, lat: 16.065, lng: 108.228 });
    const input = makeInput({
      oldPlan: [oldSlot],
      newPlan: [oldSlot, restSlot],
      placeMap: makePlaceMap([restPlace]),
      incident: { ...baseIncident, trafficDelayMin: 40, distanceToOriginalDestKm: 5.0 } as IncidentContext,
      userState: makeUserState(),
    });
    const report = evaluator.evaluate(input);
    const crit = report.criteria.find((c) => c.id === 'rest_stop_inserted');
    expect(crit!.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Kiểm tra EffectivenessReport metadata
// ---------------------------------------------------------------------------

describe('8. Nhóm kiểm thử EffectivenessReport metadata', () => {
  it('evaluatedAt là ISO string hợp lệ', () => {
    const report = evaluator.evaluate(makeInput());
    expect(() => new Date(report.evaluatedAt)).not.toThrow();
    expect(report.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('suggestions chứa [LỖI] prefix cho error criteria không pass', () => {
    // outdoor_ratio > 30% → error level
    const outdoor1 = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const outdoor2 = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([outdoor1, outdoor2]),
      incident: { type: 'rain', severity: 'high', rainMmPerH: 30, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const hasError = report.suggestions.some((s) => s.startsWith('[LỖI]'));
    expect(hasError).toBe(true);
  });

  it('suggestions chứa [CẢNH BÁO] prefix cho warning criteria không pass', () => {
    const outdoor = makePlace({ placeId: 1, indoorOutdoor: 'outdoor', avgVisitDurationMin: 120, tags: [{ tagId: 8 } as any] });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 })],
      placeMap: makePlaceMap([outdoor]),
      incident: { type: 'rain', severity: 'medium', rainMmPerH: 15, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    const hasWarning = report.suggestions.some((s) => s.startsWith('[CẢNH BÁO]'));
    expect(hasWarning).toBe(true);
  });

  it('devNote chứa ✓ khi overallPass = true', () => {
    const input = makeInput({
      incident: { type: 'traffic_delay', severity: 'low', trafficDelayMin: 5 } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    expect(report.devNote).toContain('✓');
  });

  it('devNote chứa ✗ khi overallPass = false', () => {
    const outdoor1 = makePlace({ placeId: 1, indoorOutdoor: 'outdoor' });
    const outdoor2 = makePlace({ placeId: 2, indoorOutdoor: 'outdoor', lat: 16.07, lng: 108.23 });
    const input = makeInput({
      newPlan: [makeSlot({ slotId: 's1', placeId: 1 }), makeSlot({ slotId: 's2', placeId: 2 })],
      placeMap: makePlaceMap([outdoor1, outdoor2]),
      incident: { type: 'rain', severity: 'high', rainMmPerH: 30, userTransportType: 'covered' } as IncidentContext,
    });
    const report = evaluator.evaluate(input);
    expect(report.devNote).toContain('✗');
  });
});
