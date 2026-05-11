import type { TripSlot, Place, TripState, IncidentContext, CriterionResult, EffectivenessReport } from '@app/types';

// ─── Tag IDs (from seed-places.ts TAG_MAP) ───────────────────────────────────
const BEACH_TAG         = 1;   // biển
const FOOD_TAG          = 4;   // ẩm thực (quán ăn, cà phê)
const SHOPPING_TAG      = 6;   // mua sắm
const ENTERTAINMENT_TAG = 7;   // giải trí / check-in
const NATURE_TAG        = 8;   // thiên nhiên (bao gồm suối, thác)

// Outdoor + these tags = waterway-risk when raining
const WATERWAY_RISK_TAGS = new Set([BEACH_TAG, NATURE_TAG]);

// ─── Severity thresholds ──────────────────────────────────────────────────────
// Vietnamese standard (mm/h)
const RAIN_LOW_MAX    = 5;    // < 5   → nhẹ
const RAIN_MEDIUM_MAX = 25;   // 5–25  → vừa; > 25 → lớn

// Traffic delay (minutes)
const TRAFFIC_LOW_MAX    = 15;
const TRAFFIC_MEDIUM_MAX = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasTag(place: Place, tagId: number): boolean {
  return place.tags.some((t) => t.tagId === tagId);
}

function isOutdoor(place: Place): boolean {
  return place.indoorOutdoor === 'outdoor';
}

/** Jaccard similarity on placeId sets — 1.0 = identical, 0.0 = no overlap. */
function planStability(oldPlan: TripSlot[], newPlan: TripSlot[]): number {
  const oldIds = new Set(oldPlan.map((s) => s.placeId));
  const newIds = new Set(newPlan.map((s) => s.placeId));
  const common = [...oldIds].filter((id) => newIds.has(id)).length;
  const total = oldIds.size + newIds.size - common;
  return total > 0 ? common / total : 1;
}

function resolvePlaces(plan: TripSlot[], placeMap: Map<number, Place>): Place[] {
  return plan.map((s) => placeMap.get(s.placeId)!).filter(Boolean);
}

// ─── Rain evaluator ───────────────────────────────────────────────────────────

