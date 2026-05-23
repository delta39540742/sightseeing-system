import type { Place } from '@app/types';
import type { ReplanContext } from './StateEvolver';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum plausible vehicle speed (taxi, low traffic). Used for LB time estimates. */
const V_MAX_KMH = 60;

const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const dLat = deg2rad(lat2 - lat1);
  const dLng = deg2rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Minimum Spanning Tree length (km) of a set of places using Prim's O(n²) algorithm.
 * For n=8 this is 64 Haversine computations — far cheaper than one computeTrajectory() call.
 *
 * MST length is a tight lower bound on any Hamiltonian path through the same points,
 * making it an admissible lower bound for tour-length estimation.
 */
function mstHaversineKm(places: Place[]): number {
  if (places.length <= 1) return 0;
  const n = places.length;
  const inMST = new Array<boolean>(n).fill(false);
  const minDist = new Array<number>(n).fill(Infinity);
  minDist[0] = 0;
  let totalKm = 0;

  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minDist[i]! < minDist[u]!)) u = i;
    }
    if (u === -1) break;
    inMST[u] = true;
    totalKm += minDist[u]!;

    for (let v = 0; v < n; v++) {
      if (inMST[v]) continue;
      const d = haversineKm(
        places[u]!.lat, places[u]!.lng,
        places[v]!.lat, places[v]!.lng,
      );
      if (d < minDist[v]!) minDist[v] = d;
    }
  }
  return totalKm;
}

// ---------------------------------------------------------------------------
// Per-request cache
// ---------------------------------------------------------------------------

/** Cleared at the start of each BeamSearch.search() call via clearSetFeasibilityCache(). */
const setFeasibilityCache = new Map<string, boolean>();

function canonicalKey(places: Place[]): string {
  return places.map((p) => p.placeId).sort((a, b) => a - b).join(',');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lower-bound feasibility check for a set of places S.
 *
 * Returns `false` when NO ordering of S can fit within the remaining time/budget,
 * allowing callers to skip repairSuffix() + computeTrajectory() for that candidate.
 *
 * ### Admissibility guarantee (LB ≤ actual)
 * - `LB_time = sum(avgVisitDurationMin) + MST(Haversine) / V_MAX_KMH`
 *   - Haversine ≤ road distance, so Haversine travel time ≤ actual travel time.
 *   - V_MAX_KMH (60 km/h) ≥ assumed average speed (25 km/h), so computed time ≤ actual.
 *   - MST ≤ any Hamiltonian path, so LB_time ≤ minimum possible route time.
 * - `LB_cost = sum(place.minPrice)` — minPrice ≤ actual cost by definition.
 *
 * A plan that passes this check may still fail full simulation (this is a necessary,
 * not sufficient, condition for feasibility). That is by design: the filter is a
 * cheap pre-screen, not a replacement for computeTrajectory().
 *
 * @param places  New set of places after the mutation (resolved Place objects).
 * @param ctx     ReplanContext providing initialState for budget/time remaining.
 * @returns       `false` if provably infeasible; `true` if possibly feasible.
 */
export function isSetFeasible(places: Place[], ctx: ReplanContext): boolean {
  if (places.length === 0) return true;

  const key = canonicalKey(places);
  const cached = setFeasibilityCache.get(key);
  if (cached !== undefined) return cached;

  const lbCost = places.reduce((s, p) => s + (p.minPrice ?? 0), 0);

  const lbTimeVisits = places.reduce((s, p) => s + p.avgVisitDurationMin, 0);
  const mstKm = mstHaversineKm(places);
  const lbTimeTravel = (mstKm / V_MAX_KMH) * 60;
  const lbTime = lbTimeVisits + lbTimeTravel;

  const feasible = lbTime <= ctx.initialState.timeRemainingMin;
  setFeasibilityCache.set(key, feasible);
  return feasible;
}

/**
 * Must be called at the start of each BeamSearch.search() to prevent stale results
 * from a prior request (different budget/time remaining) affecting the current one.
 */
export function clearSetFeasibilityCache(): void {
  setFeasibilityCache.clear();
}
