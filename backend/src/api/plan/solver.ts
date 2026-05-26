import { Place, TripSlot, ObjectiveWeights } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SoftConstraint {
  type: 'prefer_category' | 'avoid_category' | 'prefer_indoor' | 'prefer_outdoor';
  value: string | number;
  strength: number;
}

export interface DayStart {
  dayIndex: number;
  lat: number;
  lng: number;
  name?: string;
}

export interface SolverContext {
  weights: ObjectiveWeights;
  preferenceVector: number[];
  preferredTagIds: number[];
  softConstraints: SoftConstraint[];
  startDate: Date;
  budgetTotal: number;
  hotelPlace?: Place;
  /**
   * Điểm xuất phát mỗi ngày (sân bay/bến xe ngày đầu, khách sạn các ngày sau, hoặc
   * homestay khác mà user đặt). Khi không khai báo cho dayIndex nào → fallback về
   * hotelPlace, rồi mới đến candidates[0] / default.
   */
  dayStarts?: DayStart[];
  /** placeId → boost score từ collaborative filtering (similar users đã rate cao) */
  collaborativeBoosts?: Map<number, number>;
  /** Cum tu free-text mo ta trai nghiem do NLU trich (vd "muc nuong", "hoang hon") */
  experienceKeywords?: string[];
}

/** Lookup point xuất phát của một ngày. dayStarts > hotelPlace > null. */
export function resolveDayStart(
  ctx: SolverContext,
  dayIndex: number,
): { lat: number; lng: number } | null {
  if (ctx.dayStarts) {
    const ds = ctx.dayStarts.find((d) => d.dayIndex === dayIndex);
    if (ds && Number.isFinite(ds.lat) && Number.isFinite(ds.lng)) {
      return { lat: ds.lat, lng: ds.lng };
    }
  }
  if (
    ctx.hotelPlace?.lat != null &&
    ctx.hotelPlace?.lng != null
  ) {
    return { lat: ctx.hotelPlace.lat, lng: ctx.hotelPlace.lng };
  }
  return null;
}

export interface PlacePeakTime {
  startTime: string | Date; // 'HH:MM' or Date
  endTime:   string | Date;
  emptinessLevel: number;   // [0,1] — 1 = vắng, 0 = đông
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DAY_START_MIN  = 8 * 60;
const DAY_END_MIN    = 20 * 60;
const LUNCH_TARGET   = 12 * 60;
const LUNCH_WINDOW   = 90;
const DINNER_TARGET  = 18 * 60;
const DINNER_WINDOW  = 90;
const TRAVEL_BUFFER  = 5;
const URBAN_KMH      = 25;
const FOOD_TAG_ID    = 4;
const DIVERSITY_LOOKBACK = 2;
const DEFAULT_WEIGHTS = {
  wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1,
};
// ─── Geo helpers ────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function travelTimeMin(km: number): number {
  return Math.ceil((km / URBAN_KMH) * 60) + TRAVEL_BUFFER;
}

// ─── Place helpers ──────────────────────────────────────────────────────────

function getPlaceTagIds(place: any): number[] {
  if (Array.isArray(place.tagIds)) return place.tagIds.filter((x: any) => typeof x === 'number');
  if (Array.isArray(place.tags)) {
    return place.tags
      .map((t: any) => (typeof t === 'object' ? (t.tagId ?? t.tag_id) : t))
      .filter((x: any) => typeof x === 'number');
  }
  return [];
}

function isFoodPlace(place: any): boolean {
  return getPlaceTagIds(place).includes(FOOD_TAG_ID);
}

// ─── Vietnamese diacritic-insensitive matching ──────────────────────────────
// NFD KHONG decompose đ/Đ → phai xu ly tay
export function stripAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Dem so cum experienceKeywords xuat hien trong place.name + place.description.
 * Khop accent-insensitive, lowercase. Tra ve raw count - caller nhan trong so.
 */
export function descriptionMatchScore(place: any, kws?: string[]): number {
  if (!kws || kws.length === 0) return 0;
  const haystack = stripAccents(`${place.name ?? ''} ${place.description ?? ''}`);
  if (!haystack.trim()) return 0;
  let hits = 0;
  for (const k of kws) {
    if (!k) continue;
    if (haystack.includes(stripAccents(k))) hits++;
  }
  return hits;
}

function parseHM(t: any): [number, number] {
  if (t == null) return [0, 0];
  if (t instanceof Date) return [t.getUTCHours(), t.getUTCMinutes()];
  const s = String(t);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return [parseInt(m[1]!, 10), parseInt(m[2]!, 10)];
  return [0, 0];
}

/**
 * Tính emptiness trung bình của place trong khoảng [startMin, endMin] dựa vào
 * place_peak_time. Trả về 0.5 (neutral) nếu không có data.
 *
 * emptiness gần 1 → vắng người (tốt). Gần 0 → đông (tệ).
 */
function avgEmptiness(peakTimes: PlacePeakTime[] | undefined, startMin: number, endMin: number): number {
  if (!peakTimes || peakTimes.length === 0) return 0.5;
  const visitMin = Math.max(1, endMin - startMin);
  let weighted = 0;
  let coverage = 0;
  for (const pt of peakTimes) {
    const [sh, sm] = parseHM(pt.startTime);
    const [eh, em] = parseHM(pt.endTime);
    const ptStart = sh * 60 + sm;
    const ptEnd   = eh * 60 + em;
    const overlap = Math.max(0, Math.min(endMin, ptEnd) - Math.max(startMin, ptStart));
    if (overlap > 0) {
      weighted += pt.emptinessLevel * overlap;
      coverage += overlap;
    }
  }
  if (coverage === 0) return 0.5;
  // Phần không cover gán neutral 0.5
  const uncovered = Math.max(0, visitMin - coverage);
  return (weighted + 0.5 * uncovered) / visitMin;
}

