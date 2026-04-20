/**
 * handlers.ts — Business logic for /api/trips/:tripId/replan endpoints.
 *
 * Each handler is a factory that closes over `ReplanDeps` and returns a
 * Fastify-compatible async function.  All database I/O is isolated in the
 * `db` helper section so tests can mock at the `pool` level.
 */

import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type {
  Trip,
  TripSlot,
  TripState,
  ReplanProposal,
  TripEvent,
  TripStatus,
} from '@app/types';
import type { StateEvolver } from '../../replanner/StateEvolver';
import type {
  ObjectiveScorer,
  BeamSearch,
  BeamSearchContext,
} from '../../replanner/BeamSearch';
import type { CausalTraceBuilder, CausalTrace } from '../../replanner/CausalTraceBuilder';
import type { ProposalStore } from '../../replanner/ProposalStore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReplanScope = 'remaining_day' | 'remaining_trip';

/** Parsed request bodies */
export interface ReplanBody {
  triggeredByEventId?: string;
  replanScope: ReplanScope;
}
export interface RejectBody {
  reason?: string;
}

/** Route parameter shapes */
export interface TripParams { tripId: string }
export interface ProposalParams { tripId: string; proposalId: string }

/**
 * All runtime dependencies injected into handlers.
 * Tests replace every field with vi.fn() mocks.
 */
export interface ReplanDeps {
  /** node-postgres Pool — used for direct trip/event queries and transactions. */
  pool: Pool;
  /** Loads and hydrates a BeamSearchContext from the database for a given trip. */
  planLoader: { load(tripId: string): Promise<BeamSearchContext> };
  /** Pure state machine — used to score the *old* plan before search. */
  evolver: StateEvolver;
  /** Objective scorer — used to score the *old* plan before search. */
  scorer: ObjectiveScorer;
  /** Pre-configured BeamSearch instance (carries evolver, operators, scorer). */
  beamSearch: BeamSearch;
  /** Stateful causal-trace builder (one instance per request). */
  traceBuilder: CausalTraceBuilder;
  /** Persists proposals to DB and manages status transitions. */
  proposalStore: ProposalStore;
  /** Optional event-bus publisher; defaults to a no-op. */
  publish?: (event: string, payload: Record<string, unknown>) => void;
}

/** Shape of the 201 response body. */
export interface ReplanResponseBody extends ReplanProposal {
  /** true when beam search crashed and the old plan was used as fallback. */
  isTimeout: boolean;
}

// ---------------------------------------------------------------------------
// Thin DB helpers (testable — each takes explicit pool argument)
// ---------------------------------------------------------------------------

interface TripRow {
  trip_id: string;
  user_id: string;
  status: TripStatus;
  budget_total: number;
  title: string | null;
  destination_city: string;
  start_date: string;
  end_date: string;
  hotel_place_id: number | null;
  objective_score: number | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  trip_id: string;
  status: string;
}

/** Loads minimal trip fields for request validation. */
export async function fetchTripRow(
  pool: Pool,
  tripId: string,
): Promise<TripRow | null> {
  const r = await pool.query<TripRow>(
    `SELECT trip_id, user_id, status, budget_total, title,
            destination_city, start_date, end_date,
            hotel_place_id, objective_score,
            created_at, updated_at
       FROM trip WHERE trip_id = $1`,
    [tripId],
  );
  return r.rows[0] ?? null;
}

/** Loads a trip_event row for validation. */
export async function fetchEventRow(
  pool: Pool,
  eventId: string,
): Promise<EventRow | null> {
  const r = await pool.query<EventRow>(
    `SELECT event_id, trip_id, status FROM trip_event WHERE event_id = $1`,
    [eventId],
  );
  return r.rows[0] ?? null;
}

