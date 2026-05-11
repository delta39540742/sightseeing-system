/**
 * simulate.ts — Dev-only endpoint that runs the full replan pipeline
 * on synthetic trip data (real Da Nang places from DB) for scenario demos.
 *
 * Route: POST /api/demo/simulate
 * Auth:  None — restricted to NODE_ENV !== 'production'
 */

import { randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type {
  TripSlot,
  TripState,
  Place,
  UserPreference,
  ObjectiveWeights,
  IncidentContext,
} from '@app/types';
import type { BeamSearchContext } from '../../replanner/BeamSearch';
import { StateEvolver } from '../../replanner/StateEvolver';
import { MutationOperators } from '../../replanner/MutationOperators';
import { ObjectiveScorer, BeamSearch } from '../../replanner/BeamSearch';
import {
  ReplanEffectivenessEvaluator,
  classifyRainSeverity,
  classifyTrafficSeverity,
} from '../../replanner/EffectivenessEvaluator';
import { dot, tagVectorOf } from '../../replanner/StateEvolver';

// ─── Constants ────────────────────────────────────────────────────────────────

const DA_NANG_LAT = 16.0544;
const DA_NANG_LNG = 108.2022;

// Tag IDs matching seed-places.ts TAG_MAP
const TAG_BEACH = 1;
const TAG_FOOD = 4;
const TAG_SHOPPING = 6;

// Simulated trip date: today at 08:00 ICT (UTC+7 → UTC−7h)
const TRIP_DATE = '2026-05-11';
const ICT_OFFSET = 7 * 60; // 7 hours in minutes

// A 6-slot daily schedule (ICT wall-clock → stored as UTC)
// Formatted as [startICT, endICT, activityType, slotOrder]
const SLOT_SCHEDULE: Array<{
  startICT: string;
  endICT: string;
  activityType: TripSlot['activityType'];
  slotOrder: number;
}> = [
  { startICT: '08:00', endICT: '10:00', activityType: 'sightseeing', slotOrder: 0 },
  { startICT: '10:30', endICT: '12:30', activityType: 'sightseeing', slotOrder: 1 },
  { startICT: '12:30', endICT: '13:30', activityType: 'meal',        slotOrder: 2 },
  { startICT: '14:00', endICT: '16:00', activityType: 'activity',    slotOrder: 3 },
  { startICT: '16:30', endICT: '18:30', activityType: 'activity',    slotOrder: 4 },
  { startICT: '19:00', endICT: '20:00', activityType: 'meal',        slotOrder: 5 },
];

// User preference: generic tourist excited about nature + entertainment + food
const DEMO_USER: UserPreference = {
  preferenceVector: [0.9, 0.6, 0.7, 0.8, 0.5, 0.7, 0.8, 0.6, 0.4, 0.3],
  pace: 5,
  mobilityRestrictions: [],
};

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1.0,
  wPace: 1.0,
  wDistance: 1.5,
  wBudget: 1.0,
  wWeather: 1.0,
  wRisk: 1.0,
  wStability: 0.05,
  wPotentialBias: 0.10,
  wProximity: 0,
};

export type ScenarioKey =
  | 'rain_heavy'
  | 'rain_moderate'
  | 'traffic_heavy'
  | 'traffic_moderate'
  | 'closure';

export type TransportKey = 'car' | 'motorbike';

interface SimulateBody {
  scenario: ScenarioKey;
  transportType?: TransportKey;
}