function isOpenAt(place: any, dayOfWeek: number, startMin: number, endMin: number): boolean {
  const hours = place.openingHours;
  if (!hours || hours.length === 0) return true; // unknown → assume open
  const slot = hours.find((h: any) => Number(h.dayOfWeek ?? h.day_of_week) === dayOfWeek);
  if (!slot) return false;
  const [oh, om] = parseHM(slot.openTime ?? slot.open_time);
  const [ch, cm] = parseHM(slot.closeTime ?? slot.close_time);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  return startMin >= openMin && endMin <= closeMin;
}

// ─── Vietnam timezone helpers ────────────────────────────────────────────────

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Day-of-week in VN local time (UTC+7). DB convention: 0=Mon..6=Sun.
 * date is a UTC midnight of the day — add 7h to get VN calendar day before reading getUTCDay().
 */
function dayOfWeekVN(utcMidnight: Date): number {
  const vnDate = new Date(utcMidnight.getTime() + VN_OFFSET_MS);
  return (vnDate.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
}

// ─── Scoring components ─────────────────────────────────────────────────────

function interestScore(place: any, ctx: SolverContext): number {
  const tagIds = getPlaceTagIds(place);
  if (tagIds.length === 0) return 0;

  const vec = ctx.preferenceVector;
  const sumVec = vec.reduce((a, b) => a + b, 0);

  if (vec.length >= 10 && sumVec > 0) {
    let s = 0;
    for (const t of tagIds) {
      if (t >= 1 && t <= 10) s += vec[t - 1] ?? 0;
    }
    return s / Math.sqrt(tagIds.length);
  }

  if (ctx.preferredTagIds.length > 0) {
    const overlap = tagIds.filter((t) => ctx.preferredTagIds.includes(t)).length;
    return overlap / Math.max(1, ctx.preferredTagIds.length);
  }

  return 0.3;
}

function softConstraintAdjust(place: any, ctx: SolverContext): number {
  let adj = 0;
  const tagIds = getPlaceTagIds(place);
  for (const sc of ctx.softConstraints) {
    if (sc.type === 'avoid_category') {
      const target = Number(sc.value);
      if (Number.isFinite(target) && tagIds.includes(target)) adj -= sc.strength * 5;
    } else if (sc.type === 'prefer_category') {
      const target = typeof sc.value === 'number' ? sc.value : Number(sc.value);
      if (Number.isFinite(target) && tagIds.includes(target)) adj += sc.strength * 3;
    } else if (sc.type === 'prefer_indoor') {
      if (place.indoorOutdoor === 'indoor') adj += sc.strength * 2;
    } else if (sc.type === 'prefer_outdoor') {
      if (place.indoorOutdoor === 'outdoor') adj += sc.strength * 2;
    }
  }
  return adj;
}

function diversityPenalty(place: any, recentTagIds: number[]): number {
  if (recentTagIds.length === 0) return 0;
  const tagIds = getPlaceTagIds(place);
  const overlap = tagIds.filter((t) => recentTagIds.includes(t)).length;
  return overlap * 1.5;
}

interface DayState {
  currentTimeMin: number;
  currentLat: number;
  currentLng: number;
  budgetRemaining: number;
  visitedPlaceIds: Set<string>;
  lastTagIds: number[];
  lunchDone: boolean;
  dinnerDone: boolean;
  dayOfWeek: number;
}

// ─── Explanation types ────────────────────────────────────────────────────────

export interface ScoreComponentRaw {
  name: string;
  raw: number;
  weighted: number;
}

export interface ScoreExplanation {
  components: Array<ScoreComponentRaw & { label: string; detail?: string }>;
  totalScore: number;
  rank: number;
  poolSize: number;
  topRunnerUp?: {
    placeId: string;
    name: string;
    totalScore: number;
    mainLoss: string;
  };
  summary: string;
}

export interface OrderExplanation {
  swapApplied: boolean;
  greedyOriginalPosition: number;
  finalPosition: number;
  trigger: '2opt' | null;
  delta: {
    scoreBefore: number;
    scoreAfter: number;
    mainGain: string;
    mainTradeoff?: string;
  } | null;
  orderText: string | null;
}

export interface EnrichedSlot extends TripSlot {
  scoreExplanation?: ScoreExplanation;
  orderExplanation?: OrderExplanation;
}

interface ScoreResult {
  feasible: boolean;
  score: number;
  travelMin: number;
  arrivalMin: number;
  endMin: number;
  cost: number;
  duration: number;
  breakdown: ScoreComponentRaw[];
}

const NOT_FEASIBLE: ScoreResult = {
  feasible: false, score: -Infinity, travelMin: 0, arrivalMin: 0, endMin: 0, cost: 0, duration: 0,
  breakdown: [],
};

function scoreCandidate(
  place: any,
  ctx: SolverContext,
  st: DayState,
  mode: 'meal' | 'sightseeing'
): ScoreResult {
  if (st.visitedPlaceIds.has(String(place.placeId))) return NOT_FEASIBLE;
  if (place.lat == null || place.lng == null) return NOT_FEASIBLE;
  if (mode === 'meal' && !isFoodPlace(place)) return NOT_FEASIBLE;
  if (mode === 'sightseeing' && isFoodPlace(place) && getPlaceTagIds(place).length === 1) {
    return NOT_FEASIBLE;
  }

  const distKm = haversineKm(st.currentLat, st.currentLng, place.lat, place.lng);
  const travelMin = travelTimeMin(distKm);
  const arrival = st.currentTimeMin + travelMin;
  const duration = mode === 'meal'
    ? Math.min(place.avgVisitDurationMin || 60, 75)
    : (place.avgVisitDurationMin || 60);
  const endMin = arrival + duration;

  if (endMin > DAY_END_MIN) return NOT_FEASIBLE;
  if (!isOpenAt(place, st.dayOfWeek, arrival, endMin)) return NOT_FEASIBLE;

  const cost = place.minPrice || 0;
  if (cost > st.budgetRemaining) return NOT_FEASIBLE;

  const w = ctx.weights ?? DEFAULT_WEIGHTS;
  const interest = interestScore(place, ctx);
  const expMatch = descriptionMatchScore(place, ctx.experienceKeywords);
  const popularity = place.popularityScore ?? 0;
  const terrain = place.terrainEasiness ?? 1;
  const empt = avgEmptiness(place.peakTimes as PlacePeakTime[] | undefined, arrival, endMin);
  const softAdj = softConstraintAdjust(place, ctx);
  const divPen = diversityPenalty(place, st.lastTagIds);

  let cfRaw = 0;
  if (ctx.collaborativeBoosts) {
    const cf = ctx.collaborativeBoosts.get(Number(place.placeId));
    if (cf && cf > 0) cfRaw = Math.min(cf, 5) * 1.5;
  }

  const budgetRatio = cost / Math.max(1, ctx.budgetTotal);
  const interestW      = w.wInterest * interest * 10;
  const expMatchW      = 8 * expMatch;
  const popularityW    = 0.3 * popularity;
  const distanceW      = -(w.wDistance * distKm * 0.5);
  const terrainW       = -(w.wRisk * (1 - terrain) * 5);
  const budgetW        = -(w.wBudget * budgetRatio * 5);
  const softW          = softAdj;
  const diversityW     = -divPen;
  const collaborativeW = cfRaw;
  const peakTimeW      = (empt - 0.5) * 4;
  const mealW          = mode === 'meal' ? 15 : 0;
  const anchorW        = place.isAnchor ? 1000 : 0;

  const score = interestW + expMatchW + popularityW + distanceW + terrainW +
    budgetW + softW + diversityW + collaborativeW + peakTimeW + mealW + anchorW;

  const breakdown: ScoreComponentRaw[] = [
    { name: 'interest',       raw: interest,    weighted: interestW },
    { name: 'experienceMatch', raw: expMatch,   weighted: expMatchW },
    { name: 'popularity',     raw: popularity,  weighted: popularityW },
    { name: 'distance',       raw: distKm,      weighted: distanceW },
    { name: 'terrain',        raw: 1 - terrain, weighted: terrainW },
    { name: 'budget',         raw: budgetRatio, weighted: budgetW },
    { name: 'softConstraint', raw: 1,           weighted: softW },
    { name: 'diversity',      raw: 1,           weighted: diversityW },
    { name: 'collaborative',  raw: cfRaw,       weighted: collaborativeW },
    { name: 'peakTime',       raw: empt - 0.5,  weighted: peakTimeW },
    { name: 'meal',           raw: 1,           weighted: mealW },
    { name: 'anchor',         raw: 1,           weighted: anchorW },
  ];

  return { feasible: true, score, travelMin, arrivalMin: arrival, endMin, cost, duration, breakdown };
}

function pickMode(st: DayState): 'meal' | 'sightseeing' {
  if (!st.lunchDone) {
    const cur = st.currentTimeMin;
    if (cur >= LUNCH_TARGET - LUNCH_WINDOW && cur <= LUNCH_TARGET + LUNCH_WINDOW) return 'meal';
    if (cur > LUNCH_TARGET + LUNCH_WINDOW) st.lunchDone = true; // missed window, give up
  }
  if (!st.dinnerDone) {
    const cur = st.currentTimeMin;
    if (cur >= DINNER_TARGET - DINNER_WINDOW && cur <= DINNER_TARGET + DINNER_WINDOW) return 'meal';
  }
  return 'sightseeing';
}

// ─── Explanation template engine ─────────────────────────────────────────────

const COMPONENT_LABELS: Record<string, string> = {
  interest:        'Phù hợp sở thích',
  experienceMatch: 'Khớp trải nghiệm',
  popularity:      'Được nhiều người thích',
  distance:        'Khoảng cách',
  terrain:         'Độ khó địa hình',
  budget:          'Chi phí',
  softConstraint:  'Phù hợp mong muốn',
  diversity:       'Đa dạng thể loại',
  collaborative:   'Người tương tự thích',
  peakTime:        'Giờ vắng',
  anchor:          'Địa điểm bạn ghim',
  meal:            'Phù hợp giờ ăn',
};

function generateComponentDetail(c: ScoreComponentRaw, place: any): string | undefined {
  if (c.weighted === 0) return undefined;
  switch (c.name) {
    case 'interest': {
      const count = getPlaceTagIds(place).length;
      return count > 0 ? `Khớp ${count} tag sở thích` : undefined;
    }
    case 'distance':
      return c.raw > 0 ? `${c.raw.toFixed(1)} km từ điểm trước` : undefined;
    case 'peakTime':
      return c.raw > 0.1 ? 'Giờ vắng khách' : c.raw < -0.1 ? 'Giờ đông khách' : undefined;
    case 'experienceMatch':
      return c.raw > 0 ? `Khớp ${c.raw} từ khoá trải nghiệm` : undefined;
    default:
      return undefined;
  }
}

function describeMainDifference(
  chosenBreakdown: ScoreComponentRaw[],
  runnerUpBreakdown: ScoreComponentRaw[],
): string {
  const ruMap = new Map(runnerUpBreakdown.map(c => [c.name, c]));
  let maxDiff = 0;
  let result = 'Điểm tổng thể thấp hơn';
  for (const c of chosenBreakdown) {
    const ru = ruMap.get(c.name);
    if (!ru) continue;
    const diff = c.weighted - ru.weighted;
    if (diff <= maxDiff) continue;
    maxDiff = diff;
    switch (c.name) {
      case 'distance': {
        const extraKm = ru.raw - c.raw;
        result = extraKm > 0 ? `Xa hơn ${extraKm.toFixed(1)} km` : 'Điểm khoảng cách thấp hơn';
        break;
      }
      case 'interest':   result = 'Kém phù hợp sở thích hơn'; break;
      case 'popularity': result = 'Ít được đánh giá cao hơn'; break;
      case 'peakTime':   result = 'Đông khách hơn'; break;
      case 'budget':     result = 'Chi phí cao hơn'; break;
      case 'terrain':    result = 'Địa hình khó hơn'; break;
      default:           result = `Điểm ${COMPONENT_LABELS[c.name] ?? c.name} thấp hơn`;
    }
  }
  return result;
}

function generateSummary(components: ScoreExplanation['components']): string {
  const top = components
    .filter(c => c.weighted > 0)
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 3);
  return top.map(c => c.label).join(' · ') || 'Phù hợp lịch trình';
}

