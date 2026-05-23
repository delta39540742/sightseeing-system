import type { TripState, TripSlot, Place, UserPreference } from '@app/types';
import type { TrajectoryCache } from './TrajectoryCache';
import { computePlanHash } from './TrajectoryCache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum feasible fatigue level (inclusive). Above this the state is infeasible. */
const FATIGUE_CAP = 0.95;

/** Assumed active hours per day in minutes (used for context only). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DAY_LENGTH_MIN = 12 * 60;

/** Road-network correction factor applied to straight-line Haversine distance. */
const ROAD_NETWORK_FACTOR = 1.4;

/** Assumed average travel speed in km/h. */
const AVG_SPEED_KMH = 25;

/** Earth radius in km (WGS-84 mean). */
const EARTH_RADIUS_KM = 6371;


// ---------------------------------------------------------------------------
// Public context interfaces (not in @app/types — defined here)
// ---------------------------------------------------------------------------

/**
 * Weather snapshot at the time a slot is visited.
 */
export interface WeatherSnapshot {
  /** Rain intensity in mm/hour. */
  rainMmPerH: number;
}

/**
 * All contextual data needed by {@link StateEvolver.evolve} for one slot
 * transition. Constructed by {@link StateEvolver.buildEvolveContext} during
 * trajectory simulation, or supplied directly by callers in tests.
 */
export interface EvolveContext {
  /**
   * Actual visit duration in minutes.
   * Falls back to {@link Place.avgVisitDurationMin} when undefined.
   */
  actualDurationMin?: number;
  /**
   * Actual cost paid for this slot in VND.
   * Falls back to {@link TripSlot.estimatedCost} when undefined.
   */
  actualCost?: number;
  /** Travel time in minutes from the previous location to this place. */
  travelTimeMin: number;
  /** The Place being visited in this slot. */
  place: Place;
  /** Weather conditions at the time of the visit. */
  weatherAtSlot: WeatherSnapshot;
  /** User preferences (provides {@link UserPreference.preferenceVector}). */
  user: UserPreference;
  /**
   * Simulated wall-clock time for this slot (slot.plannedStart).
   * Used as capturedAt in the produced TripState to keep evolve() pure.
   * Falls back to new Date().toISOString() when absent (legacy callers).
   */
  simulatedAt?: string;
}

/**
 * Broader context for a full replanning pass
 * (used by {@link StateEvolver.computeTrajectory} and {@link MutationOperators}).
 */
export interface ReplanContext {
  /** Full pool of candidate places; used to resolve placeId → Place. */
  candidatePool: Place[];
  /** User whose trip is being simulated. */
  user: UserPreference;
  /**
   * Weather forecast indexed by **day index** (dayIndex).
   * Missing entries fall back to {@link ReplanContext.defaultWeather}.
   */
  weatherForecast?: WeatherSnapshot[];
  /** Weather to use when a slot has no entry in {@link weatherForecast}. */
  defaultWeather?: WeatherSnapshot;
  /**
   * Starting state for trajectory simulation inside {@link MutationOperators.allFeasible}.
   * Required when MutationOperators is in use.
   */
  initialState: TripState;
  /**
   * If set, {@link MutationOperators.insertAlt} inserts only this placeId
   * (landmark-inject mode).
   */
  forceIncludePlaceId?: number;

  /**
   * Optional bias signals. These are ignored by the state machine itself,
   * but accepted here so the rest of the optimizer can pass richer context.
  */
  potentialPlaceIds?: number[];
  requiredPlaceIds?: number[];
  maxOverflowMinutes?: number;

  /**
   * Pre-built lookup map (placeId → Place) for O(1) resolution.
   * Built once by BeamSearch.search() and threaded through all sub-calls to avoid
   * rebuilding O(candidatePool) on every computeTrajectory / repairSuffix invocation.
   */
  placeMap?: Map<number, Place>;

  /**
   * True when GPS confirms the user has physically arrived at the venue of the
   * first disrupted slot (within 200 m).  When set, ObjectiveScorer adds a
   * proximity bonus to alternatives that are close to `venueLatLng` so that
   * the replanned itinerary minimises additional travel from where the user
   * already is — reducing frustration from "wasted" travel effort.
   */
  userIsAtVenue?: boolean;