function evaluateRain(
  incident: IncidentContext,
  oldPlan: TripSlot[],
  newPlan: TripSlot[],
  placeMap: Map<number, Place>,
  userState: TripState,
): CriterionResult[] {
  const { severity, userTransportType } = incident;
  const places   = resolvePlaces(newPlan, placeMap);
  const total    = places.length;
  const outdoorN = places.filter(isOutdoor).length;
  const ratio    = total > 0 ? outdoorN / total : 0;
  const results: CriterionResult[] = [];

  if (severity === 'high') {
    // C1 – outdoor ratio ≤ 20%
    results.push({
      id: 'outdoor_ratio',
      label: 'Tỷ lệ địa điểm ngoài trời',
      expected: '≤ 20% slot ngoài trời khi mưa lớn (>25 mm/h)',
      actual: `${(ratio * 100).toFixed(0)}% (${outdoorN}/${total} slot)`,
      pass: ratio <= 0.20,
      level: ratio > 0.30 ? 'error' : 'warning',
    });

    // C2 – ít nhất 1 indoor / mixed
    const hasIndoor = places.some((p) => p.indoorOutdoor !== 'outdoor');
    results.push({
      id: 'has_indoor_refuge',
      label: 'Có địa điểm có mái che',
      expected: '≥ 1 địa điểm indoor hoặc mixed trong lịch',
      actual: hasIndoor ? 'Có' : 'Không',
      pass: hasIndoor,
      level: 'error',
    });

    // C3 – dịch vụ lâu dài (ăn/nghỉ ≥ 60 phút)
    const hasLongService = newPlan.some((s) => {
      const p = placeMap.get(s.placeId);
      if (!p) return false;
      const isService = hasTag(p, FOOD_TAG) || s.activityType === 'meal' || s.activityType === 'rest';
      return isService && p.avgVisitDurationMin >= 60;
    });
    results.push({
      id: 'has_long_service_place',
      label: 'Địa điểm dịch vụ lâu dài (ăn/nghỉ ≥ 60 phút)',
      expected: 'Mưa lớn: cần nơi trú lâu (nhà hàng, quán cà phê ≥ 60 phút)',
      actual: hasLongService ? 'Có' : 'Không',
      pass: hasLongService,
      level: 'warning',
    });

    // C4 – tránh suối/thác/biển ngoài trời
    const waterRisk = places.filter(
      (p) => isOutdoor(p) && [...WATERWAY_RISK_TAGS].some((t) => hasTag(p, t)),
    );
    results.push({
      id: 'avoids_waterway_outdoor',
      label: 'Tránh suối/thác/biển ngoài trời',
      expected: 'Không có địa điểm beach/nature outdoor khi mưa lớn',
      actual: waterRisk.length > 0
        ? `${waterRisk.length} địa điểm nguy hiểm: ${waterRisk.map((p) => p.name).join(', ')}`
        : 'Không có',
      pass: waterRisk.length === 0,
      level: 'error',
    });

    // C5 – gần khu đông người (mua sắm / giải trí)
    const hasCrowded = places.some(
      (p) => hasTag(p, SHOPPING_TAG) || hasTag(p, ENTERTAINMENT_TAG),
    );
    results.push({
      id: 'near_crowded_venue',
      label: 'Gần khu đông người (mua sắm/giải trí)',
      expected: 'Mưa lớn: ít nhất 1 địa điểm mua sắm hoặc giải trí để tránh mưa',
      actual: hasCrowded ? 'Có' : 'Không',
      pass: hasCrowded,
      level: 'warning',
    });

    // C6 – hỗ trợ phương tiện không che (xe máy)
    if (userTransportType === 'uncovered') {
      const hasShop = places.some((p) => hasTag(p, SHOPPING_TAG));
      const nearestKm = newPlan.reduce((min, s) => {
        const p = placeMap.get(s.placeId);
        if (!p) return min;
        const d = haversineKm(userState.currentLat, userState.currentLng, p.lat, p.lng);
        return d < min ? d : min;
      }, Infinity);
      results.push({
        id: 'uncovered_transport_shelter',
        label: 'Hỗ trợ xe máy (phương tiện không che)',
        expected: 'Có điểm mua sắm (mua áo mưa) hoặc điểm dừng ≤ 2km',
        actual: hasShop
          ? 'Có điểm mua sắm trong lịch'
          : `Điểm gần nhất: ${nearestKm === Infinity ? 'N/A' : nearestKm.toFixed(1) + 'km'}`,
        pass: hasShop || nearestKm <= 2.0,
        level: 'warning',
      });
    }

  } else if (severity === 'medium') {
    // C1 – outdoor ratio ≤ 50%
    results.push({
      id: 'outdoor_ratio_moderate',
      label: 'Tỷ lệ ngoài trời (mưa vừa)',
      expected: '≤ 50% slot ngoài trời khi mưa vừa (5–25 mm/h)',
      actual: `${(ratio * 100).toFixed(0)}% (${outdoorN}/${total} slot)`,
      pass: ratio <= 0.50,
      level: 'warning',
    });

    // C2 – tránh suối/thác/biển ngoài trời
    const waterRisk = places.filter(
      (p) => isOutdoor(p) && [...WATERWAY_RISK_TAGS].some((t) => hasTag(p, t)),
    );
    results.push({
      id: 'avoids_waterway_outdoor',
      label: 'Tránh khu vực suối/thác/biển ngoài trời',
      expected: 'Mưa vừa: không thăm khu beach/nature outdoor',
      actual: waterRisk.length > 0 ? `${waterRisk.length} địa điểm rủi ro` : 'Không có',
      pass: waterRisk.length === 0,
      level: 'warning',
    });

    // C3 – không có slot ngoài trời kéo dài (> 90 phút)
    const longOutdoor = newPlan.filter((s) => {
      const p = placeMap.get(s.placeId);
      return p && isOutdoor(p) && p.avgVisitDurationMin > 90;
    });
    results.push({
      id: 'no_long_outdoor_slot',
      label: 'Không có hoạt động ngoài trời dài (>90 phút)',
      expected: 'Mưa vừa: tránh hoạt động ngoài trời kéo dài',
      actual: longOutdoor.length > 0 ? `${longOutdoor.length} slot ngoài trời dài` : 'Không có',
      pass: longOutdoor.length === 0,
      level: 'warning',
    });

  } else {
    // Low rain — kế hoạch nên giữ ổn định (chờ mưa dứt)
    const stability = planStability(oldPlan, newPlan);
    results.push({
      id: 'minimal_disruption',
      label: 'Thay đổi tối thiểu (mưa nhẹ)',
      expected: 'Mưa nhẹ (<5 mm/h): thay đổi < 30% — gợi ý chờ gần đó',
      actual: `Thay đổi ${((1 - stability) * 100).toFixed(0)}% địa điểm`,
      pass: stability >= 0.70,
      level: 'info',
    });
  }

  return results;
}