// ─── Greedy planner ─────────────────────────────────────────────────────────

export function generateGreedyPlan(
  days: number,
  candidates: Place[],
  ctx: SolverContext
): EnrichedSlot[] {
  const plan: EnrichedSlot[] = [];
  const visitedPlaceIds = new Set<string>();
  let budgetRemaining = ctx.budgetTotal;

  // Build VN midnight in UTC: startDate is parsed as "YYYY-MM-DD" → UTC midnight.
  // VN midnight (00:00 VN) = UTC midnight − 7 h.
  const startDate = new Date(ctx.startDate);
  startDate.setUTCHours(0, 0, 0, 0);
  const startVNMidnightUTC = new Date(startDate.getTime() - VN_OFFSET_MS);

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const dayUTCMidnight = new Date(startDate.getTime() + dayIndex * 86_400_000);
    const dayStart = resolveDayStart(ctx, dayIndex);
    const st: DayState = {
      currentTimeMin: DAY_START_MIN,
      currentLat: dayStart?.lat ?? candidates[0]?.lat ?? 16.06,
      currentLng: dayStart?.lng ?? candidates[0]?.lng ?? 108.22,
      budgetRemaining,
      visitedPlaceIds,
      lastTagIds: [],
      lunchDone: false,
      dinnerDone: false,
      dayOfWeek: dayOfWeekVN(dayUTCMidnight),
    };
    let slotOrder = 1;

    while (st.currentTimeMin < DAY_END_MIN) {
      const mode = pickMode(st);

      let bestPlace: Place | null = null;
      let best: ScoreResult = NOT_FEASIBLE;
      let runnerUpPlace: Place | null = null;
      let runnerUp: ScoreResult = NOT_FEASIBLE;
      let poolSize = 0;

      for (const place of candidates) {
        const r = scoreCandidate(place, ctx, st, mode);
        if (!r.feasible) continue;
        poolSize++;
        if (r.score > best.score) {
          runnerUp = best; runnerUpPlace = bestPlace;
          best = r; bestPlace = place;
        } else if (r.score > runnerUp.score) {
          runnerUp = r; runnerUpPlace = place;
        }
      }

      // If meal mode found nothing, fall through to sightseeing instead of stalling
      if (!bestPlace && mode === 'meal') {
        poolSize = 0;
        for (const place of candidates) {
          const r = scoreCandidate(place, ctx, st, 'sightseeing');
          if (!r.feasible) continue;
          poolSize++;
          if (r.score > best.score) {
            runnerUp = best; runnerUpPlace = bestPlace;
            best = r; bestPlace = place;
          } else if (r.score > runnerUp.score) {
            runnerUp = r; runnerUpPlace = place;
          }
        }
      }

      if (!bestPlace) break;

      // arrivalMin is VN local minutes from midnight → convert to UTC
      const slotStart = new Date(
        startVNMidnightUTC.getTime() + dayIndex * 86_400_000 + best.arrivalMin * 60_000,
      );
      const slotEnd = new Date(slotStart.getTime() + best.duration * 60_000);

      const activityType = mode === 'meal' ? 'meal' : 'sightseeing';

      const components = best.breakdown.map(c => ({
        ...c,
        label: COMPONENT_LABELS[c.name] ?? c.name,
        detail: generateComponentDetail(c, bestPlace!),
      }));

      const scoreExplanation: ScoreExplanation = {
        components,
        totalScore: best.score,
        rank: 1,
        poolSize,
        topRunnerUp: runnerUpPlace && runnerUp.feasible ? {
          placeId: String(runnerUpPlace.placeId),
          name: (runnerUpPlace as any).name ?? String(runnerUpPlace.placeId),
          totalScore: runnerUp.score,
          mainLoss: describeMainDifference(best.breakdown, runnerUp.breakdown),
        } : undefined,
        summary: generateSummary(components),
      };

      plan.push({
        slotId: `slot_${dayIndex}_${slotOrder}`,
        tripId: 'temp_trip',
        dayIndex,
        slotOrder,
        version: 1,
        placeId: bestPlace.placeId,
        plannedStart: slotStart.toISOString(),
        plannedEnd: slotEnd.toISOString(),
        actualStart: null,
        actualEnd: null,
        estimatedCost: best.cost,
        activityType,
        rationale: `score=${best.score.toFixed(2)} mode=${mode}`,
        status: 'planned',
        scoreExplanation,
        orderExplanation: {
          swapApplied: false,
          greedyOriginalPosition: plan.length,
          finalPosition: plan.length,
          trigger: null,
          delta: null,
          orderText: null,
        },
      });

      visitedPlaceIds.add(String(bestPlace.placeId));
      st.currentTimeMin = best.endMin;
      st.currentLat = bestPlace.lat ?? st.currentLat;
      st.currentLng = bestPlace.lng ?? st.currentLng;
      st.budgetRemaining -= best.cost;
      budgetRemaining = st.budgetRemaining;

      const newTags = getPlaceTagIds(bestPlace);
      st.lastTagIds = [...newTags, ...st.lastTagIds].slice(0, DIVERSITY_LOOKBACK * 3);

      if (mode === 'meal') {
        if (!st.lunchDone && st.currentTimeMin <= LUNCH_TARGET + LUNCH_WINDOW + 60) {
          st.lunchDone = true;
        } else {
          st.dinnerDone = true;
        }
      }

      slotOrder++;
    }
  }

  return plan;
}