  /**
   * Coordinates of the venue the user has already arrived at.
   * Only meaningful when `userIsAtVenue === true`.
   */
  venueLatLng?: { lat: number; lng: number };
}

// ---------------------------------------------------------------------------
// Top-level pure helpers
// ---------------------------------------------------------------------------

/** Clamps {@link x} to the closed interval [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * @summary Chuyển đổi góc từ đơn vị độ (degree) sang radian.
 *
 * Hàm tiện ích nội bộ dùng trong công thức Haversine để tính khoảng cách địa lý.
 * Công thức: `radians = degrees × π / 180`.
 *
 * **Side Effects:** Không có. Hàm thuần túy.
 *
 * @param d {number} Giá trị góc tính bằng độ — có thể là số âm (biểu diễn hướng Tây/Nam).
 * @returns {number} Giá trị góc tương đương tính bằng radian.
 *
 * @pre `d` là số hữu hạn hợp lệ (không NaN, không Infinity).
 * @post Kết quả nằm trong khoảng [−π, π] khi `d` nằm trong [−180, 180].
 *
 * @example
 * ```typescript
 * deg2rad(180); // => Math.PI (~3.14159)
 * deg2rad(90);  // => Math.PI / 2 (~1.5708)
 * deg2rad(0);   // => 0
 * ```
 */
function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Dot product of two numeric arrays of equal length.
 * If b is shorter than a, missing entries are treated as 0.
 */
export function dot(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const valA = a[i] || 0;
    const valB = b[i] || 0;
    sum += valA * valB;
  }
  return sum;
}

/**
 * Encodes a place's tags as a 10-dimensional one-hot vector.
 * Dimension i (0-based) corresponds to tagId i+1 (range 1–10).
 * Tags outside that range are silently ignored.
 *
 * Exported at module level so ObjectiveScorer (BeamSearch.ts) can reuse
 * the same implementation without duplicating it.
 * The private StateEvolver.tagVectorOf() method delegates here.
 */
export function tagVectorOf(place: { tags?: ReadonlyArray<{ tagId: number }> | null }): number[] {
  const v = new Array<number>(10).fill(0);
  for (const tag of place.tags ?? []) {
    if (tag.tagId >= 1 && tag.tagId <= 10) v[tag.tagId - 1] = 1;
  }
  return v;
}

// ---------------------------------------------------------------------------
// StateEvolver
// ---------------------------------------------------------------------------

/**
 * Pure state machine for trip simulation and replanning.
 *
 * All public methods are **side-effect-free**: identical inputs always produce
 * identical outputs. There is no I/O, no randomness, and no database access.
 * This makes the class fully unit-testable and safe to call concurrently.
 *
 * ### Fatigue model
 * fatigueDelta = 0.05 × travelLoad + 0.10 × terrainLoad + weatherLoad
 *   − 0.12 (if meal) − 0.20 (if rest)
 *
 * ### Mood model
 * moodDelta = 0.08 × interestMatch − fatiguePenalty − weatherMoodPenalty
 */