/** Loads a refreshed Trip (with slots) after the accept transaction. */
export async function fetchUpdatedTrip(
  pool: Pool,
  tripId: string,
): Promise<Trip> {
  const [tripRes, slotRes] = await Promise.all([
    pool.query<TripRow>(`SELECT * FROM trip WHERE trip_id = $1`, [tripId]),
    pool.query<Record<string, unknown>>(
      `SELECT slot_id, trip_id, day_index, slot_order, version,
              place_id, planned_start, planned_end,
              actual_start, actual_end, estimated_cost,
              activity_type, rationale, status
         FROM trip_slot
        WHERE trip_id = $1 AND status != 'replaced'
        ORDER BY day_index, slot_order`,
      [tripId],
    ),
  ]);

  const row = tripRes.rows[0]!;
  const slots: TripSlot[] = slotRes.rows.map((s) => ({
    slotId: s['slot_id'] as string,
    tripId: s['trip_id'] as string,
    dayIndex: s['day_index'] as number,
    slotOrder: s['slot_order'] as number,
    version: s['version'] as number,
    placeId: s['place_id'] as number,
    plannedStart: s['planned_start'] as string,
    plannedEnd: s['planned_end'] as string,
    actualStart: s['actual_start'] as string | null,
    actualEnd: s['actual_end'] as string | null,
    estimatedCost: s['estimated_cost'] as number,
    activityType: s['activity_type'] as TripSlot['activityType'],
    rationale: s['rationale'] as string | null,
    status: s['status'] as TripSlot['status'],
  }));

  return {
    tripId: row.trip_id,
    userId: row.user_id,
    title: row.title,
    destinationCity: row.destination_city,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    budgetTotal: row.budget_total,
    hotelPlaceId: row.hotel_place_id,
    objectiveScore: row.objective_score,
    slots,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Runs the accept transaction atomically:
 *  1. Mark old slots as 'replaced'.
 *  2. Insert new slots with incremented version.
 *  3. Mark proposal as 'accepted'.
 *  4. Mark triggering event as 'resolved_by_replan' (if any).
 */
export async function runAcceptTransaction(
  pool: Pool,
  proposal: ReplanProposal,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get current max version
    const vRes = await client.query<{ max_version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS max_version
         FROM trip_slot WHERE trip_id = $1`,
      [proposal.tripId],
    );
    const newVersion = vRes.rows[0]!.max_version + 1;

    // 2. Mark old slots replaced
    const oldIds = proposal.oldPlanSnapshot.map((s) => s.slotId);
    if (oldIds.length > 0) {
      await client.query(
        `UPDATE trip_slot SET status = 'replaced'
          WHERE trip_id = $1 AND slot_id = ANY($2::uuid[])`,
        [proposal.tripId, oldIds],
      );
    }

    // 3. Insert new slots
    for (const slot of proposal.newPlanSnapshot) {
      await client.query(
        `INSERT INTO trip_slot
           (slot_id, trip_id, day_index, slot_order, version,
            place_id, planned_start, planned_end,
            estimated_cost, activity_type, rationale, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'planned')
         ON CONFLICT (slot_id) DO NOTHING`,
        [
          slot.slotId,
          slot.tripId,
          slot.dayIndex,
          slot.slotOrder,
          newVersion,
          slot.placeId,
          slot.plannedStart,
          slot.plannedEnd,
          slot.estimatedCost,
          slot.activityType,
          slot.rationale ?? null,
        ],
      );
    }

    // 4. Accept proposal
    await client.query(
      `UPDATE replan_proposal
          SET status = 'accepted', decided_at = NOW()
        WHERE proposal_id = $1`,
      [proposal.proposalId],
    );

    // 5. Resolve triggering event
    if (proposal.triggeredByEventId) {
      await client.query(
        `UPDATE trip_event
            SET status = 'resolved_by_replan'
          WHERE event_id = $1 AND status = 'open'`,
        [proposal.triggeredByEventId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reusable validation helper
// ---------------------------------------------------------------------------

const VALID_REPLAN_STATUSES: TripStatus[] = ['active', 'confirmed'];

/** Returns error reply or null when proposal is valid to act upon. */
async function validateProposal(
  proposalStore: ProposalStore,
  tripId: string,
  proposalId: string,
  reply: FastifyReply,
): Promise<ReplanProposal | null> {
  const proposal = await proposalStore.findById(proposalId);
  if (!proposal || proposal.tripId !== tripId) {
    await reply.status(404).send({
      error: 'NOT_FOUND',
      message: 'Proposal not found',
    });
    return null;
  }
  if (proposal.status !== 'pending') {
    await reply.status(409).send({
      error: 'PROPOSAL_NOT_PENDING',
      message: `Proposal is already ${proposal.status}`,
      details: { currentStatus: proposal.status },
    });
    return null;
  }
  if (new Date(proposal.expiresAt) <= new Date()) {
    await reply.status(409).send({
      error: 'PROPOSAL_EXPIRED',
      message: 'Proposal has expired',
      details: { expiresAt: proposal.expiresAt },
    });
    return null;
  }
  return proposal;
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

/**
 * POST /api/trips/:tripId/replan
 *
 * Triggers the full replanning pipeline and returns a new ReplanProposal.
 * On beam-search crash the old plan is used as fallback with `isTimeout: true`.
 */
export function makeReplanHandler(deps: ReplanDeps) {
  return async function replanHandler(
    request: FastifyRequest<{ Params: TripParams; Body: ReplanBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tripId } = request.params;
    const { triggeredByEventId, replanScope } = request.body;
    const userId = request.headers['x-user-id'] as string;

    // ── 1. Validate trip ─────────────────────────────────────────────────
    const tripRow = await fetchTripRow(deps.pool, tripId);
    if (!tripRow) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Trip ${tripId} not found`,
      });
    }
    if (!VALID_REPLAN_STATUSES.includes(tripRow.status)) {
      return reply.status(422).send({
        error: 'INVALID_STATUS',
        message: `Trip status '${tripRow.status}' cannot be replanned`,
        details: { allowedStatuses: VALID_REPLAN_STATUSES },
      });
    }

    // ── 2. Check for existing pending proposal ───────────────────────────
    const pending = await deps.proposalStore.findMany({
      tripId,
      status: 'pending',
      limit: 1,
    });
    if (pending.length > 0) {
      return reply.status(409).send({
        error: 'PROPOSAL_PENDING',
        message: 'A pending proposal already exists for this trip',
        details: { existingProposalId: pending[0]!.proposalId },
      });
    }

    // ── 3. Validate trigger event (optional) ─────────────────────────────
    let triggerEvent: TripEvent | null = null;
    if (triggeredByEventId) {
      const eventRow = await fetchEventRow(deps.pool, triggeredByEventId);
      if (!eventRow || eventRow.trip_id !== tripId || eventRow.status !== 'open') {
        return reply.status(404).send({
          error: 'EVENT_NOT_FOUND',
          message: 'Event not found, does not belong to this trip, or is not open',
        });
      }
      // Cast to minimal TripEvent shape — full hydration happens in PlanLoader
      triggerEvent = { eventId: eventRow.event_id } as unknown as TripEvent;
    }

    // ── 4. Load BeamSearchContext ─────────────────────────────────────────
    const ctx = await deps.planLoader.load(tripId);

    if (replanScope === 'remaining_day') {
      const today = ctx.initialState.dayIndex;
      ctx.remainingSlots = ctx.remainingSlots.filter(
        (s) => s.dayIndex === today,
      );
    }

    // ── 5. Score the old (current) plan ───────────────────────────────────
    const oldPlan = ctx.remainingSlots;
    const oldStates = deps.evolver.computeTrajectory(
      oldPlan,
      ctx.initialState,
      ctx,
    );
    const oldScore = deps.scorer.score(oldPlan, oldStates, ctx.weights, ctx);

    // ── 6. Run beam search (catch crash → fallback) ────────────────────────
    let isTimeout = false;
    let newPlan: TripSlot[];
    let newScore: number;

    try {
      const bestNode = deps.beamSearch.search(ctx);
      newPlan = bestNode.plan;
      newScore = bestNode.score;

      // Build causal trace from mutation history
      deps.traceBuilder.reset();
      deps.traceBuilder.begin(tripId, triggerEvent as TripEvent);
      bestNode.mutationHistory.forEach((m, i) => {
        deps.traceBuilder.record({
          stepIndex: i,
          reason: m.description,
          affectedSlotId: m.affectedSlotIds[0] ?? null,
          alternativeChosen:
            m.newPlan[0] != null
              ? { placeId: m.newPlan[0].placeId, reason: m.description }
              : null,
          downstreamImpact: null,
        });
      });
    } catch (err) {
      request.log.error({ err, tripId }, 'BeamSearch crashed — using fallback plan');
      isTimeout = true;
      newPlan = oldPlan;
      newScore = oldScore;
      deps.traceBuilder.reset();
      deps.traceBuilder.begin(tripId, triggerEvent as TripEvent);
    }

    const causalTrace = deps.traceBuilder.finalize();

    // ── 7. Build and persist proposal ─────────────────────────────────────
    const now = new Date();
    const proposalId = randomUUID();

    const proposal: ReplanProposal = {
      proposalId,
      tripId,
      triggeredByEventId: triggeredByEventId ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      oldPlanSnapshot: oldPlan,
      newPlanSnapshot: newPlan,
      causalTrace: causalTrace.steps,
      scoreBefore: oldScore,
      scoreAfter: newScore,
      status: 'pending',
    };

    await deps.proposalStore.save(proposal, causalTrace);

    // ── 8. Publish event ──────────────────────────────────────────────────
    deps.publish?.('trip.replan.proposed', {
      userId,
      tripId,
      proposalId,
      scoreDelta: newScore - oldScore,
    });

    const body: ReplanResponseBody = { ...proposal, isTimeout };
    return reply.status(201).send(body);
  };
}

