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
  /**
   * Factory tạo CausalTraceBuilder mới cho mỗi request. Builder có state mutable
   * (steps/tripId/startTime) nên không thể chia sẻ giữa các request đồng thời.
   */
  traceBuilder: { create(): CausalTraceBuilder };
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
  try {
    const r = await pool.query<TripRow>(
      `SELECT trip_id, user_id, status, budget_total, title,
              destination_city, start_date, end_date,
              hotel_place_id, objective_score,
              created_at, updated_at
         FROM trip WHERE trip_id = $1`,
      [tripId],
    );
    
    return r.rows[0] ?? null;
  } catch (error) {
    // Ghi log lỗi tại chỗ kèm theo tripId để dễ dàng truy vết
    console.error(`[fetchTripRow] Error fetching trip_id ${tripId}:`, error);
    
    // Ném lỗi lên tầng trên (handler) xử lý.
    // Nếu để return null ở đây, handler sẽ báo lỗi 404 sai sự thật.
    throw error;
  }
}

/** Loads a trip_event row for validation. */
export async function fetchEventRow(
  pool: Pool,
  eventId: string,
): Promise<EventRow | null> {
  try {
    const r = await pool.query<EventRow>(
      `SELECT event_id, trip_id, status FROM trip_event WHERE event_id = $1`,
      [eventId],
    );
    
    return r.rows[0] ?? null;
  } catch (error) {
    // Ghi log để dễ truy vết lỗi database
    console.error(`[fetchEventRow] Error fetching event_id ${eventId}:`, error);
    
    // Ném lỗi lên trên để handler (ví dụ: makeReplanHandler) xử lý
    throw error;
  }
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

    // 5. Cập nhật objective_score của trip để phản ánh plan mới
    await client.query(
      `UPDATE trip
          SET objective_score = $1, updated_at = NOW()
        WHERE trip_id = $2`,
      [proposal.scoreAfter, proposal.tripId],
    );

    // 6. Resolve triggering event
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
// Reusable helpers
// ---------------------------------------------------------------------------

const VALID_REPLAN_STATUSES: TripStatus[] = ['active', 'confirmed'];

/** Lấy currentArmId từ user_objective_weights để gắn vào event payload. */
async function fetchCurrentArmId(pool: Pool, userId: string): Promise<number | null> {
  const r = await pool.query<{ current_arm_id: number }>(
    'SELECT current_arm_id FROM user_objective_weights WHERE user_id = $1',
    [userId],
  );
  return r.rows[0]?.current_arm_id ?? null;
}

/**
 * Gửi reward tới preference-service (fire-and-forget, không block response).
 * Preference-service cập nhật bandit arm stats sau mỗi replan decision.
 */
function notifyPreferenceReward(payload: {
  userId: string;
  tripId: string;
  armId: number;
  interactionType: string;
  placeId?: number;
}): void {
  const prefUrl = process.env.PREFERENCE_SERVICE_URL ?? 'http://localhost:3001';
  fetch(`${prefUrl}/api/preferences/internal/reward`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => console.error('[preference-service reward]', err));
}

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
 * GET /api/trips/:tripId/replan/pending
 *
 * Returns the current pending proposal for a trip, or null if none exists.
 */
export function makePendingHandler(deps: ReplanDeps) {
  return async function pendingHandler(
    request: FastifyRequest<{ Params: TripParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const { tripId } = request.params;
      
      const pending = await deps.proposalStore.findMany({
        tripId,
        status: 'pending',
        limit: 1
      });
      
      return reply.status(200).send(pending[0] ?? null);
      
    } catch (error) {
      // 1. Log in English
      request.log.error({
        err: error,
        context: { tripId: request.params?.tripId },
        msg: 'Failed to fetch pending proposal from database'
      });

      // 2. Client response in English
      return reply.status(500).send({
        success: false,
        message: 'Unable to retrieve the pending proposal at this time. Please try again later.',
        errorCode: 'FETCH_PENDING_PROPOSAL_ERROR'
      });
    }
  };
}

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
    
    //console.log(`>>>> eventId: ${triggeredByEventId}`);
    if(!userId) {
      return reply.status(400).send({
        error: 'UNAUTHORIZED',
        message: `User ${userId} not found`,
      });
    }

    // ── 1. Validate trip ─────────────────────────────────────────────────
    const tripRow = await fetchTripRow(deps.pool, tripId);
    if (!tripRow) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: `Trip ${tripId} not found`,
      });
    }
    console.log(`>>>>> tripRow.status: ${tripRow.status}`);
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
    const ctx = await deps.planLoader.load(tripId).catch(error => {
      console.error(`[PlanLoader] Cannot load trip ${tripId}:`, error.message);
      return reply.status(500).send({
        error: 'TRIP_LOAD_FAILED',
        message: `Trip cannot load trip ${tripId}`
      })
    });
    
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
    // Tạo trace builder cục bộ cho request này — tránh race condition.
    const traceBuilder = deps.traceBuilder.create();
    let isTimeout = false;
    let newPlan: TripSlot[];
    let newScore: number;

    try {
      const bestNode = deps.beamSearch.search(ctx);
      newPlan = bestNode.plan;
      newScore = bestNode.score;

      // Build causal trace from mutation history
      traceBuilder.begin(tripId, triggerEvent as TripEvent);
      bestNode.mutationHistory.forEach((m, i) => {
        traceBuilder.record({
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
      traceBuilder.begin(tripId, triggerEvent as TripEvent);
    }

    const causalTrace = traceBuilder.finalize();

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

    if(!userId) {
      return reply.status(400).send({
        error: 'UNAUTHORIZED',
        message: `User ${userId} not found`,
      });
    }

    const proposal = await validateProposal(
      deps.proposalStore,
      tripId,
      proposalId,
      reply,
    );
    if (!proposal) return; // reply already sent

    // Transaction: slots + proposal + event
    await runAcceptTransaction(deps.pool, proposal);

    // Lấy armId của user để gắn vào event và cập nhật bandit
    const armId = await fetchCurrentArmId(deps.pool, userId);

    // Publish
    deps.publish?.('trip.replan.accepted', {
      userId,
      tripId,
      proposalId,
      armId,
      scoreDelta: proposal.scoreAfter - proposal.scoreBefore,
    });

    // Cập nhật bandit reward (fire-and-forget)
    if (armId != null) {
      notifyPreferenceReward({ userId, tripId, armId, interactionType: 'replan_accepted' });
    }

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

    if(!userId) {
      return reply.status(400).send({
        error: 'UNAUTHORIZED',
        message: `User ${userId} not found`,
      });
    }

    const proposal = await validateProposal(
      deps.proposalStore,
      tripId,
      proposalId,
      reply,
    );
    if (!proposal) return;

    await deps.proposalStore.updateStatus(proposalId, 'rejected', userId);

    const armId = await fetchCurrentArmId(deps.pool, userId);

    deps.publish?.('trip.replan.rejected', {
      userId,
      tripId,
      proposalId,
      armId,
      reason: reason ?? null,
    });

    // Cập nhật bandit reward (fire-and-forget)
    if (armId != null) {
      notifyPreferenceReward({ userId, tripId, armId, interactionType: 'replan_rejected' });
    }

    return reply.status(204).send();
  };
}