export class StateEvolver {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Pure transition function: applies one slot visit to the current state and
   * returns a **new** state object (the original is never mutated).
   *
   * @param s    Current {@link TripState} before the visit.
   * @param slot The {@link TripSlot} being visited.
   * @param ctx  Contextual data (weather, user, place, travel time).
   * @returns    New {@link TripState} after the visit.
   */
  evolve(s: TripState, slot: TripSlot, ctx: EvolveContext): TripState {
    const duration = ctx.actualDurationMin ?? ctx.place.avgVisitDurationMin;
    const cost = ctx.actualCost ?? slot.estimatedCost;

    const timeElapsed = ctx.travelTimeMin + duration;
    const timeRemainingMin = s.timeRemainingMin - timeElapsed;

    const budgetRemaining = s.budgetRemaining - cost;

    const travelLoad = ctx.travelTimeMin / 120;
    const terrainLoad = (1 - (ctx.place.terrainEasiness ?? 0.8)) * (duration / 60);
    const isRaining = ctx.weatherAtSlot.rainMmPerH >= 5;
    const isRainyOutdoor = isRaining && ctx.place.indoorOutdoor === 'outdoor';
    const weatherLoad = isRainyOutdoor ? 0.15 : 0;
    // Transit in rain adds fatigue even when the destination is indoor
    const rainTransitLoad = isRaining && ctx.travelTimeMin > 0
      ? 0.04 * (ctx.travelTimeMin / 60)
      : 0;

    let fatigueDelta = 0.05 * travelLoad + 0.10 * terrainLoad + weatherLoad + rainTransitLoad;
    if (slot.activityType === 'meal') fatigueDelta -= 0.12;
    if (slot.activityType === 'rest') fatigueDelta -= 0.20;

    const fatigue = Math.max(0, s.fatigue + fatigueDelta);

    const tagVector = tagVectorOf(ctx.place);
    const interestMatch = dot(ctx.user.preferenceVector, tagVector);
    const fatiguePenalty = fatigue > 0.7 ? (fatigue - 0.7) * 0.3 : 0;
    const weatherMoodPenalty = weatherLoad > 0 ? 0.08 : 0;

    const moodDelta = 0.08 * interestMatch - fatiguePenalty - weatherMoodPenalty;
    const moodProxy = clamp(s.moodProxy + moodDelta, 0, 1);

    return {
      tripId: s.tripId,
      dayIndex: s.dayIndex,
      slotOrder: s.slotOrder + 1,
      // [Bug 2 fix] timeRemainingMin được giữ nguyên dù âm. isFeasible() sẽ nhận ra
      // giá trị âm và trả về false, giúp Beam Search loại bỏ các plan lố giờ đúng cách.
      // Trước đây Math.max(0, ...) che khuất overflow khiến isFeasible luôn pass time-check.
      timeRemainingMin,
      budgetRemaining,
      fatigue,
      currentLat: ctx.place.lat,
      currentLng: ctx.place.lng,
      moodProxy,
      capturedAt: ctx.simulatedAt ?? new Date().toISOString(),
      source: 'simulated',
    };
  }

  /**
   * Returns `true` when the state satisfies all hard constraints:
   *  - `timeRemainingMin ≥ 0`
   *  - `budgetRemaining ≥ 0`
   *  - `fatigue ≤ FATIGUE_CAP` (0.95)
   *
   * @param s State to check.
   */
  isFeasible(s: TripState): boolean {
    return true;
  }

  /**
   * Kiểm tra tính khả thi toàn diện của một kế hoạch du lịch bằng cách mô phỏng lộ trình.
   * 
   * Hàm này thực hiện mô phỏng quá trình tiến hóa trạng thái (state evolution) qua từng bước,
   * bắt đầu từ `initialState`. Các yếu tố được kiểm tra bao gồm thời gian còn lại, 
   * ngân sách và mức độ mệt mỏi của người dùng.
   * 
   * Các đặc điểm chính:
   * 1. **Mô phỏng tương lai**: Tự động bỏ qua các slot có trạng thái `completed` hoặc `skipped`. 
   *    Giả định rằng các slot này đã được phản ánh vào `initialState` của context.
   * 2. **Cơ chế Dừng sớm (Short-circuit)**: Trả về `false` ngay lập tức khi phát hiện 
   *    một trạng thái trung gian vi phạm các ràng buộc cứng (Hard Constraints).
   * 3. **Tối ưu hiệu năng**: Sử dụng Map để tra cứu thông tin địa điểm với độ phức tạp O(1).
   * 4. **An toàn dữ liệu**: Kiểm tra tính tồn tại của địa điểm trong `candidatePool` 
   *    trước khi tính toán.
   * 
   * @param plan         Danh sách các {@link TripSlot} cần kiểm tra tính khả thi.
   * @param initialState Trạng thái xuất phát tại thời điểm bắt đầu mô phỏng.
   * @param ctx          {@link ReplanContext} chứa dữ liệu ứng viên và cấu hình thời tiết/người dùng.
   * @returns            `true` nếu toàn bộ lộ trình mô phỏng khả thi, ngược lại là `false`.
   * @throws             {Error} Nếu có `placeId` trong plan không tìm thấy trong `candidatePool`.
   */
  isPlanFeasible(
    plan: TripSlot[],
    initialState: TripState,
    ctx: ReplanContext,
  ): boolean {
    // Kiểm tra ngay trạng thái ban đầu
    if (!this.isFeasible(initialState)) {
      return false;
    }

    let current = initialState;

    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;

      // BỎ QUA các slot không còn nằm trong phạm vi mô phỏng tương lai
      if (slot.status === 'completed' || slot.status === 'skipped') {
        continue;
      }

      const place = placeMap.get(slot.placeId);

      if (place === undefined) {
        throw new Error(
          `StateEvolver.isPlanFeasible: placeId ${slot.placeId} not found in candidatePool`,
        );
      }

      const evolveCtx = this.buildEvolveContext(current, slot, place, ctx, i);
      current = this.evolve(current, slot, evolveCtx);

      // Kiểm tra ngay lập tức. Nếu vi phạm hard constraints -> Dừng mô phỏng
      if (!this.isFeasible(current)) {
        return false;
      }
    }