export interface DemoDeps {
  pool: Pool;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ictToUtc(date: string, ictTime: string): string {
  const [h, m] = ictTime.split(':').map(Number);
  const totalMin = h! * 60 + m! - ICT_OFFSET;
  const hUtc = Math.floor(((totalMin % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const mUtc = ((totalMin % 60) + 60) % 60;
  return `${date}T${String(hUtc).padStart(2, '0')}:${String(mUtc).padStart(2, '0')}:00.000Z`;
}

function hasTag(p: Place, tagId: number): boolean {
  return p.tags.some((t) => t.tagId === tagId);
}

/** Load all Da Nang places with tags and opening hours from the DB. */
async function loadDaNangPlaces(pool: Pool): Promise<Place[]> {
  const placesRes = await pool.query<{
    place_id: string;
    name: string;
    lat: number;
    lng: number;
    avg_visit_duration_min: number;
    terrain_easiness: number | null;
    indoor_outdoor: string;
    min_price: number | null;
    estimated_cost: number | null;
  }>(
    `SELECT place_id, name, lat, lng, avg_visit_duration_min,
            terrain_easiness, indoor_outdoor, min_price,
            COALESCE(min_price, 50000) AS estimated_cost
       FROM place
      WHERE address ILIKE '%da nang%'
         OR address ILIKE '%đà nẵng%'
         OR address ILIKE '%danang%'
      LIMIT 120`,
  );

  if (placesRes.rows.length === 0) return [];

  const placeIds = placesRes.rows.map((r) => Number(r.place_id));

  const [tagsRes, hoursRes] = await Promise.all([
    pool.query<{ place_id: string; tag_id: number }>(
      `SELECT place_id, tag_id FROM place_tag_map WHERE place_id = ANY($1::bigint[])`,
      [placeIds],
    ),
    pool.query<{
      place_id: string;
      day_of_week: number;
      open_time: string;
      close_time: string;
    }>(
      `SELECT place_id, day_of_week, open_time, close_time
         FROM place_opening_hour
        WHERE place_id = ANY($1::bigint[])`,
      [placeIds],
    ),
  ]);

  const tagsByPlace = new Map<number, { tagId: number }[]>();
  tagsRes.rows.forEach((r) => {
    const id = Number(r.place_id);
    if (!tagsByPlace.has(id)) tagsByPlace.set(id, []);
    tagsByPlace.get(id)!.push({ tagId: r.tag_id });
  });

  const hoursByPlace = new Map<
    number,
    { dayOfWeek: number; openTime: string; closeTime: string }[]
  >();
  hoursRes.rows.forEach((r) => {
    const id = Number(r.place_id);
    if (!hoursByPlace.has(id)) hoursByPlace.set(id, []);
    hoursByPlace.get(id)!.push({
      dayOfWeek: r.day_of_week,
      openTime: r.open_time,
      closeTime: r.close_time,
    });
  });

  return placesRes.rows.map((r) => ({
    placeId: Number(r.place_id),
    name: r.name,
    lat: Number(r.lat),
    lng: Number(r.lng),
    avgVisitDurationMin: Number(r.avg_visit_duration_min),
    terrainEasiness: r.terrain_easiness != null ? Number(r.terrain_easiness) : 0.8,
    indoorOutdoor: r.indoor_outdoor as 'indoor' | 'outdoor' | 'mixed',
    estimatedCost: r.estimated_cost != null ? Number(r.estimated_cost) : 50_000,
    minPrice: r.min_price != null ? Number(r.min_price) : 0,
    tags: tagsByPlace.get(Number(r.place_id)) ?? [],
    openingHours: hoursByPlace.get(Number(r.place_id)) ?? [],
  }));
}

/**
 * Categorise places and pick the 6 slots for the demo trip.
 * Returns [outdoor0, outdoor1, food/meal, outdoor/beach, shopping, food/dinner]
 */
function selectTemplatePlaces(places: Place[]): Place[] | null {
  const outdoor = (p: Place) => p.indoorOutdoor === 'outdoor';

  const outdoorSight = places.filter(
    (p) => outdoor(p) && !hasTag(p, TAG_FOOD) && !hasTag(p, TAG_SHOPPING),
  );
  const foodPlaces = places.filter((p) => hasTag(p, TAG_FOOD));
  const shoppingPlaces = places.filter((p) => hasTag(p, TAG_SHOPPING));
  const beachNature = places.filter(
    (p) => outdoor(p) && hasTag(p, TAG_BEACH) && !hasTag(p, TAG_FOOD) && !hasTag(p, TAG_SHOPPING),
  );

  // Need at least 2 outdoor sightseeing, 2 food, 1 shopping, 1 beach
  if (outdoorSight.length < 2 || foodPlaces.length < 2) return null;

  const outdoor0 = outdoorSight[0]!;
  const outdoor1 = outdoorSight[1]!;
  const lunch = foodPlaces[0]!;
  // Prefer beach for slot 3; fall back to other outdoor
  const afternoon = beachNature[0] ?? outdoorSight[2] ?? outdoor1;
  const shopping = shoppingPlaces[0] ?? foodPlaces[2] ?? foodPlaces[1]!;
  const dinner = foodPlaces[1]!;

  return [outdoor0, outdoor1, lunch, afternoon, shopping, dinner];
}

function buildSlots(tripId: string, selection: Place[]): TripSlot[] {
  return selection.map((place, i) => {
    const sched = SLOT_SCHEDULE[i]!;
    return {
      slotId: randomUUID(),
      tripId,
      dayIndex: 0,
      slotOrder: sched.slotOrder,
      version: 1,
      placeId: place.placeId,
      plannedStart: ictToUtc(TRIP_DATE, sched.startICT),
      plannedEnd: ictToUtc(TRIP_DATE, sched.endICT),
      actualStart: null,
      actualEnd: null,
      estimatedCost: place.estimatedCost ?? 50_000,
      activityType: sched.activityType,
      rationale: null,
      status: 'planned' as const,
    };
  });
}

function buildInitialState(tripId: string, budgetRemaining = 3_000_000): TripState {
  return {
    tripId,
    dayIndex: 0,
    slotOrder: 0,
    timeRemainingMin: 12 * 60,
    budgetRemaining,
    fatigue: 0,
    currentLat: DA_NANG_LAT,
    currentLng: DA_NANG_LNG,
    moodProxy: 0.8,
    capturedAt: ictToUtc(TRIP_DATE, '08:00'),
    source: 'simulated',
  };
}

// ─── Scenario injection ───────────────────────────────────────────────────────

interface InjectedContext {
  ctx: BeamSearchContext;
  originalPlanSnapshot: TripSlot[];
  incident: IncidentContext;
  closedPlaceId?: number;
}

function injectScenario(
  baseCtx: BeamSearchContext,
  scenario: ScenarioKey,
  transportType: TransportKey,
): InjectedContext {
  let ctx = { ...baseCtx };
  const originalPlanSnapshot = [...ctx.remainingSlots];

  // ── Rain scenarios ──────────────────────────────────────────────────────────
  if (scenario === 'rain_heavy' || scenario === 'rain_moderate') {
    const rainMmPerH = scenario === 'rain_heavy' ? 30 : 10;
    const severity = classifyRainSeverity(rainMmPerH);

    ctx = {
      ...ctx,
      weatherForecast: [{ rainMmPerH }],
      weights: { ...ctx.weights, wWeather: 2.5, wRisk: 1.5 },
    };

    // For heavy rain: pre-replace all outdoor slots with indoor alternatives
    if (rainMmPerH >= 5) {
      const prefVec = DEMO_USER.preferenceVector;
      const indoorRanked = ctx.candidatePool
        .filter((p) => p.indoorOutdoor === 'indoor' || p.indoorOutdoor === 'mixed')
        .map((p) => ({ place: p, interest: dot(prefVec, tagVectorOf(p)) }))
        .sort((a, b) => b.interest - a.interest)
        .map((x) => x.place);

      const occupiedIds = new Set(ctx.remainingSlots.map((s) => s.placeId));

      ctx.remainingSlots = ctx.remainingSlots.map((slot) => {
        const place = ctx.candidatePool.find((p) => p.placeId === slot.placeId);
        if (!place || place.indoorOutdoor !== 'outdoor') return slot;
        if (slot.activityType === 'meal') return slot;

        const replacement = indoorRanked.find((p) => !occupiedIds.has(p.placeId));
        if (!replacement) return slot;

        occupiedIds.delete(slot.placeId);
        occupiedIds.add(replacement.placeId);
        return {
          ...slot,
          placeId: replacement.placeId,
          estimatedCost: replacement.estimatedCost ?? slot.estimatedCost,
        };
      });

      // Remove remaining outdoor places from pool so BeamSearch can't reinsert them
      const nowOccupied = new Set(ctx.remainingSlots.map((s) => s.placeId));
      ctx.candidatePool = ctx.candidatePool.filter(
        (p) => p.indoorOutdoor !== 'outdoor' || nowOccupied.has(p.placeId),
      );
    }

    const incident: IncidentContext = {
      type: 'rain',
      severity,
      rainMmPerH,
      userTransportType: transportType === 'motorbike' ? 'uncovered' : 'covered',
    };

    return { ctx, originalPlanSnapshot, incident };
  }

  // ── Traffic scenarios ───────────────────────────────────────────────────────
  if (scenario === 'traffic_heavy' || scenario === 'traffic_moderate') {
    const delayMin = scenario === 'traffic_heavy' ? 45 : 20;
    const severity = classifyTrafficSeverity(delayMin);

    // Simulate: user is currently stuck in traffic on the way to slot 1.
    // Mark slot 0 as completed and reduce available time.
    const firstSlot = ctx.remainingSlots[0];
    if (firstSlot) {
      ctx.remainingSlots = ctx.remainingSlots.map((s, i) =>
        i === 0 ? { ...s, status: 'completed' as const, actualStart: s.plannedStart, actualEnd: s.plannedEnd } : s,
      );
      // Cut available time by the traffic delay
      ctx = {
        ...ctx,
        initialState: {
          ...ctx.initialState,
          timeRemainingMin: ctx.initialState.timeRemainingMin - delayMin - 90,
          fatigue: 0.12,
          capturedAt: ictToUtc(TRIP_DATE, '10:15'),
        },
        weights: { ...ctx.weights, wDistance: 2.0, wPace: 1.2 },
      };
    }

    const firstPlace = ctx.candidatePool.find((p) => p.placeId === firstSlot?.placeId);
    const distKm = firstPlace
      ? Math.sqrt(
          (firstPlace.lat - DA_NANG_LAT) ** 2 + (firstPlace.lng - DA_NANG_LNG) ** 2,
        ) * 111
      : 2.0;

    const incident: IncidentContext = {
      type: 'traffic_delay',
      severity,
      trafficDelayMin: delayMin,
      distanceToOriginalDestKm: distKm,
    };

    return { ctx, originalPlanSnapshot, incident };
  }

  // ── Closure scenario ────────────────────────────────────────────────────────
  if (scenario === 'closure') {
    // Slot 3 (afternoon outdoor/beach) is closed unexpectedly.
    const closedSlot = ctx.remainingSlots[3];
    const closedPlaceId = closedSlot?.placeId;

    if (closedPlaceId !== undefined) {
      const prefVec = DEMO_USER.preferenceVector;
      // Find a replacement: indoor/mixed sightseeing or entertainment
      const alternatives = ctx.candidatePool
        .filter(
          (p) =>
            p.placeId !== closedPlaceId &&
            !hasTag(p, TAG_FOOD) &&
            !ctx.remainingSlots.some((s) => s.placeId === p.placeId),
        )
        .map((p) => ({ place: p, interest: dot(prefVec, tagVectorOf(p)) }))
        .sort((a, b) => b.interest - a.interest)
        .map((x) => x.place);

      const replacement = alternatives[0];
      if (replacement) {
        ctx.remainingSlots = ctx.remainingSlots.map((s, i) =>
          i === 3
            ? { ...s, placeId: replacement.placeId, estimatedCost: replacement.estimatedCost ?? s.estimatedCost }
            : s,
        );
      }

      // Remove the closed place from the pool so BeamSearch can't reinsert it
      ctx.candidatePool = ctx.candidatePool.filter((p) => p.placeId !== closedPlaceId);
    }

    const incident: IncidentContext = {
      type: 'closure',
      severity: 'high',
      closedPlaceId,
    } as unknown as IncidentContext; // extended type

    return { ctx, originalPlanSnapshot, incident, closedPlaceId };
  }

  return { ctx, originalPlanSnapshot, incident: { type: 'rain', severity: 'low', rainMmPerH: 0 } };
}

// ─── Closure effectiveness (inline, not in shared evaluator) ─────────────────

function evaluateClosure(
  closedPlaceId: number | undefined,
  oldPlan: TripSlot[],
  newPlan: TripSlot[],
): import('@app/types').CriterionResult[] {
  const results: import('@app/types').CriterionResult[] = [];

  // C1: Closed place not in new plan
  const closedStillPresent = closedPlaceId !== undefined && newPlan.some((s) => s.placeId === closedPlaceId);
  results.push({
    id: 'closed_place_removed',
    label: 'Địa điểm đóng cửa đã được thay thế',
    expected: 'Địa điểm đóng cửa không xuất hiện trong lịch mới',
    actual: closedStillPresent ? 'Vẫn còn trong lịch (lỗi)' : 'Đã thay thế thành công',
    pass: !closedStillPresent,
    level: 'error',
  });

  // C2: Total slots maintained (within ±1)
  const lengthDiff = Math.abs(newPlan.length - oldPlan.length);
  results.push({
    id: 'slot_count_maintained',
    label: 'Số lượng điểm tham quan giữ ổn định',
    expected: 'Số slot mới không giảm quá 1 so với kế hoạch ban đầu',
    actual: `Cũ: ${oldPlan.length} slot → Mới: ${newPlan.length} slot`,
    pass: lengthDiff <= 1,
    level: 'warning',
  });

  // C3: New slot exists for the closed slot's time window
  const oldSlotIds = new Set(oldPlan.map((s) => s.slotId));
  const newSlots = newPlan.filter((s) => !oldSlotIds.has(s.slotId));
  results.push({
    id: 'replacement_found',
    label: 'Tìm được điểm thay thế phù hợp',
    expected: 'Hệ thống tự động tìm địa điểm thay thế khi quán đóng cửa',
    actual: newSlots.length > 0 ? `${newSlots.length} địa điểm mới được đề xuất` : 'Không tìm được thay thế',
    pass: newSlots.length > 0 || newPlan.some((s) => !oldPlan.find((o) => o.slotId === s.slotId && o.placeId === s.placeId)),
    level: 'error',
  });

  // C4: No meal slots removed
  const oldMeals = oldPlan.filter((s) => s.activityType === 'meal').length;
  const newMeals = newPlan.filter((s) => s.activityType === 'meal').length;
  results.push({
    id: 'meals_preserved',
    label: 'Bữa ăn trong lịch không bị ảnh hưởng',
    expected: 'Khi đóng cửa điểm tham quan, các bữa ăn không bị xóa',
    actual: `Cũ: ${oldMeals} bữa → Mới: ${newMeals} bữa`,
    pass: newMeals >= oldMeals,
    level: 'warning',
  });

  return results;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const demoSimulatePlugin: FastifyPluginAsync<DemoDeps> = async (fastify, deps) => {
  if (process.env.NODE_ENV === 'production') {
    fastify.log.warn('[demo] Plugin skipped in production');
    return;
  }

  // Instantiate replanner pipeline (stateless, safe to create per plugin)
  const evolver = new StateEvolver();
  const operators = new MutationOperators(evolver);
  const scorer = new ObjectiveScorer(evolver);
  const beamSearch = new BeamSearch(evolver, operators, scorer, {
    beamWidth: 6,
    maxIterations: 20,
    improvementThreshold: 0.01,
    latencyBudgetMs: 4500,
  });
  const evaluator = new ReplanEffectivenessEvaluator();

  fastify.post<{ Body: SimulateBody }>('/simulate', async (req, reply) => {
    const { scenario = 'rain_heavy', transportType = 'motorbike' } = req.body ?? {};

    const t0 = Date.now();

    // 1. Load places from DB
    let allPlaces: Place[];
    try {
      allPlaces = await loadDaNangPlaces(deps.pool);
    } catch (err) {
      req.log.error({ err }, '[demo] Failed to load Da Nang places');
      return reply.status(500).send({ error: 'DB_ERROR', message: 'Cannot load places from database' });
    }

    if (allPlaces.length < 6) {
      return reply.status(500).send({ error: 'INSUFFICIENT_PLACES', message: 'Not enough Da Nang places seeded. Run npm run seed:places first.' });
    }

    // 2. Select template places
    const selection = selectTemplatePlaces(allPlaces);
    if (!selection) {
      return reply.status(500).send({ error: 'TEMPLATE_ERROR', message: 'Cannot build trip template from available places' });
    }

    // 3. Build fake trip
    const tripId = `demo-${randomUUID()}`;
    const slots = buildSlots(tripId, selection);
    const placeMap = new Map(allPlaces.map((p) => [p.placeId, p]));

    // 4. Build base BeamSearchContext
    const baseCtx: BeamSearchContext = {
      remainingSlots: slots,
      candidatePool: allPlaces,
      user: DEMO_USER,
      initialState: buildInitialState(tripId),
      weights: { ...DEFAULT_WEIGHTS },
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
      placeMap,
      replanScope: 'remaining_day',
    };

    // 5. Inject scenario
    const { ctx, originalPlanSnapshot, incident, closedPlaceId } = injectScenario(
      baseCtx,
      scenario,
      transportType,
    );

    // 6. Score baseline plan
    const oldStates = evolver.computeTrajectory(ctx.remainingSlots, ctx.initialState, ctx);
    const scoreBefore = scorer.score(ctx.remainingSlots, oldStates, ctx.weights, ctx, []);

    // 7. Run BeamSearch
    let bestNode: import('../../replanner/BeamSearch').BeamNode;
    let isFallback = false;
    try {
      bestNode = beamSearch.search(ctx);
    } catch (err) {
      req.log.error({ err }, '[demo] BeamSearch crashed — falling back to original plan');
      isFallback = true;
      bestNode = {
        plan: ctx.remainingSlots,
        stateTrajectory: oldStates,
        score: scoreBefore,
        mutationHistory: [],
        parent: null,
      };
    }

    // 8. Final TSP pass
    const finalTsp = operators.tspReorder(bestNode.plan, ctx);
    let newPlan = bestNode.plan;
    let scoreAfter = bestNode.score;
    if (finalTsp.length > 0) {
      const tspPlan = finalTsp[0]!.newPlan;
      const tspStates = evolver.computeTrajectory(tspPlan, ctx.initialState, ctx);
      const tspScore = scorer.score(tspPlan, tspStates, ctx.weights, ctx, bestNode.mutationHistory);
      newPlan = tspPlan;
      scoreAfter = tspScore;
    }

    const computeTimeMs = Date.now() - t0;
    const isTimeout = computeTimeMs >= 4500;

    // 9. Evaluate effectiveness
    let effectiveness: import('@app/types').EffectivenessReport;

    if (scenario === 'closure') {
      const criteria = evaluateClosure(closedPlaceId, originalPlanSnapshot, newPlan);
      const passed = criteria.filter((c) => c.pass).length;
      const errors = criteria.filter((c) => !c.pass && c.level === 'error');
      effectiveness = {
        tripId,
        proposalId: randomUUID(),
        evaluatedAt: new Date().toISOString(),
        incident,
        overallPass: errors.length === 0,
        passRate: criteria.length > 0 ? passed / criteria.length : 1,
        criteria,
        suggestions: errors.map((c) => `[LỖI] ${c.label}: ${c.expected}`),
        devNote: errors.length === 0
          ? `✓ Replan xử lý quán đóng cửa thành công — ${passed}/${criteria.length} tiêu chí đạt`
          : `✗ ${errors.length} tiêu chí lỗi khi xử lý quán đóng cửa`,
      };
    } else {
      try {
        effectiveness = evaluator.evaluate({
          tripId,
          proposalId: randomUUID(),
          oldPlan: originalPlanSnapshot,
          newPlan,
          placeMap,
          incident,
          userState: ctx.initialState,
        });
      } catch (_) {
        // Fallback if evaluator fails (e.g. unknown incident type)
        effectiveness = {
          tripId,
          proposalId: randomUUID(),
          evaluatedAt: new Date().toISOString(),
          incident,
          overallPass: scoreAfter > scoreBefore,
          passRate: scoreAfter > scoreBefore ? 1 : 0,
          criteria: [],
          suggestions: [],
          devNote: `Score: ${scoreBefore.toFixed(2)} → ${scoreAfter.toFixed(2)}`,
        };
      }
    }

    // 10. Build places map for frontend (only include relevant places)
    const allPlanPlaceIds = new Set([
      ...originalPlanSnapshot.map((s) => s.placeId),
      ...newPlan.map((s) => s.placeId),
    ]);
    const placesMapOut: Record<number, Place> = {};
    allPlanPlaceIds.forEach((id) => {
      const p = placeMap.get(id);
      if (p) placesMapOut[id] = p;
    });

    // 11. Build mutation summary
    const mutationSummary = bestNode.mutationHistory.map((m) => ({
      operator: m.operator,
      description: m.description,
      affectedSlotIds: m.affectedSlotIds,
    }));

    return reply.status(200).send({
      scenario,
      transportType,
      scenarioLabel: SCENARIO_LABELS[scenario],
      isFallback,
      isTimeout,
      computeTimeMs,
      scoreBefore: Math.round(scoreBefore * 1000) / 1000,
      scoreAfter: Math.round(scoreAfter * 1000) / 1000,
      scoreImprovementPct:
        scoreBefore !== 0
          ? Math.round(((scoreAfter - scoreBefore) / Math.abs(scoreBefore)) * 10000) / 100
          : 0,
      mutationCount: bestNode.mutationHistory.length,
      mutationSummary,
      oldPlan: originalPlanSnapshot,
      newPlan,
      placesMap: placesMapOut,
      effectiveness,
      causalTrace: bestNode.mutationHistory.map((m, i) => ({
        stepIndex: i,
        operator: m.operator,
        reason: m.description,
        affectedSlotIds: m.affectedSlotIds,
      })),
    });
  });
};

const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  rain_heavy: 'Mưa lớn (>25 mm/h)',
  rain_moderate: 'Mưa vừa (5–25 mm/h)',
  traffic_heavy: 'Kẹt xe nặng (~45 phút)',
  traffic_moderate: 'Kẹt xe vừa (~20 phút)',
  closure: 'Địa điểm đóng cửa đột xuất',
};