// ─── Traffic delay evaluator ─────────────────────────────────────────────────

function evaluateTrafficDelay(
  incident: IncidentContext,
  oldPlan: TripSlot[],
  newPlan: TripSlot[],
  placeMap: Map<number, Place>,
  userState: TripState,
): CriterionResult[] {
  const { severity, trafficDelayMin = 0, distanceToOriginalDestKm } = incident;
  const results: CriterionResult[] = [];

  if (severity === 'high') {
    // C1 – slot không quan trọng đã được xử lý (dời giờ hoặc bỏ)
    const nonCritical = oldPlan.filter(
      (s) => s.activityType === 'sightseeing' || s.activityType === 'activity',
    );
    const modifiedOrRemoved = nonCritical.filter((s) => {
      const inNew = newPlan.find((n) => n.slotId === s.slotId);
      // Bỏ hẳn → xử lý tốt; dời giờ → xử lý tốt
      return !inNew || inNew.plannedStart !== s.plannedStart;
    });
    const handled = modifiedOrRemoved.length > 0 || nonCritical.length === 0;
    results.push({
      id: 'non_critical_slots_handled',
      label: 'Xử lý slot tham quan khi tắc nặng',
      expected: 'Slot sightseeing/activity phải được dời giờ hoặc bỏ khi tắc nặng',
      actual: handled
        ? `${modifiedOrRemoved.length}/${nonCritical.length} slot đã được xử lý`
        : `Không xử lý — ${nonCritical.length} slot tham quan giữ nguyên`,
      pass: handled,
      level: 'warning',
    });

    // C2 – người dùng đã gần đến: giữ điểm đến ban đầu
    if (distanceToOriginalDestKm !== undefined && distanceToOriginalDestKm <= 0.5) {
      const firstOld = oldPlan[0];
      const keptDest = firstOld
        ? newPlan.some((s) => s.placeId === firstOld.placeId)
        : true;
      results.push({
        id: 'near_dest_slot_preserved',
        label: 'Giữ điểm đến (người dùng đã đến gần)',
        expected: `Trong ${(distanceToOriginalDestKm * 1000).toFixed(0)}m — nên giữ điểm đến ban đầu`,
        actual: keptDest ? 'Giữ điểm đến' : 'Đã thay điểm đến',
        pass: keptDest,
        level: 'warning',
      });
    }

    // C3 – thêm điểm dừng nghỉ nếu tắc > 30 phút và ở xa
    const isFar = distanceToOriginalDestKm === undefined || distanceToOriginalDestKm > 2.0;
    if (trafficDelayMin > TRAFFIC_MEDIUM_MAX && isFar) {
      const hasRestStop = newPlan.some(
        (s) => s.activityType === 'rest' || s.activityType === 'meal',
      );
      results.push({
        id: 'rest_stop_inserted',
        label: 'Thêm điểm dừng chân tạm thời',
        expected: `Tắc ${trafficDelayMin} phút và ở xa (${(distanceToOriginalDestKm ?? 99).toFixed(1)}km): cần điểm nghỉ/ăn`,
        actual: hasRestStop ? 'Có điểm nghỉ/ăn' : 'Không có',
        pass: hasRestStop,
        level: 'warning',
      });
    }

    // C4 – không thêm slot mới quá xa (> 5km) từ vị trí hiện tại
    const oldSlotIds = new Set(oldPlan.map((s) => s.slotId));
    const farNewSlots = newPlan.filter((s) => {
      if (oldSlotIds.has(s.slotId)) return false;
      const p = placeMap.get(s.placeId);
      if (!p) return false;
      return haversineKm(userState.currentLat, userState.currentLng, p.lat, p.lng) > 5;
    });
    results.push({
      id: 'no_new_distant_slot',
      label: 'Không thêm địa điểm xa >5km khi tắc nặng',
      expected: 'Địa điểm mới phải trong bán kính 5km từ vị trí hiện tại',
      actual: farNewSlots.length > 0
        ? `${farNewSlots.length} slot mới nằm ngoài 5km`
        : 'Tất cả slot mới trong phạm vi hợp lý',
      pass: farNewSlots.length === 0,
      level: 'warning',
    });

  } else if (severity === 'medium') {
    const stability = planStability(oldPlan, newPlan);
    results.push({
      id: 'medium_traffic_stability',
      label: 'Điều chỉnh nhẹ (tắc vừa 15–30 phút)',
      expected: 'Tắc vừa: chủ yếu dời giờ, thay đổi <50%',
      actual: `${((1 - stability) * 100).toFixed(0)}% thay đổi so với kế hoạch cũ`,
      pass: stability >= 0.50,
      level: 'info',
    });

  } else {
    // Low — trivial, always pass
    results.push({
      id: 'trivial_delay',
      label: 'Trễ nhỏ — không cần hành động lớn',
      expected: 'Trễ <15 phút: không cần thay đổi kế hoạch',
      actual: `Trễ ${trafficDelayMin} phút`,
      pass: true,
      level: 'info',
    });
  }

  return results;
}