// ─── Itinerary scoring (used by 2-opt) ──────────────────────────────────────

function findPlace(placeId: number, candidates: Place[]): Place | undefined {
  return candidates.find((p) => p.placeId === placeId);
}

export function calculateItineraryScore(
  slots: TripSlot[],
  ctx: SolverContext,
  candidates: Place[]
): number {
  let total = 0;
  let cumCost = 0;

  for (let i = 0; i < slots.length; i++) {
    const place = findPlace(slots[i]!.placeId, candidates);
    if (!place) continue;

    const w = ctx.weights ?? DEFAULT_WEIGHTS;
    let s = 0;

    s += w.wInterest * interestScore(place, ctx) * 10;
    s += 8 * descriptionMatchScore(place, ctx.experienceKeywords);
    s += 0.3 * (place.popularityScore as number ?? 0);
    s += softConstraintAdjust(place, ctx);
    s -= w.wRisk * (1 - ((place.terrainEasiness as number) ?? 1)) * 5;

    if (i > 0) {
      const prev = findPlace(slots[i - 1]!.placeId, candidates);
      if (prev && prev.lat != null && place.lat != null) {
        const km = haversineKm(prev.lat, prev.lng, place.lat, place.lng);
        s -= w.wDistance * km * 0.5;
      }
    }

    cumCost += place.minPrice ?? 0;
    if (cumCost > ctx.budgetTotal) {
      s -= w.wBudget * 50;
    }

    total += s;
  }

  return total;
}