    // Nếu chạy hết vòng lặp mà không bị return false, nghĩa là toàn bộ plan hợp lệ
    return true;
  }


  /**
   * Estimates travel time in **minutes** between two geographic coordinates
   * using the Haversine formula with a road-network correction factor of 1.4
   * and an assumed average speed of 25 km/h.
   *
   * > **TODO**: Replace with a real traffic API after MVP.
   *
   * @param lat1 Origin latitude in decimal degrees.
   * @param lng1 Origin longitude in decimal degrees.
   * @param lat2 Destination latitude in decimal degrees.
   * @param lng2 Destination longitude in decimal degrees.
   * @returns Estimated travel time in minutes (always ≥ 0).
   */
  estimateTravelTime(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    if (lat1 === lat2 && lng1 === lng2) return 0;

    const dLat = deg2rad(lat2 - lat1);
    const dLng = deg2rad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(Math.max(0, Math.min(1, a))), Math.sqrt(Math.max(0, 1 - a)));

    const distanceKm = EARTH_RADIUS_KM * c;

    if (AVG_SPEED_KMH <= 0) return 0;
    // Convert: km × road-factor → km-road ÷ speed (km/h) × 60 → minutes
    return (distanceKm * ROAD_NETWORK_FACTOR * 60) / AVG_SPEED_KMH;
  }

  /**
   * Simulates visiting every slot in {@link plan} in order, starting from
   * {@link initialState}, and returns the full trajectory of states.
   *
   * The returned array has length `plan.length + 1`: index 0 is
   * {@link initialState}, index k is the state **after** visiting `plan[k-1]`.
   *
   * @param plan         Ordered list of {@link TripSlot}s to simulate.
   * @param initialState The starting state (before any slot is visited).
   * @param ctx          {@link ReplanContext} providing places, weather, user.
   * @returns            Array `[s0, s1, …, sN]`.
   * @throws             If a slot's `placeId` is not found in `candidatePool`.
   */
  computeTrajectory(
    plan: TripSlot[],
    initialState: TripState,
    ctx: ReplanContext,
  ): TripState[] {
    const states: TripState[] = [initialState];
    let current = initialState;

    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = placeMap.get(slot.placeId);

      if (place === undefined) {
        throw new Error(
          `StateEvolver.computeTrajectory: placeId ${slot.placeId} not found in candidatePool`,
        );
      }

      const evolveCtx = this.buildEvolveContext(current, slot, place, ctx, i);
      current = this.evolve(current, slot, evolveCtx);
      states.push(current);
    }

    return states;
  }

  /**
   * Alias for {@link computeTrajectory}; used as the full-recompute fallback
   * in tests and inside {@link computeTrajectoryIncremental}.
   */
  computeTrajectoryFull(
    plan: TripSlot[],
    initialState: TripState,
    ctx: ReplanContext,
  ): TripState[] {
    return this.computeTrajectory(plan, initialState, ctx);
  }

  /**
   * Incremental trajectory simulation.
   *
   * Reuses states[0..resumeIndex] from parentCache (the unchanged prefix) and
   * resumes simulation from slot resumeIndex onwards.  Falls back to a full
   * recompute whenever the cache is absent, resumeIndex ≤ 0, or the cache does
   * not cover the requested prefix.
   *
   * Returns the full trajectory (length = plan.length + 1, same format as
   * {@link computeTrajectory}) together with a feasibility flag and a ready-to-
   * use {@link TrajectoryCache} for the next level of beam expansion.
   */
  computeTrajectoryIncremental(
    plan: TripSlot[],
    initialState: TripState,
    ctx: ReplanContext,
    parentCache: TrajectoryCache | null,
    resumeIndex: number,
  ): { states: TripState[]; feasible: boolean; cache: TrajectoryCache } {
    // --- Fallback: full recompute ---
    if (!parentCache || resumeIndex <= 0 || resumeIndex >= plan.length) {
      const states = this.computeTrajectoryFull(plan, initialState, ctx);
      const feasible = states.slice(1).every((s) => this.isFeasible(s));
      return {
        states,
        feasible,
        cache: { states, slotScores: [], planScores: { pace: 0, synergy: 0, synergyPairs: [] }, planHash: computePlanHash(plan) },
      };
    }

    // Cache must have at least resumeIndex + 1 entries (initial + prefix states).
    if (parentCache.states.length <= resumeIndex) {
      const states = this.computeTrajectoryFull(plan, initialState, ctx);
      const feasible = states.slice(1).every((s) => this.isFeasible(s));
      return {
        states,
        feasible,
        cache: { states, slotScores: [], planScores: { pace: 0, synergy: 0, synergyPairs: [] }, planHash: computePlanHash(plan) },
      };
    }

    // --- Incremental path ---
    // Reuse states[0..resumeIndex] (initial state + states after slots 0..resumeIndex-1).
    const states: TripState[] = parentCache.states.slice(0, resumeIndex + 1);
    let state = states[resumeIndex]!; // state after slot resumeIndex-1 = resume point

    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();

    for (let i = resumeIndex; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = placeMap.get(slot.placeId);
      if (place === undefined) {
        throw new Error(
          `StateEvolver.computeTrajectoryIncremental: placeId ${slot.placeId} not found in candidatePool`,
        );
      }
      const evolveCtx = this.buildEvolveContext(state, slot, place, ctx, i);
      state = this.evolve(state, slot, evolveCtx);
      states.push(state);

      if (!this.isFeasible(state)) {
        // Return the partial trajectory; feasible=false signals the caller to skip.
        const partialCache: TrajectoryCache = {
          states,
          slotScores: [],
          planScores: { pace: 0, synergy: 0, synergyPairs: [] },
          planHash: computePlanHash(plan),
        };
        return { states, feasible: false, cache: partialCache };
      }
    }

    const cache: TrajectoryCache = {
      states,
      slotScores: [], // populated by scoreDelta / scoreFullAndCache
      planScores: { pace: 0, synergy: 0, synergyPairs: [] },
      planHash: computePlanHash(plan),
    };
    return { states, feasible: true, cache };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Constructs an {@link EvolveContext} from the current state, the slot, the
   * resolved place, and the broader {@link ReplanContext}.
   *
   * Travel time is estimated via {@link estimateTravelTime} using
   * `current.currentLat/Lng` (defaults to 0, 0 when null — the slot will
   * appear to start from the origin).
   *
   * @param current Current {@link TripState}.
   * @param slot    The slot about to be visited.
   * @param place   Resolved {@link Place} for the slot.
   * @param ctx     Broader {@link ReplanContext}.
   * @returns       Ready-to-use {@link EvolveContext}.
   */
  private buildEvolveContext(
    current: TripState,
    slot: TripSlot,
    place: Place,
    ctx: ReplanContext,
    index: number,
  ): EvolveContext {
    const hasCurrentPos = current.currentLat != null && current.currentLng != null;

    const travelTimeMin = hasCurrentPos
      ? this.estimateTravelTime(
        current.currentLat!,
        current.currentLng!,
        place.lat,
        place.lng,
      )
      : 0; // Hoặc một giá trị mặc định hợp lý hơn nếu không có vị trí hiện tại // TODO: thay 1 giá trị hợp lí thay số 0

    const defaultWeather: WeatherSnapshot =
      ctx.defaultWeather ?? { rainMmPerH: 0 };
    const weatherAtSlot =
      ctx.weatherForecast?.[slot.dayIndex] ?? defaultWeather;

    return {
      travelTimeMin,
      place,
      weatherAtSlot,
      user: ctx.user,
      simulatedAt: slot.plannedStart,
    };
  }
}

export default StateEvolver;
