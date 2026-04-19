import type { TripState, TripSlot, Place, UserPreference } from '@app/types';

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
   * Weather keyed by slotId.
   * Missing entries fall back to {@link ReplanContext.defaultWeather}.
   */
  weatherBySlotId: Record<string, WeatherSnapshot>;
  /** Weather to use when a slot has no entry in {@link weatherBySlotId}. */
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
}

// ---------------------------------------------------------------------------
// Top-level pure helpers
// ---------------------------------------------------------------------------

/** Clamps {@link x} to the closed interval [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Converts decimal degrees to radians. */
function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Dot product of two numeric arrays of equal length.
 * If b is shorter than a, missing entries are treated as 0.
 */
function dot(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
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

    // 1. Time ----------------------------------------------------------------
    const timeElapsed = ctx.travelTimeMin + duration;
    const timeRemainingMin = s.timeRemainingMin - timeElapsed;

    // 2. Budget --------------------------------------------------------------
    const budgetRemaining = s.budgetRemaining - cost;

    // 3. Fatigue -------------------------------------------------------------
    // travelLoad: 2 hours of travel = 1.0
    const travelLoad = ctx.travelTimeMin / 120;
    // terrainLoad: hard terrain (0) × long visit hurts more
    const terrainLoad =
      (1 - (ctx.place.terrainEasiness ?? 0.8)) * (duration / 60);
    // weatherLoad: rain outdoors adds a flat penalty
    const isRainyOutdoor =
      ctx.weatherAtSlot.rainMmPerH >= 5 &&
      ctx.place.indoorOutdoor === 'outdoor';
    const weatherLoad = isRainyOutdoor ? 0.15 : 0;

    let fatigueDelta =
      0.05 * travelLoad + 0.10 * terrainLoad + weatherLoad;

    if (slot.activityType === 'meal') fatigueDelta -= 0.12;
    if (slot.activityType === 'rest') fatigueDelta -= 0.20;

    const fatigue = clamp(s.fatigue + fatigueDelta, 0, 1);

    // 4. Mood ----------------------------------------------------------------
    // interestMatch: dot product of user interest vector and place tag vector
    const tagVector = this.tagVectorOf(ctx.place);
    const interestMatch = dot(ctx.user.preferenceVector, tagVector);
    // fatiguePenalty: mood drops linearly when fatigue exceeds 0.7
    const fatiguePenalty = fatigue > 0.7 ? (fatigue - 0.7) * 0.3 : 0;
    const weatherMoodPenalty = weatherLoad > 0 ? 0.08 : 0;

    const moodDelta =
      0.08 * interestMatch - fatiguePenalty - weatherMoodPenalty;
    const moodProxy = clamp(s.moodProxy + moodDelta, 0, 1);

    return {
      tripId: s.tripId,
      dayIndex: s.dayIndex,
      slotOrder: s.slotOrder + 1,
      timeRemainingMin,
      budgetRemaining,
      fatigue,
      currentLat: ctx.place.lat,
      currentLng: ctx.place.lng,
      moodProxy,
      capturedAt: new Date().toISOString(),
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
    return (
      s.timeRemainingMin >= 0 &&
      s.budgetRemaining >= 0 &&
      s.fatigue <= FATIGUE_CAP
    );
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
    const dLat = deg2rad(lat2 - lat1);
    const dLng = deg2rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = EARTH_RADIUS_KM * c;
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

    for (const slot of plan) {
      const place = ctx.candidatePool.find((p) => p.placeId === slot.placeId);
      if (place === undefined) {
        throw new Error(
          `StateEvolver.computeTrajectory: placeId ${slot.placeId} not found in candidatePool`,
        );
      }
      const evolveCtx = this.buildEvolveContext(current, slot, place, ctx);
      current = this.evolve(current, slot, evolveCtx);
      states.push(current);
    }

    return states;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Encodes a place's tags as a 10-dimensional one-hot vector.
   * Dimension `i` (0-based) corresponds to tagId `i + 1` (1–10).
   * Tags outside the range 1–10 are ignored.
   *
   * @param place Place whose tags are encoded.
   * @returns     `number[]` of length 10.
   */
  private tagVectorOf(place: Place): number[] {
    const v = new Array<number>(10).fill(0);
    for (const tag of place.tags ?? []) {
      if (tag.tagId >= 1 && tag.tagId <= 10) {
        v[tag.tagId - 1] = 1;
      }
    }
    return v;
  }

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
  ): EvolveContext {
    const travelTimeMin = this.estimateTravelTime(
      current.currentLat ?? 0,
      current.currentLng ?? 0,
      place.lat,
      place.lng,
    );

    const defaultWeather: WeatherSnapshot =
      ctx.defaultWeather ?? { rainMmPerH: 0 };
    const weatherAtSlot =
      ctx.weatherBySlotId[slot.slotId] ?? defaultWeather;

    return {
      travelTimeMin,
      place,
      weatherAtSlot,
      user: ctx.user,
    };
  }
}

export default StateEvolver;