// ─── Route distance helper (used by 2-opt swap log) ─────────────────────────

function routeDistanceForDay(slots: TripSlot[], dayIndex: number, candidates: Place[]): number {
  const daySlots = slots.filter(s => s.dayIndex === dayIndex);
  let total = 0;
  for (let k = 1; k < daySlots.length; k++) {
    const prev = findPlace(daySlots[k - 1]!.placeId, candidates);
    const cur = findPlace(daySlots[k]!.placeId, candidates);
    if (prev?.lat != null && cur?.lat != null) {
      total += haversineKm(prev.lat, prev.lng!, cur.lat, cur.lng!);
    }
  }
  return total;
}

// ─── 2-opt local search ─────────────────────────────────────────────────────

/**
 * Re-time slots trong cùng một ngày: lấy giờ bắt đầu của slot đầu tiên trong ngày
 * làm anchor, rồi cascade: arrival = prev.end + travelTime(prev → cur), end =
 * arrival + duration(cur).
 *
 * Sau đó validate opening hours + day-end. Trả null nếu plan vi phạm hard
 * constraint → 2-opt sẽ bỏ swap đó.
 */
function retimeAndValidate(
  slots: TripSlot[],
  ctx: SolverContext,
  candidates: Place[]
): TripSlot[] | null {
  if (slots.length === 0) return slots;

  const startDateUTC = new Date(ctx.startDate);
  startDateUTC.setUTCHours(0, 0, 0, 0);
  const startVNMidnight = new Date(startDateUTC.getTime() - VN_OFFSET_MS);

  const out: TripSlot[] = [];
  let prevPlace: Place | null = null;
  let curMin = 0;
  let curDay = -1;

  for (const slot of slots) {
    const place = findPlace(slot.placeId, candidates);
    if (!place || place.lat == null || place.lng == null) {
      return null; // candidate biến mất hoặc thiếu toạ độ
    }

    if (slot.dayIndex !== curDay) {
      // Bắt đầu ngày mới: anchor theo giờ VN của slot đầu tiên ngày này.
      // plannedStart là UTC → cộng VN_OFFSET để lấy giờ VN local.
      const orig = new Date(slot.plannedStart);
      const vnMs = orig.getTime() + VN_OFFSET_MS;
      const vnDate = new Date(vnMs);
      curMin = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();
      curDay = slot.dayIndex;
      const ds = resolveDayStart(ctx, slot.dayIndex);
      prevPlace = ds
        ? ({ lat: ds.lat, lng: ds.lng } as Place)
        : (ctx.hotelPlace ?? null);
    }

    let arrivalMin = curMin;
    if (prevPlace && prevPlace.lat != null && prevPlace.lng != null) {
      const km = haversineKm(prevPlace.lat, prevPlace.lng, place.lat, place.lng);
      arrivalMin += travelTimeMin(km);
    }

    const duration = (place as any).avgVisitDurationMin ?? 60;
    const endMin = arrivalMin + duration;

    if (endMin > DAY_END_MIN) return null;

    const dayUTCMidnight = new Date(startDateUTC.getTime() + slot.dayIndex * 86_400_000);
    const dow = dayOfWeekVN(dayUTCMidnight);
    if (!isOpenAt(place, dow, arrivalMin, endMin)) return null;

    // arrivalMin là giờ VN local → UTC = VN midnight + arrivalMin phút
    const slotStart = new Date(startVNMidnight.getTime() + slot.dayIndex * 86_400_000 + arrivalMin * 60_000);
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

    out.push({
      ...slot,
      plannedStart: slotStart.toISOString(),
      plannedEnd:   slotEnd.toISOString(),
    });

    curMin = endMin;
    prevPlace = place;
  }

  return out;
}