// ─── Helpers for incident classification ─────────────────────────────────────

export function classifyRainSeverity(mmPerH: number): IncidentContext['severity'] {
  if (mmPerH < RAIN_LOW_MAX) return 'low';
  if (mmPerH <= RAIN_MEDIUM_MAX) return 'medium';
  return 'high';
}

export function classifyTrafficSeverity(delayMin: number): IncidentContext['severity'] {
  if (delayMin < TRAFFIC_LOW_MAX) return 'low';
  if (delayMin <= TRAFFIC_MEDIUM_MAX) return 'medium';
  return 'high';
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface EvaluatorInput {
  tripId: string;
  proposalId: string;
  oldPlan: TripSlot[];
  newPlan: TripSlot[];
  placeMap: Map<number, Place>;
  incident: IncidentContext;
  userState: TripState;
}

export class ReplanEffectivenessEvaluator {
  evaluate(input: EvaluatorInput): EffectivenessReport {
    const { tripId, proposalId, oldPlan, newPlan, placeMap, incident, userState } = input;

    const criteria: CriterionResult[] =
      incident.type === 'rain'
        ? evaluateRain(incident, oldPlan, newPlan, placeMap, userState)
        : evaluateTrafficDelay(incident, oldPlan, newPlan, placeMap, userState);

    const errors   = criteria.filter((c) => c.level === 'error' && !c.pass);
    const warnings = criteria.filter((c) => c.level === 'warning' && !c.pass);
    const passed   = criteria.filter((c) => c.pass).length;
    const passRate = criteria.length > 0 ? passed / criteria.length : 1;
    const overallPass = errors.length === 0;

    const suggestions: string[] = [
      ...errors.map((c)   => `[LỖI] ${c.label}: ${c.expected}`),
      ...warnings.map((c) => `[CẢNH BÁO] ${c.label}: ${c.expected}`),
    ];

    const devNote = overallPass
      ? `✓ Replan hợp lý — sự cố ${incident.type}/${incident.severity}, ${passed}/${criteria.length} tiêu chí đạt`
      : `✗ Replan không đạt ${errors.length} tiêu chí lỗi — xem lại BeamSearch weights cho sự cố ${incident.type}`;

    return {
      tripId,
      proposalId,
      evaluatedAt: new Date().toISOString(),
      incident,
      overallPass,
      passRate,
      criteria,
      suggestions,
      devNote,
    };
  }
}