/**
 * POST /api/trips/:tripId/replan/:proposalId/accept
 *
 * Applies the proposal's new plan atomically: marks old slots as replaced,
 * inserts new slots with an incremented version, and resolves the event.
 * Returns the refreshed Trip (200).
 */
export function makeAcceptHandler(deps: ReplanDeps) {
  return async function acceptHandler(
    request: FastifyRequest<{ Params: ProposalParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tripId, proposalId } = request.params;
    const userId = request.headers['x-user-id'] as string;

    const proposal = await validateProposal(
      deps.proposalStore,
      tripId,
      proposalId,
      reply,
    );
    if (!proposal) return; // reply already sent

    // Transaction: slots + proposal + event
    await runAcceptTransaction(deps.pool, proposal);

    // Publish
    deps.publish?.('trip.replan.accepted', {
      userId,
      tripId,
      proposalId,
      scoreDelta: proposal.scoreAfter - proposal.scoreBefore,
    });

    // Load and return the refreshed trip
    const updatedTrip = await fetchUpdatedTrip(deps.pool, tripId);
    return reply.status(200).send(updatedTrip);
  };
}

/**
 * POST /api/trips/:tripId/replan/:proposalId/reject
 *
 * Marks the proposal as rejected.  Returns 204 No Content.
 */
export function makeRejectHandler(deps: ReplanDeps) {
  return async function rejectHandler(
    request: FastifyRequest<{ Params: ProposalParams; Body: RejectBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tripId, proposalId } = request.params;
    const { reason } = request.body ?? {};
    const userId = request.headers['x-user-id'] as string;

    const proposal = await validateProposal(
      deps.proposalStore,
      tripId,
      proposalId,
      reply,
    );
    if (!proposal) return;

    await deps.proposalStore.updateStatus(proposalId, 'rejected', userId);

    deps.publish?.('trip.replan.rejected', {
      userId,
      tripId,
      proposalId,
      reason: reason ?? null,
    });

    return reply.status(204).send();
  };
}