export function optimizeWith2Opt(
  initialSlots: EnrichedSlot[],
  ctx: SolverContext,
  candidates: Place[]
): EnrichedSlot[] {
  // Record greedy original placeId order before any swaps
  const greedyOrder = initialSlots.map(s => s.placeId);

  interface SwapRecord {
    i: number;
    j: number;
    affectedPlaceIds: number[];
    scoreBefore: number;
    scoreAfter: number;
    distanceDeltaKm: number;
  }
  const swapLog: SwapRecord[] = [];

  let bestSlots = [...initialSlots] as EnrichedSlot[];
  let bestScore = calculateItineraryScore(bestSlots, ctx, candidates);
  let improved = true;
  let iterations = 0;
  const MAX_ITER = 50;

  while (improved && iterations < MAX_ITER) {
    improved = false;
    iterations++;

    for (let i = 1; i < bestSlots.length - 1; i++) {
      for (let j = i + 1; j < bestSlots.length; j++) {
        if (bestSlots[i]!.dayIndex !== bestSlots[j]!.dayIndex) continue;

        const swapped = [
          ...bestSlots.slice(0, i),
          ...bestSlots.slice(i, j + 1).reverse(),
          ...bestSlots.slice(j + 1),
        ] as EnrichedSlot[];

        // Re-time + validate hard constraints. Enrichment fields are preserved via spread.
        const newSlots = retimeAndValidate(swapped, ctx, candidates) as EnrichedSlot[] | null;
        if (!newSlots) continue;

        const newScore = calculateItineraryScore(newSlots, ctx, candidates);
        if (newScore > bestScore) {
          const dayIdx = bestSlots[i]!.dayIndex;
          swapLog.push({
            i, j,
            affectedPlaceIds: bestSlots.slice(i, j + 1).map(s => s.placeId),
            scoreBefore: bestScore,
            scoreAfter: newScore,
            distanceDeltaKm:
              routeDistanceForDay(bestSlots, dayIdx, candidates) -
              routeDistanceForDay(newSlots, dayIdx, candidates),
          });
          bestSlots = newSlots;
          bestScore = newScore;
          improved = true;
        }
      }
    }
  }

  const orderByDay = new Map<number, number>();
  bestSlots = bestSlots.map((s) => {
    const next = (orderByDay.get(s.dayIndex) ?? 0) + 1;
    orderByDay.set(s.dayIndex, next);
    return { ...s, slotOrder: next };
  });

  // Build OrderExplanation for each slot
  bestSlots = bestSlots.map((slot, finalIdx) => {
    const greedyIdx = greedyOrder.indexOf(slot.placeId);
    const swapApplied = greedyIdx >= 0 && finalIdx !== greedyIdx;
    const relevantSwaps = swapLog.filter(sw => sw.affectedPlaceIds.includes(slot.placeId));

    let delta: OrderExplanation['delta'] = null;
    if (swapApplied && relevantSwaps.length > 0) {
      const totalDistSaved = relevantSwaps.reduce((sum, sw) => sum + sw.distanceDeltaKm, 0);
      const lastSwap = relevantSwaps[relevantSwaps.length - 1]!;
      const mainGain = totalDistSaved > 0.1
        ? `Giảm ${totalDistSaved.toFixed(1)} km quãng đường`
        : `Tăng ${(lastSwap.scoreAfter - lastSwap.scoreBefore).toFixed(1)} điểm`;
      delta = {
        scoreBefore: lastSwap.scoreBefore,
        scoreAfter:  lastSwap.scoreAfter,
        mainGain,
      };
    }

    const from = greedyIdx >= 0 ? greedyIdx : finalIdx;
    const orderText = swapApplied && delta
      ? `Đổi từ #${from + 1} → #${finalIdx + 1}: ${delta.mainGain}`
      : null;

    return {
      ...slot,
      orderExplanation: {
        swapApplied,
        greedyOriginalPosition: from,
        finalPosition: finalIdx,
        trigger: swapApplied && relevantSwaps.length > 0 ? '2opt' as const : null,
        delta,
        orderText,
      },
    };
  });

  return bestSlots;
}

// ─── Strict-mode planner (user-picked places, geo-clustered per day) ────────

// Cap số điểm theo loại hoạt động cho mỗi ngày. Khoá là tag_id (xem bảng
// place_tag): 1=beach, 2=mountain, 3=culture, 4=food, 5=spiritual, 6=shopping,
// 7=entertainment, 8=nature, 9=sport, 10=landmark.
const STRICT_MODE_TAG_CAPS_BY_ID: Record<number, number> = {
  1: 2,   // beach — phơi nắng nhiều quá mệt
  2: 1,   // mountain — leo núi tốn cả ngày
  3: 3,   // culture
  4: 3,   // food — 3 bữa chính
  5: 3,   // spiritual
  6: 2,   // shopping
  7: 2,   // entertainment
  8: 2,   // nature
  9: 1,   // sport
  10: 4,  // landmark — chụp ảnh nhanh, có thể nhiều
};
const STRICT_MODE_DEFAULT_TAG_CAP = 3;
// Phạt mỗi lần vượt cap = bao nhiêu km travel tương đương trong cost function
const STRICT_MODE_VIOLATION_PENALTY_KM = 50;

function countCapViolations(places: Place[]): number {
  const counts: Record<number, number> = {};
  for (const p of places) {
    const tagIds = ((p as { tagIds?: number[] }).tagIds) ?? [];
    for (const t of tagIds) counts[t] = (counts[t] || 0) + 1;
  }
  let v = 0;
  for (const t of Object.keys(counts)) {
    const cap = STRICT_MODE_TAG_CAPS_BY_ID[Number(t)] ?? STRICT_MODE_DEFAULT_TAG_CAP;
    const c = counts[Number(t)]!;
    if (c > cap) v += c - cap;
  }
  return v;
}

function dayPartitionCost(ordered: Place[], start: number, end: number): number {
  // end is exclusive
  let travel = 0;
  for (let i = start + 1; i < end; i++) {
    travel += haversineKm(
      ordered[i - 1]!.lat, ordered[i - 1]!.lng,
      ordered[i]!.lat, ordered[i]!.lng,
    );
  }
  const violations = countCapViolations(ordered.slice(start, end));
  return travel + violations * STRICT_MODE_VIOLATION_PENALTY_KM;
}

/**
 * DP partition NN-ordered places thành đúng `days` ngày sao cho tổng cost
 * (travel nội ngày + violation penalty) là nhỏ nhất. Cho phép ngày trống nếu
 * places ít hơn days. Trả về mảng cut indices [c1, c2, ...] có độ dài days+1
 * với c0=0 và c_{days}=N; ngày d = ordered[c_d..c_{d+1}-1].
 */
function partitionByDP(ordered: Place[], days: number): number[] {
  const N = ordered.length;
  if (days <= 1) return [0, N];

  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(days + 1).fill(INF));
  const parent: number[][] = Array.from({ length: N + 1 }, () => new Array(days + 1).fill(-1));
  dp[0]![0] = 0;

  for (let d = 1; d <= days; d++) {
    for (let i = 0; i <= N; i++) {
      // ngày thứ d chứa ordered[j..i-1], các ngày trước chứa ordered[0..j-1]
      for (let j = 0; j <= i; j++) {
        const prev = dp[j]![d - 1];
        if (prev === INF) continue;
        const cost = prev + dayPartitionCost(ordered, j, i);
        if (cost < dp[i]![d]!) {
          dp[i]![d] = cost;
          parent[i]![d] = j;
        }
      }
    }
  }

  const cuts: number[] = new Array(days + 1);
  cuts[days] = N;
  let i = N;
  for (let d = days; d > 0; d--) {
    const j = parent[i]![d]!;
    cuts[d - 1] = j;
    i = j;
  }
  return cuts;
}

/**
 * Khi user da chon san anchorPlaceIds, không cần greedy scoring. Nhưng phải:
 *  1. Tính travel-time thật theo haversine (không phải 30 phut hard-code) — tránh
 *     case 2 slot kề nhau cách nhau 80 km mà chỉ buffer 30 phút.
 *  2. Cluster các điểm theo địa lý + cap-per-tag rồi phân ra `days` ngày — DP
 *     chọn split tối thiểu hoá (travel nội ngày + violation penalty). Tag cap
 *     tránh nhồi 4 bữa ăn vào 1 ngày, đồng thời geometry giữ các cụm gần nhau.
 *  3. Trong từng ngày, sort lại theo nearest-neighbor từ dayStart để rút quãng đi.
 *  4. Roll over nếu vượt DAY_END_MIN — phòng case cụm quá to.
 *
 * Trả về danh sách slot đã sẵn sàng để insert vào DB.
 */
export function buildStrictModeSlots(
  anchorPlaceIds: number[],
  candidates: Place[],
  days: number,
  ctx: { startDate: Date; dayStarts?: DayStart[]; hotelPlace?: Place },
): Array<{
  slotId: string;
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  placeId: number;
  plannedStart: string;
  plannedEnd: string;
  estimatedCost: number;
  activityType: 'sightseeing';
  rationale: string;
  status: 'planned';
}> {
  const placeMap = new Map(candidates.map((c) => [c.placeId, c]));
  const places = anchorPlaceIds
    .map((id) => placeMap.get(id))
    .filter((p): p is Place => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (places.length === 0) return [];

  const startDateUTC = new Date(ctx.startDate);
  startDateUTC.setUTCHours(0, 0, 0, 0);
  const startVNMidnightUTC = new Date(startDateUTC.getTime() - VN_OFFSET_MS);

  // ── Step 1: Nearest-neighbor order toàn cục từ điểm xuất phát ngày 0 ──────
  const start0 = resolveDayStart({ dayStarts: ctx.dayStarts, hotelPlace: ctx.hotelPlace } as SolverContext, 0)
    ?? { lat: places[0]!.lat, lng: places[0]!.lng };

  const ordered: Place[] = [];
  const pool = [...places];
  let curLat = start0.lat;
  let curLng = start0.lng;
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const d = haversineKm(curLat, curLng, pool[i]!.lat, pool[i]!.lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = pool.splice(bestIdx, 1)[0]!;
    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }

  // ── Step 2: DP partition theo geometry + tag cap ─────────────────────────
  // Tìm cách chia ordered thành `days` ngày sao cho tổng (travel nội ngày +
  // violation penalty cho từng tag vượt cap) là nhỏ nhất. Tự nhiên sẽ:
  //  • cắt ở leg dài để cụm địa lý gần nhau ở cùng ngày
  //  • spread các điểm cùng tag (vd 4 food) ra nhiều ngày khi geometry cho phép
  const targetDays = Math.max(1, days);
  const cuts = partitionByDP(ordered, targetDays);
  const dayOf: number[] = new Array(ordered.length);
  for (let d = 0; d < targetDays; d++) {
    for (let i = cuts[d]!; i < cuts[d + 1]!; i++) dayOf[i] = d;
  }
  const dIdx = targetDays - 1;

  // ── Step 3: Group theo day, sort NN từ dayStart, pack với travel-time thực ─
  const slots: ReturnType<typeof buildStrictModeSlots> = [];
  for (let d = 0; d <= dIdx; d++) {
    const dayPlaces = ordered.filter((_, i) => dayOf[i] === d);
    if (dayPlaces.length === 0) continue;

    const dayStart = resolveDayStart(
      { dayStarts: ctx.dayStarts, hotelPlace: ctx.hotelPlace } as SolverContext,
      d,
    ) ?? { lat: dayPlaces[0]!.lat, lng: dayPlaces[0]!.lng };

    let cLat = dayStart.lat;
    let cLng = dayStart.lng;
    let curMin = DAY_START_MIN;
    let slotOrder = 1;

    const remaining = [...dayPlaces];
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = haversineKm(cLat, cLng, remaining[i]!.lat, remaining[i]!.lng);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      const place = remaining.splice(bestIdx, 1)[0]!;
      const travel = travelTimeMin(bestDist);
      const duration = place.avgVisitDurationMin || 60;

      const arrivalMin = curMin + travel;
      const endMin = arrivalMin + duration;

      const slotStart = new Date(
        startVNMidnightUTC.getTime() + d * 86_400_000 + arrivalMin * 60_000,
      );
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

      slots.push({
        slotId: `slot_${d}_${slotOrder}`,
        tripId: 'temp_trip',
        dayIndex: d,
        slotOrder,
        placeId: place.placeId,
        plannedStart: slotStart.toISOString(),
        plannedEnd: slotEnd.toISOString(),
        estimatedCost: (place as any).minPrice ?? 0,
        activityType: 'sightseeing',
        rationale: 'Điểm do người dùng chọn',
        status: 'planned',
      });

      curMin = endMin;
      cLat = place.lat;
      cLng = place.lng;
      slotOrder++;
    }
  }

  return slots;
}

// ─── I3CH (Iterative Three-Component Heuristic) ─────────────────────────────

export function generateI3CHPlan(
  days: number,
  candidates: Place[],
  ctx: SolverContext,
  options?: { maxIterations?: number; perturbMoves?: number; timeBudgetMs?: number }
): EnrichedSlot[] {
  const maxIterations = options?.maxIterations ?? 15;
  const perturbMoves  = options?.perturbMoves  ?? 3;
  const timeBudgetMs  = options?.timeBudgetMs  ?? 4000;

  // Component 1: Construction
  const initial = generateGreedyPlan(days, candidates, ctx);
  // Component 2: First improvement
  let bestSlots = optimizeWith2Opt(initial, ctx, candidates);
  let bestScore = calculateItineraryScore(bestSlots, ctx, candidates);

  const startTime = Date.now();

  for (let iter = 0; iter < maxIterations; iter++) {
    if (Date.now() - startTime > timeBudgetMs) break;

    // Component 3: Perturbation — xáo trộn bản sao của bestSlots
    let perturbed = bestSlots.map((s) => ({ ...s }));

    for (let m = 0; m < perturbMoves; m++) {
      // Thử tối đa 3 lần mỗi move để tìm perturbation hợp lệ
      let moved = false;
      for (let attempt = 0; attempt < 3 && !moved; attempt++) {
        const op = Math.floor(Math.random() * 3);
        const candidate = applyPerturbation(perturbed, candidates, op);
        if (candidate) {
          perturbed = candidate;
          moved = true;
        }
      }
    }

    // Sắp xếp lại sau perturbation (Or-opt có thể thay đổi dayIndex)
    perturbed.sort((a, b) =>
      a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : a.slotOrder - b.slotOrder
    );

    const retimed = retimeAndValidate(perturbed, ctx, candidates) as EnrichedSlot[] | null;
    if (!retimed) continue;

    // Component 2 lại: Re-improvement sau perturbation
    const reImproved = optimizeWith2Opt(retimed, ctx, candidates);
    const reScore    = calculateItineraryScore(reImproved, ctx, candidates);

    if (reScore > bestScore) {
      bestSlots = reImproved;
      bestScore = reScore;
    }
    // Luôn restart từ bestSlots (không phải perturbed) — I3CH restart strategy
  }

  return bestSlots;
}

function applyPerturbation(
  slots: TripSlot[],
  candidates: Place[],
  op: number
): TripSlot[] | null {
  if (slots.length < 2) return null;

  // Các slot có thể xáo trộn (bỏ qua anchor places)
  const mutableIdx = slots
    .map((_, i) => i)
    .filter((i) => !(candidates.find((c) => c.placeId === slots[i]!.placeId) as any)?.isAnchor);

  if (mutableIdx.length < 1) return null;

  const result = slots.map((s) => ({ ...s }));

  if (op === 0) {
    // Swap ngẫu nhiên 2 slot cùng ngày
    const sameDay = (i: number, j: number) => result[i]!.dayIndex === result[j]!.dayIndex;
    const pairs: [number, number][] = [];
    for (let a = 0; a < mutableIdx.length; a++) {
      for (let b = a + 1; b < mutableIdx.length; b++) {
        if (sameDay(mutableIdx[a]!, mutableIdx[b]!)) pairs.push([mutableIdx[a]!, mutableIdx[b]!]);
      }
    }
    if (pairs.length === 0) return null;
    const [i, j] = pairs[Math.floor(Math.random() * pairs.length)]!;
    [result[i], result[j]] = [result[j]!, result[i]!];
    return result;
  }

  if (op === 1) {
    // Or-opt: dời 1 slot sang vị trí khác (cùng hoặc khác ngày)
    if (mutableIdx.length < 1) return null;
    const fromIdx = mutableIdx[Math.floor(Math.random() * mutableIdx.length)]!;
    const moved   = result.splice(fromIdx, 1)[0]!;
    const toIdx   = Math.floor(Math.random() * result.length);
    // Gán dayIndex theo slot xung quanh nơi chèn
    const neighbor = result[toIdx] ?? result[result.length - 1];
    if (neighbor) moved.dayIndex = neighbor.dayIndex;
    result.splice(toIdx, 0, moved);
    // Renumber slotOrder theo ngày
    const orderMap = new Map<number, number>();
    for (const s of result) {
      const next = (orderMap.get(s.dayIndex) ?? 0) + 1;
      orderMap.set(s.dayIndex, next);
      s.slotOrder = next;
    }
    return result;
  }

  // op === 2: Thay thế địa điểm bằng candidate chưa ghé thăm ngày đó
  if (mutableIdx.length < 1) return null;
  const targetIdx  = mutableIdx[Math.floor(Math.random() * mutableIdx.length)]!;
  const targetSlot = result[targetIdx]!;
  const dayPlaceIds = new Set(
    result.filter((s) => s.dayIndex === targetSlot.dayIndex).map((s) => s.placeId)
  );
  const pool = candidates.filter(
    (c) => !dayPlaceIds.has(c.placeId) && c.lat != null && !(c as any).isAnchor
  );
  if (pool.length === 0) return null;
  const replacement = pool[Math.floor(Math.random() * pool.length)]!;
  result[targetIdx] = {
    ...targetSlot,
    placeId:       replacement.placeId,
    estimatedCost: (replacement as any).minPrice ?? 0,
    activityType:  'sightseeing',
    rationale:     `i3ch-replace`,
  };
  return result;
}
