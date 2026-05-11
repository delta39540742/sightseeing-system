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
  IncidentContext,
  TransportType,
} from '@app/types';
import type { StateEvolver } from '../../replanner/StateEvolver';
import { dot, tagVectorOf } from '../../replanner/StateEvolver';
import type {
  ObjectiveScorer,
  BeamSearch,
  BeamSearchContext,
} from '../../replanner/BeamSearch';
import type { CausalTraceBuilder, CausalTrace } from '../../replanner/CausalTraceBuilder';
import type { ProposalStore } from '../../replanner/ProposalStore';
import { MutationOperators } from '../../replanner/MutationOperators';
import {
  ReplanEffectivenessEvaluator,
  classifyRainSeverity,
  classifyTrafficSeverity,
} from '../../replanner/EffectivenessEvaluator';
import { EffectivenessLogger } from '../../replanner/EffectivenessLogger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReplanScope = 'remaining_day' | 'remaining_trip';

/** Parsed request bodies */
export interface ReplanBody {
  triggeredByEventId?: string;
  replanScope: ReplanScope;
  /** GPS coordinates of the user at the time of replanning. When provided,
   *  overrides the simulated/default position in initialState so travel-time
   *  calculations start from where the user actually is. */
  currentLocation?: { lat: number; lng: number };
}
export interface RejectBody {
  reason?: string;
}

export interface AcceptBody {
  /** Khi truyền: chỉ áp dụng các slot mới có slotId trong danh sách này (partial accept).
   *  Khi bỏ qua: áp dụng toàn bộ newPlanSnapshot (full accept). */
  partialNewSlotIds?: string[];
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
  /** Dev-only: evaluates replan quality against semantic incident rules. */
  effectivenessEvaluator?: ReplanEffectivenessEvaluator;
  /** Dev-only: persists effectiveness reports to replan_effectiveness_log. */
  effectivenessLogger?: EffectivenessLogger;
}

/** Shape of the 201 response body. */
export interface ReplanResponseBody extends ReplanProposal {
  /** true when the latency budget was exceeded during search. */
  isTimeout: boolean;
  /** true when beam search crashed and the old plan was used as fallback. */
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

/** Straight-line distance in metres (Haversine formula). */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  event_type: string;
  payload: string;
  affected_slot_ids: string[];
}

/**
 * @summary Truy vấn thông tin cơ bản của chuyến đi từ database để phục vụ validation request.
 *
 * Thực hiện SELECT các trường cần thiết cho kiểm tra quyền và trạng thái (`status`, `userId`,
 * `budget`...). Được thiết kế gọn nhẹ để tái sử dụng trong nhiều handler khác nhau.
 *
 * **Side Effects:**
 * - Thực hiện 1 truy vấn SQL SELECT.
 * - Ghi `console.error` nếu query thất bại, sau đó ném lỗi lên caller.
 *
 * @param pool   {Pool|PoolClient} Pool kết nối database hoặc client đang trong transaction.
 *   Không được null.
 * @param tripId {string}         UUID của chuyến đi cần tra cứu. Phải là UUID hợp lệ.
 * @returns {Promise<TripRow|null>} Row chứa thông tin trip, hoặc `null` nếu không tìm thấy.
 * @throws {Error} Bất kỳ lỗi database nào (connection, timeout...) — được ném lên caller để
 *   tránh trả về `null` sai sự thật (sẽ khiến handler báo 404 thay vì 500).
 *
 * @pre `tripId` là chuỗi UUID hợp lệ; `pool` đang kết nối.
 * @post Chỉ đọc dữ liệu, không ghi vào database.
 *
 * @example
 * ```typescript
 * const row = await fetchTripRow(pool, '550e8400-e29b-41d4-a716-446655440000');
 * if (!row) return reply.status(404).send({ error: 'NOT_FOUND' });
 * if (row.status === 'cancelled') return reply.status(422).send({ error: 'INVALID_STATUS' });
 * ```
 */
export async function fetchTripRow(
  pool: Pool | PoolClient,
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

/**
 * @summary Truy vấn một row trip_event để xác thực tính hợp lệ của trigger event.
 *
 * Lấy các trường `event_id`, `trip_id`, `status` cần thiết để kiểm tra event có thuộc
 * đúng trip và đang ở trạng thái `'open'` hay không trước khi kích hoạt replan.
 *
 * **Side Effects:**
 * - Thực hiện 1 truy vấn SQL SELECT.
 * - Ghi `console.error` nếu query thất bại, sau đó ném lỗi lên caller.
 *
 * @param pool    {Pool|PoolClient} Pool kết nối database hoặc client trong transaction.
 * @param eventId {string}         UUID của event cần tra cứu. Phải là UUID hợp lệ.
 * @returns {Promise<EventRow|null>} Row event gồm `event_id`, `trip_id`, `status`,
 *   hoặc `null` nếu không tìm thấy.
 * @throws {Error} Lỗi database — được ném lên caller để handler trả về 500 thay vì 404 sai.
 *
 * @pre `eventId` là UUID hợp lệ; `pool` đang kết nối.
 * @post Chỉ đọc dữ liệu, không ghi vào database.
 *
 * @example
 * ```typescript
 * const ev = await fetchEventRow(pool, eventId);
 * if (!ev || ev.trip_id !== tripId || ev.status !== 'open') {
 *   return reply.status(404).send({ error: 'EVENT_NOT_FOUND' });
 * }
 * ```
 */
export async function fetchEventRow(
  pool: Pool | PoolClient,
  eventId: string,
): Promise<EventRow | null> {
  try {
    const r = await pool.query<EventRow>(
      `SELECT event_id, trip_id, status, event_type, payload, affected_slot_ids
         FROM trip_event WHERE event_id = $1`,
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

/**
 * @summary Tải lại toàn bộ Trip (header + slots) sau khi accept transaction hoàn tất.
 *
 * Thực hiện 2 truy vấn song song (`Promise.all`) để đảm bảo dữ liệu trả về là mới nhất:
 * - `trip`: Header của chuyến đi (status, budget, dates...).
 * - `trip_slot`: Danh sách slot hiện hành — loại trừ slot có `status='replaced'`.
 *
 * Mục đích: Trả về Trip object hoàn chỉnh cho frontend hiển thị ngay sau khi user chấp nhận
 * đề xuất tái lập lịch.
 *
 * **Side Effects:** Thực hiện 2 truy vấn SQL SELECT song song.
 *
 * @param pool   {Pool|PoolClient} Pool kết nối database.
 * @param tripId {string}         UUID của trip cần tải lại.
 * @returns {Promise<Trip>} Đối tượng Trip đầy đủ gồm header và danh sách slot hiện hành.
 * @throws {Error} `"Trip ${tripId} not found while fetching updated trip"` nếu trip không tồn tại.
 * @throws {Error} Lỗi database khác.
 *
 * @pre Trip phải tồn tại trong database. Nên gọi **sau** khi `runAcceptTransaction` thành công.
 * @post `Trip.slots` không chứa slot nào có `status='replaced'`.
 *
 * @example
 * ```typescript
 * await runAcceptTransaction(pool, proposal);
 * const updatedTrip = await fetchUpdatedTrip(pool, proposal.tripId);
 * return reply.status(200).send(updatedTrip);
 * ```
 */
export async function fetchUpdatedTrip(
  pool: Pool | PoolClient,
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

  if (!row) {
    throw new Error(`Trip ${tripId} not found while fetching updated trip`);
  }

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
 * @summary Thực thi giao dịch chấp nhận đề xuất tái lập lịch một cách nguyên tử (atomic).
 *
 * Thực hiện 6 thao tác trong một transaction duy nhất (BEGIN ... COMMIT):
 * 1. Lấy `MAX(version)` hiện tại của `trip_slot` để tính version mới.
 * 2. Đánh dấu toàn bộ slot cũ trong `oldPlanSnapshot` thành `status='replaced'`.
 * 3. Chèn toàn bộ slot mới từ `newPlanSnapshot` với version tăng thêm 1 (`ON CONFLICT DO NOTHING`).
 * 4. Cập nhật `replan_proposal.status = 'accepted'` và `decided_at = NOW()`.
 * 5. Cập nhật `trip.objective_score = proposal.scoreAfter`.
 * 6. Nếu có `triggeredByEventId`: cập nhật `trip_event.status = 'resolved_by_replan'`.
 *
 * **Side Effects:**
 * - Ghi vào bảng `trip_slot`, `replan_proposal`, `trip`, `trip_event`.
 * - Nếu bất kỳ bước nào thất bại: tự động ROLLBACK — đảm bảo không có partial write.
 * - Luôn `release()` client về pool dù thành công hay thất bại (khối `finally`).
 *
 * @param pool     {Pool}           Pool kết nối database để lấy client riêng cho transaction.
 * @param proposal {ReplanProposal} Đề xuất cần xử lý — phải có `status='pending'` và chưa hết hạn.
 *   Các trường bắt buộc: `proposalId`, `tripId`, `oldPlanSnapshot`, `newPlanSnapshot`,
 *   `scoreAfter`, `triggeredByEventId` (nullable).
 * @returns {Promise<void>} Không trả về giá trị — chỉ ném exception khi thất bại.
 * @throws {Error} Bất kỳ lỗi SQL nào sẽ trigger ROLLBACK rồi ném lên caller.
 *
 * @pre `proposal.status === 'pending'`; `pool` có quyền ghi vào các bảng liên quan.
 *   Mọi `slot.slotId` trong `newPlanSnapshot` phải là UUID hợp lệ.
 * @post (Khi thành công) Slots cũ: `status='replaced'`; slots mới: được chèn với version tăng;
 *   `proposal.status='accepted'`; `trip.objective_score` cập nhật; event resolved (nếu có).
 *
 * @example
 * ```typescript
 * try {
 *   await runAcceptTransaction(pool, proposal);
 *   // Transaction đã commit thành công
 * } catch (err) {
 *   // Transaction đã rollback — không có partial write
 *   throw err;
 * }
 * ```
 */
export async function runAcceptTransaction(
  pool: Pool,
  proposal: ReplanProposal,
  partialNewSlotIds?: string[] | null,
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

    // 2. Determine which new slots to apply (all or partial)
    const slotsToApply = partialNewSlotIds
      ? proposal.newPlanSnapshot.filter((s) => partialNewSlotIds.includes(s.slotId))
      : proposal.newPlanSnapshot;

    // 3. Build lookup of old slot IDs to distinguish REPLACE_PLACE vs INSERT_ALT
    const oldSlotIdSet = new Set(proposal.oldPlanSnapshot.map((s) => s.slotId));

    // 3b. Re-number slotOrder per day to guarantee uniqueness.
    //     Beam search may produce snapshots where an old slot (UPDATE path) and
    //     a new slot (INSERT path) share the same (dayIndex, slotOrder), which
    //     would violate the unique constraint (trip_id, day_index, slot_order, version).
    const dayBuckets = new Map<number, typeof slotsToApply>();
    for (const slot of slotsToApply) {
      let bucket = dayBuckets.get(slot.dayIndex);
      if (!bucket) { bucket = []; dayBuckets.set(slot.dayIndex, bucket); }
      bucket.push(slot);
    }
    for (const [, bucket] of dayBuckets) {
      bucket.sort((a, b) => a.slotOrder - b.slotOrder);
      bucket.forEach((slot, idx) => { slot.slotOrder = idx + 1; });
    }

    // 4. Process each slot to apply:
    //    - Same slotId in old plan (REPLACE_PLACE/REORDER): UPDATE in-place — fixes the
    //      silent data loss that occurred with the previous ON CONFLICT DO NOTHING approach.
    //    - New slotId (INSERT_ALT/NEW): INSERT normally.
    for (const slot of slotsToApply) {
      if (oldSlotIdSet.has(slot.slotId)) {
        await client.query(
          `UPDATE trip_slot
              SET place_id       = $1,
                  planned_start  = $2,
                  planned_end    = $3,
                  estimated_cost = $4,
                  activity_type  = $5,
                  rationale      = $6,
                  version        = $7,
                  day_index      = $8,
                  slot_order     = $9,
                  status         = 'planned',
                  actual_start   = NULL,
                  actual_end     = NULL
            WHERE slot_id = $10 AND trip_id = $11`,
          [
            slot.placeId,
            slot.plannedStart,
            slot.plannedEnd,
            slot.estimatedCost,
            slot.activityType,
            slot.rationale ?? null,
            newVersion,
            slot.dayIndex,
            slot.slotOrder,
            slot.slotId,
            proposal.tripId,
          ],
        );
      } else {
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
    }

    // 5. Full accept only: mark old slots that were REMOVED (not present in newPlanSnapshot)
    if (!partialNewSlotIds) {
      const newPlanSlotIdSet = new Set(proposal.newPlanSnapshot.map((s) => s.slotId));
      const removedOldIds = proposal.oldPlanSnapshot
        .filter((s) => !newPlanSlotIdSet.has(s.slotId))
        .map((s) => s.slotId);
      if (removedOldIds.length > 0) {
        await client.query(
          `UPDATE trip_slot SET status = 'replaced'
            WHERE trip_id = $1 AND slot_id = ANY($2::uuid[])`,
          [proposal.tripId, removedOldIds],
        );
      }
    }

    // 6. Accept proposal
    await client.query(
      `UPDATE replan_proposal
          SET status = 'accepted', decided_at = NOW()
        WHERE proposal_id = $1`,
      [proposal.proposalId],
    );

    // 7. Cập nhật objective_score + đồng bộ start_date/end_date theo slot mới
    const appliedSlots = partialNewSlotIds
      ? proposal.newPlanSnapshot.filter((s) => partialNewSlotIds.includes(s.slotId))
      : proposal.newPlanSnapshot;
    const slotDates = appliedSlots.map((s) => new Date(s.plannedStart));
    const slotEndDates = appliedSlots.map((s) => new Date(s.plannedEnd));
    const newStartDate = slotDates.length > 0
      ? new Date(Math.min(...slotDates.map((d) => d.getTime()))).toISOString().slice(0, 10)
      : null;
    const newEndDate = slotEndDates.length > 0
      ? new Date(Math.max(...slotEndDates.map((d) => d.getTime()))).toISOString().slice(0, 10)
      : null;
    await client.query(
      `UPDATE trip
          SET objective_score = $1,
              ${newStartDate ? 'start_date = $3, end_date = $4,' : ''}
              updated_at = NOW()
        WHERE trip_id = $2`,
      newStartDate
        ? [proposal.scoreAfter, proposal.tripId, newStartDate, newEndDate]
        : [proposal.scoreAfter, proposal.tripId],
    );

    // 8. Resolve triggering event
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

/**
 * @summary Lấy ID cánh tay bandit hiện tại của người dùng để gắn vào event payload.
 *
 * Tra cứu `current_arm_id` trong bảng `user_objective_weights`. Kết quả được dùng để
 * preference-service biết cánh tay UCB1 nào đang được thử nghiệm và cập nhật thống kê đúng arm.
 *
 * **Side Effects:** Thực hiện 1 truy vấn SQL SELECT.
 *
 * @param pool   {Pool}   Pool kết nối database.
 * @param userId {string} Firebase UID của người dùng — không được rỗng.
 * @returns {Promise<number|null>} `current_arm_id` nếu user có dòng weights,
 *   hoặc `null` nếu user mới chưa có weights row.
 * @throws {Error} Lỗi database — được ném lên caller.
 *
 * @pre `userId` không rỗng; `pool` đang kết nối.
 * @post Chỉ đọc dữ liệu, không ghi.
 *
 * @example
 * ```typescript
 * const armId = await fetchCurrentArmId(pool, 'firebase-uid-abc');
 * // armId: 3   → đang dùng cánh tay 'exploration'
 * // armId: null → user mới chưa có weights
 * ```
 */
async function fetchCurrentArmId(pool: Pool, firebaseUid: string): Promise<number | null> {
  const r = await pool.query<{ current_arm_id: number }>(
    `SELECT w.current_arm_id
     FROM user_objective_weights w
     JOIN app_user u ON u.user_id = w.user_id
     WHERE u.firebase_uid = $1`,
    [firebaseUid],
  );
  return r.rows[0]?.current_arm_id ?? null;
}

/**
 * @summary Gửi sự kiện reward đến preference-service theo cơ chế fire-and-forget.
 *
 * Thực hiện HTTP POST đến `PREFERENCE_SERVICE_URL/api/preferences/internal/reward` để
 * preference-service cập nhật thống kê bandit arm (UCB1) sau mỗi quyết định của người dùng.
 * Hàm trả về ngay lập tức mà không chờ phản hồi — lỗi chỉ được ghi log, không làm request
 * chính thất bại.
 *
 * **Side Effects:**
 * - Gửi HTTP POST đến external service (bất đồng bộ, không blocking).
 * - Ghi `console.error` nếu fetch thất bại.
 *
 * @param payload.userId          {string}  Firebase UID của người dùng.
 * @param payload.tripId          {string}  UUID chuyến đi liên quan.
 * @param payload.armId           {number}  ID cánh tay bandit hiện tại.
 * @param payload.interactionType {string}  Loại tương tác: `'replan_accepted'` hoặc `'replan_rejected'`.
 * @param payload.placeId         {number}  (Tùy chọn) placeId liên quan đến tương tác.
 * @returns {void} Không trả về — phản hồi từ preference-service bị bỏ qua.
 *
 * @pre `PREFERENCE_SERVICE_URL` env var được set (mặc định: `http://localhost:3001`).
 *   `armId` phải là số nguyên hợp lệ.
 * @post Preference-service sẽ xử lý reward bất đồng bộ — không có đảm bảo delivery.
 *
 * @example
 * ```typescript
 * notifyPreferenceReward({
 *   userId: 'firebase-uid-abc',
 *   tripId: '550e8400-...',
 *   armId: 2,
 *   interactionType: 'replan_accepted',
 * });
 * // Trả về ngay — không cần await
 * ```
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

/**
 * @summary Xác thực trạng thái và quyền sở hữu của một ReplanProposal trước khi cho phép thao tác.
 *
 * Thực hiện 3 bước kiểm tra tuần tự, tự động gửi reply error nếu thất bại ở bước nào:
 * 1. **Tồn tại & Ownership**: Proposal phải tồn tại và `proposal.tripId === tripId`.
 *    → Fail: reply 404 `NOT_FOUND`.
 * 2. **Trạng thái**: Proposal phải đang ở `status='pending'`.
 *    → Fail: reply 409 `PROPOSAL_NOT_PENDING` kèm `details.currentStatus`.
 * 3. **Hết hạn**: `proposal.expiresAt > Date.now()`.
 *    → Fail: reply 409 `PROPOSAL_EXPIRED` kèm `details.expiresAt`.
 *
 * **Side Effects:**
 * - Gọi `proposalStore.findById()` — thường là 1 DB query.
 * - Tự động gửi Fastify reply khi validation thất bại (caller không cần gửi thêm).
 *
 * @param proposalStore {ProposalStore} Store để tra cứu proposal theo ID.
 * @param tripId        {string}        UUID của trip — kiểm tra ownership.
 * @param proposalId    {string}        UUID của proposal cần xác thực.
 * @param reply         {FastifyReply}  Fastify reply object để gửi error response khi cần.
 * @returns {Promise<ReplanProposal|null>} Proposal hợp lệ, hoặc `null` nếu validation thất bại
 *   (response lỗi đã được gửi). Caller **phải** kiểm tra `if (!proposal) return;`.
 * @throws {Error} Lỗi từ `proposalStore.findById()` — không bắt giữ nội bộ.
 *
 * @pre `proposalId` và `tripId` là UUID hợp lệ.
 * @post Nếu trả về `null`: Fastify reply đã được gửi với mã lỗi 404 hoặc 409.
 *   Nếu trả về proposal: proposal đang `pending` và chưa hết hạn.
 *
 * @example
 * ```typescript
 * const proposal = await validateProposal(deps.proposalStore, tripId, proposalId, reply);
 * if (!proposal) return; // reply đã được gửi, thoát handler ngay
 * // Tiếp tục xử lý với proposal hợp lệ
 * ```
 */
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
// Effectiveness evaluation helpers
// ---------------------------------------------------------------------------

// Rain mm/h by event_type (mirrors the mapping inside makeReplanHandler)
const RAIN_MM_BY_EVENT: Record<string, number> = {
  rain_heavy: 10,
  rain_light:  3,
  storm:      20,
};

// Estimated traffic delay in minutes by event_type
const TRAFFIC_DELAY_BY_EVENT: Record<string, number> = {
  traffic_heavy:    45,
  traffic_moderate: 20,
  traffic_light:    10,
};

function tryParseJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

/**
 * Builds an IncidentContext from a trigger event row and current trip context.
 * Returns null when the event type is not a recognised incident.
 */
function buildIncidentContext(
  eventRow: EventRow,
  originalPlan: TripSlot[],
  ctx: BeamSearchContext,
): IncidentContext | null {
  const payload = tryParseJson(eventRow.payload) ?? {};
  const firstSlot = originalPlan[0];
  const firstPlace = firstSlot
    ? ctx.candidatePool.find((p) => p.placeId === firstSlot.placeId)
    : null;
  const distKm = firstPlace
    ? haversineM(
        ctx.initialState.currentLat, ctx.initialState.currentLng,
        firstPlace.lat, firstPlace.lng,
      ) / 1000
    : undefined;

  const rainMmPerH = RAIN_MM_BY_EVENT[eventRow.event_type];
  if (rainMmPerH !== undefined) {
    return {
      type:                    'rain',
      severity:                classifyRainSeverity(rainMmPerH),
      rainMmPerH,
      userTransportType:       (payload['transportType'] as TransportType) ?? undefined,
      distanceToOriginalDestKm: distKm,
    };
  }

  const trafficDelayMin = TRAFFIC_DELAY_BY_EVENT[eventRow.event_type];
  if (trafficDelayMin !== undefined) {
    return {
      type:                    'traffic_delay',
      severity:                classifyTrafficSeverity(trafficDelayMin),
      trafficDelayMin,
      distanceToOriginalDestKm: distKm,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler factories
// ---------------------------------------------------------------------------

/**
 * @summary Tạo handler Fastify cho endpoint GET `/api/trips/:tripId/replan/pending`.
 *
 * Trả về đề xuất tái lập lịch đang chờ xử lý (`status='pending'`) cho một chuyến đi.
 * Đây là endpoint polling — frontend gọi định kỳ để biết có đề xuất mới cần hiển thị không.
 * Nếu không có đề xuất nào, trả về `null` thay vì 404 (để phân biệt "không có" với "lỗi").
 *
 * **Side Effects (mỗi request):**
 * - Gọi `deps.proposalStore.findMany()` — thường là 1 DB query.
 *
 * **Phản hồi:**
 * - `200 OK`: Proposal object nếu có đề xuất pending, hoặc `null` nếu không có.
 * - `500 Internal Server Error`: Khi không thể truy vấn store (kèm `errorCode: 'FETCH_PENDING_PROPOSAL_ERROR'`).
 *
 * @param deps {ReplanDeps} Các dependency đã inject — cần `deps.proposalStore`.
 * @returns Handler function tương thích với Fastify (async function, không ném exception).
 *   Mọi lỗi đều được bắt và trả về 500.
 *
 * @pre `deps.proposalStore.findMany` phải hoạt động bình thường.
 * @post Response luôn được gửi (200 hoặc 500) — không để request treo.
 *
 * @example
 * ```typescript
 * // Đăng ký route:
 * fastify.get('/trips/:tripId/replan/pending', {}, makePendingHandler(deps));
 *
 * // Frontend polling:
 * const res = await fetch('/api/trips/abc123/replan/pending');
 * const proposal = await res.json(); // null hoặc ReplanProposal object
 * ```
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
 * @summary Tạo handler Fastify cho endpoint POST `/api/trips/:tripId/replan`.
 *
 * Kích hoạt toàn bộ pipeline tái lập lịch và trả về `ReplanProposal` mới với trạng thái `pending`.
 * Pipeline thực hiện tuần tự:
 * 1. Xác thực `x-user-id` header, trip status (`active` hoặc `confirmed`), và không có proposal pending.
 * 2. Kiểm tra trigger event (nếu có) — phải thuộc đúng trip và đang `'open'`.
 * 3. Tải `BeamSearchContext` qua `planLoader.load()`.
 * 4. Lọc scope (`remaining_day`): chỉ giữ slot của ngày hiện tại.
 * 5. Tiền xử lý overflow (`remaining_trip`): gọi `operators.prepareContext()`.
 * 6. Chạy `beamSearch.search()` trong latency budget (mặc định 4500ms).
 *    - Nếu crash: dùng kế hoạch cũ làm fallback, `isFallback=true`, `isTimeout=true`.
 *    - Nếu hết thời gian: `isTimeout=true`.
 * 7. Lưu proposal vào DB qua `proposalStore.save()`.
 * 8. Publish event `trip.replan.proposed` (fire-and-forget nếu `deps.publish` tồn tại).
 *
 * **Side Effects (mỗi request):**
 * - Nhiều truy vấn DB (load trip, load context, save proposal).
 * - Gọi `Date.now()` để đo latency.
 * - Publish event nếu `deps.publish` được cung cấp.
 *
 * **Phản hồi:**
 * - `201 Created`: `ReplanProposal` kèm `isTimeout` và `isFallback`.
 * - `400`: Thiếu `x-user-id` header.
 * - `404`: Trip hoặc event không tìm thấy.
 * - `409`: Đã có proposal pending.
 * - `422`: Trip status không hợp lệ (không phải `active`/`confirmed`).
 * - `500`: Lỗi nội bộ (DB, planLoader, proposalStore.save...).
 *
 * @param deps {ReplanDeps} Tất cả dependency đã inject (pool, planLoader, beamSearch, scorer...).
 * @returns Handler function tương thích Fastify — async, bắt mọi exception.
 *
 * @pre Trip phải tồn tại, đang `active` hoặc `confirmed`, và không có proposal `pending`.
 *   `x-user-id` header phải có mặt trong request.
 * @post Proposal mới được lưu vào DB với `status='pending'`, hết hạn sau 30 phút.
 *   Kế hoạch cũ (oldPlanSnapshot) và kế hoạch mới (newPlanSnapshot) đều được lưu kèm.
 *
 * @example
 * ```typescript
 * fastify.post('/trips/:tripId/replan', {}, makeReplanHandler(deps));
 *
 * // Request:
 * // POST /api/trips/abc/replan
 * // Headers: { 'x-user-id': 'user-123' }
 * // Body: { replanScope: 'remaining_trip' }
 *
 * // Response 201:
 * // { proposalId: '...', isTimeout: false, isFallback: false, scoreBefore: 12.3, scoreAfter: 14.7, ... }
 * ```
 */
export function makeReplanHandler(deps: ReplanDeps) {
  return async function replanHandler(
    request: FastifyRequest<{ Params: TripParams; Body: ReplanBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    // TODO: ảnh hưởng đến database nên hiện tại không dám làm
    /** Tôn trọng POI trong 1 ngày cụ thể
     * repairSuffix không tôn trọng ranh giới ngày gốc (cần có {@link lockedDay}).
     * Khi phạm vi remaining_trip, plan chứa slots của nhiều ngày. 
     * repairSuffix bắt đầu từ fromIndex và tuần tự tăng currentDayIndex mỗi khi vượt ngày, 
     * ghi đè hoàn toàn chỉ số ngày của các slot phía sau. 
     * Điều này có thể đẩy một slot dự kiến ở ngày thứ 2 thành ngày thứ 1, 
     * gây bất ngờ cho người dùng nếu lịch trình phải giữ cố định ngày 
     * (ví dụ: vé máy bay, check-in khách sạn). Cần cân nhắc giới hạn không chuyển slot 
     * sang ngày sớm hơn ngày gốc, hoặc cần một cơ chế ràng buộc mềm hơn.
     */
    const { tripId } = request.params;
    const { triggeredByEventId, replanScope, currentLocation } = request.body;
    const userId = request.headers['x-user-id'] as string;

    console.log(`\n[REPLAN] ── START ──────────────────────────────────`);
    console.log(`[REPLAN] tripId           : ${tripId}`);
    console.log(`[REPLAN] replanScope      : ${replanScope}`);
    console.log(`[REPLAN] triggeredByEventId: ${triggeredByEventId ?? '(none)'}`);
    console.log(`[REPLAN] userId           : ${userId ?? '(missing)'}`);

    if (!userId) {
      return reply.status(400).send({
        error: 'UNAUTHORIZED',
        message: `Missing x-user-id header`,
      });
    }

    try {
      // ── 1. Validate trip ──────────────────────────────────────────────────
      const tripRow = await fetchTripRow(deps.pool, tripId);
      if (!tripRow) {
        console.log(`[REPLAN] STEP 1 FAIL: trip not found`);
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Trip ${tripId} not found`,
        });
      }
      console.log(`[REPLAN] STEP 1 OK: trip status = '${tripRow.status}'`);
      if (!VALID_REPLAN_STATUSES.includes(tripRow.status)) {
        console.log(`[REPLAN] STEP 1 FAIL: status '${tripRow.status}' not in ${JSON.stringify(VALID_REPLAN_STATUSES)} → 422`);
        return reply.status(422).send({
          error: 'INVALID_STATUS',
          message: `Trip status '${tripRow.status}' cannot be replanned`,
          details: { allowedStatuses: VALID_REPLAN_STATUSES },
        });
      }

      // ── 2. Check for existing pending proposal ────────────────────────────
      const pending = await deps.proposalStore.findMany({
        tripId,
        status: 'pending',
        limit: 1,
      });
      if (pending.length > 0) {
        const existingProposal = pending[0]!;
        // Supersede stale proposal when triggered by a different event
        if (triggeredByEventId && existingProposal.triggeredByEventId !== triggeredByEventId) {
          console.log(`[REPLAN] STEP 2: superseding stale proposal (id: ${existingProposal.proposalId}, old event: ${existingProposal.triggeredByEventId}) → replacing with new event ${triggeredByEventId}`);
          await deps.proposalStore.updateStatus(existingProposal.proposalId, 'rejected', userId);
        } else {
          console.log(`[REPLAN] STEP 2 FAIL: pending proposal already exists → 409 (id: ${existingProposal.proposalId})`);
          return reply.status(409).send({
            error: 'PROPOSAL_PENDING',
            message: 'A pending proposal already exists for this trip',
            details: { existingProposalId: existingProposal.proposalId },
          });
        }
      }
      console.log(`[REPLAN] STEP 2 OK: no pending proposal`);

      // ── 3. Validate trigger event (optional) ──────────────────────────────
      let triggerEvent: TripEvent | null = null;
      let triggerEventRow: EventRow | null = null;
      if (triggeredByEventId) {
        const eventRow = await fetchEventRow(deps.pool, triggeredByEventId);
        console.log(`[REPLAN] STEP 3: event row =`, eventRow
          ? `{ event_type: '${eventRow.event_type}', status: '${eventRow.status}', affected_slot_ids: ${JSON.stringify(eventRow.affected_slot_ids)} }`
          : 'NOT FOUND'
        );
        if (!eventRow || eventRow.trip_id !== tripId || eventRow.status !== 'open') {
          console.log(`[REPLAN] STEP 3 FAIL: event invalid or not open → 404`);
          return reply.status(404).send({
            error: 'EVENT_NOT_FOUND',
            message: 'Event not found, does not belong to this trip, or is not open',
          });
        }
        triggerEvent = { eventId: eventRow.event_id } as unknown as TripEvent;
        triggerEventRow = eventRow;
        console.log(`[REPLAN] STEP 3 OK: event accepted`);
      } else {
        console.log(`[REPLAN] STEP 3 SKIP: no triggeredByEventId`);
      }

      // ── 4. Load BeamSearchContext ──────────────────────────────────────────
      let ctx: BeamSearchContext;
      try {
        ctx = await deps.planLoader.load(tripId);
      } catch (error) {
        request.log.error({ err: error, tripId }, 'PlanLoader failed');
        return reply.status(500).send({
          error: 'TRIP_LOAD_FAILED',
          message: `Trip ${tripId} cannot be loaded`,
        });
      }
      const indoorCount = ctx.candidatePool.filter(p => p.indoorOutdoor === 'indoor').length;
      const outdoorCount = ctx.candidatePool.filter(p => p.indoorOutdoor === 'outdoor').length;
      console.log(`[REPLAN] STEP 4 OK: loaded ${ctx.remainingSlots.length} slots, ${ctx.candidatePool.length} candidates (city='${tripRow.destination_city}', indoor=${indoorCount}, outdoor=${outdoorCount})`);
      console.log(`[REPLAN] STEP 4   : slots =`, ctx.remainingSlots.map(s => `${s.slotId} (placeId=${s.placeId}, status=${s.status})`));

      // Anchor capturedAt to the current wall-clock time so repairSuffix starts packing
      // slots from NOW, not from a stale snapshot that could be hours in the past.
      ctx = {
        ...ctx,
        initialState: {
          ...ctx.initialState,
          capturedAt: new Date().toISOString(),
        },
      };

      // ── 4.1. Override position from GPS if provided ───────────────────────
      if (currentLocation?.lat != null && currentLocation?.lng != null) {
        ctx = {
          ...ctx,
          initialState: {
            ...ctx.initialState,
            currentLat: currentLocation.lat,
            currentLng: currentLocation.lng,
          },
        };
        console.log(`[REPLAN] STEP 4.1: GPS override → (${currentLocation.lat}, ${currentLocation.lng})`);
        // Persist to DB so future planLoader.load() starts from real position.
        // Use explicit ::integer casts because budget_remaining/time_remaining_min columns
        // are integer but TypeScript may pass floats (e.g. 5000000.0).
        deps.pool.query(
          `INSERT INTO trip_state_snapshot
             (trip_id, day_index, slot_order, time_remaining_min, budget_remaining,
              fatigue, current_geom, mood_proxy, captured_at, source)
           VALUES ($1,$2,$3,$4::integer,$5::integer,$6,ST_SetSRID(ST_MakePoint($7,$8),4326),$9,NOW(),'gps')`,
          [
            tripId,
            ctx.initialState.dayIndex,
            ctx.initialState.slotOrder,
            Math.round(ctx.initialState.timeRemainingMin),
            Math.round(ctx.initialState.budgetRemaining),
            ctx.initialState.fatigue,
            currentLocation.lng,
            currentLocation.lat,
            ctx.initialState.moodProxy,
          ],
        ).catch((err: Error) => console.error('[REPLAN] STEP 4.1: snapshot write failed:', err.message));
      } else {
        console.log(`[REPLAN] STEP 4.1: no GPS → using initialState position (${ctx.initialState.currentLat}, ${ctx.initialState.currentLng})`);
      }

    if (replanScope === 'remaining_day') {
      const today = ctx.initialState.dayIndex;
        ctx.remainingSlots = ctx.remainingSlots.filter((s) => s.dayIndex === today);
      console.log(`[REPLAN] STEP 4   : after remaining_day filter → ${ctx.remainingSlots.length} slots (dayIndex=${today})`);
    }

      // ── 4.2. Detect if user has already arrived at the venue ─────────────
      // Compare GPS against the first remaining slot's place.
      // When within 200 m the user already spent travel effort → boost
      // nearby alternatives so the replan minimises additional movement.
      if (currentLocation && ctx.remainingSlots.length > 0) {
        const firstSlot = ctx.remainingSlots[0]!;
        const firstPlace = ctx.candidatePool.find((p) => p.placeId === firstSlot.placeId);
        if (firstPlace) {
          const distM = haversineM(
            currentLocation.lat, currentLocation.lng,
            firstPlace.lat, firstPlace.lng,
          );
          if (distM <= 200) {
            ctx = {
              ...ctx,
              userIsAtVenue: true,
              venueLatLng: { lat: firstPlace.lat, lng: firstPlace.lng },
              weights: { ...ctx.weights, wProximity: 2.0 },
            };
            console.log(`[REPLAN] STEP 4.2: user IS at venue — place="${firstPlace.name}", dist=${distM.toFixed(0)}m → wProximity=2.0`);
          } else {
            console.log(`[REPLAN] STEP 4.2: user NOT at venue — dist=${distM.toFixed(0)}m from "${firstPlace.name}"`);
          }
        } else {
          console.log(`[REPLAN] STEP 4.2: first slot place not in candidatePool (placeId=${firstSlot.placeId})`);
        }
      } else {
        console.log(`[REPLAN] STEP 4.2: SKIP — no GPS or no remaining slots`);
      }

      // Capture original plan before any pre-processing (Tầng 1, prepareContext)
      // so oldPlanSnapshot reflects what the user had before replanning.
      const originalPlanSnapshot = [...ctx.remainingSlots];

      // ── 4.4. Scope: lock future slots outside the event's spatial+temporal scope ──
      // Slots not in affected_slot_ids are frozen — BeamSearch won't touch them.
      // They are reattached after search (STEP 6.2).
      let lockedSlots: TripSlot[] = [];
      if (triggerEventRow?.affected_slot_ids?.length) {
        const scopedIds = new Set(triggerEventRow.affected_slot_ids);
        lockedSlots = ctx.remainingSlots.filter(s => !scopedIds.has(s.slotId));
        ctx = { ...ctx, remainingSlots: ctx.remainingSlots.filter(s => scopedIds.has(s.slotId)) };
        console.log(`[REPLAN] STEP 4.4: ${ctx.remainingSlots.length} affected slots in scope, ${lockedSlots.length} locked`);
      }

      // ── 4.5. Inject weather forecast from trigger event ──────────────────
      if (triggerEventRow) {
        const rainMmPerH = RAIN_MM_BY_EVENT[triggerEventRow.event_type] ?? 0;
        console.log(`[REPLAN] STEP 4.5: event_type='${triggerEventRow.event_type}', rainMmPerH=${rainMmPerH}`);
        if (rainMmPerH > 0 && ctx.remainingSlots.length > 0) {
          const affectedIds = new Set(triggerEventRow.affected_slot_ids ?? []);
          const affectedDays = new Set(
            ctx.remainingSlots
              .filter((s) => affectedIds.has(s.slotId))
              .map((s) => s.dayIndex),
          );
          if (affectedDays.size === 0) {
            console.log(`[REPLAN] STEP 4.5: affectedDays empty → skip weather injection`);
          } else {
            const allDays = new Set(ctx.remainingSlots.map((s) => s.dayIndex));
            const maxDay = Math.max(...allDays);
            ctx.weatherForecast = Array.from({ length: maxDay + 1 }, (_, i) => ({
              rainMmPerH: affectedDays.has(i) ? rainMmPerH : 0,
            }));
            // Boost wWeather so the ±1 per outdoor/indoor slot outweighs pace/interest noise.
            if (ctx.weights.wWeather < 2) {
              ctx.weights = { ...ctx.weights, wWeather: 2 };
            }
            // Hard constraint: pre-replace only affected outdoor slots with indoor alternatives.
            // BeamSearch then optimizes order/timing from an already-indoor plan.
            if (rainMmPerH >= 5) {
              // Sort indoor candidates by interest fit (dot product) so best-match replaces first
              const prefVec = ctx.user.preferenceVector;
              const indoorRanked = ctx.candidatePool
                .filter(p => p.indoorOutdoor === 'indoor')
                .map(p => ({ place: p, interest: dot(prefVec, tagVectorOf(p)) }))
                .sort((a, b) => b.interest - a.interest)
                .map(x => x.place);

              const occupiedIds = new Set(ctx.remainingSlots.map(s => s.placeId));

              ctx.remainingSlots = ctx.remainingSlots.map(slot => {
                if (!affectedIds.has(slot.slotId)) return slot; // outside scope → keep
                const place = ctx.candidatePool.find(p => p.placeId === slot.placeId);
                if (place?.indoorOutdoor !== 'outdoor') return slot;

                const replacement = indoorRanked.find(p => !occupiedIds.has(p.placeId));
                if (!replacement) {
                  console.log(`[REPLAN] STEP 4.5: no indoor replacement found for placeId=${slot.placeId}, keeping outdoor`);
                  return slot;
                }

                occupiedIds.delete(slot.placeId);
                occupiedIds.add(replacement.placeId);
                const interest = dot(prefVec, tagVectorOf(replacement));
                console.log(`[REPLAN] STEP 4.5: pre-replace placeId=${slot.placeId} (outdoor) → placeId=${replacement.placeId} (${replacement.name}, indoor, interest=${interest.toFixed(3)})`);
                return { ...slot, placeId: replacement.placeId, estimatedCost: replacement.estimatedCost ?? slot.estimatedCost };
              });

              // Remove remaining outdoor places from pool so BeamSearch can't reinsert them
              const newOccupied = new Set(ctx.remainingSlots.map(s => s.placeId));
              ctx.candidatePool = ctx.candidatePool.filter(
                p => p.indoorOutdoor !== 'outdoor' || newOccupied.has(p.placeId),
              );
            }
            console.log(`[REPLAN] STEP 4.5: affectedIds=${JSON.stringify([...affectedIds])}, affectedDays=${affectedDays.size}`);
            console.log(`[REPLAN] STEP 4.5: weatherForecast injected =`, JSON.stringify(ctx.weatherForecast));
            console.log(`[REPLAN] STEP 4.5: wWeather boosted to ${ctx.weights.wWeather}`);
          }
        } else {
          console.log(`[REPLAN] STEP 4.5: SKIP — rainMmPerH=0 or no slots`);
        }
      } else {
        console.log(`[REPLAN] STEP 4.5 SKIP: no triggerEventRow → weatherForecast stays []`);
      }

      // ── 4.6. Traffic handling ─────────────────────────────────────────────
      // Khi kẹt xe: boost wDistance để BeamSearch ưu tiên tuyến ngắn hơn.
      // Kẹt xe nặng (>30min): lọc thêm candidatePool chỉ giữ điểm ≤4km.
      if (triggerEventRow) {
        const trafficDelayMin = TRAFFIC_DELAY_BY_EVENT[triggerEventRow.event_type] ?? 0;
        if (trafficDelayMin > 0) {
          const isHeavy = trafficDelayMin >= 30;
          const distBoost = isHeavy ? 3 : 1.5;
          ctx = { ...ctx, weights: { ...ctx.weights, wDistance: ctx.weights.wDistance * distBoost } };
          // Pool scoping for traffic is handled at detection time (monitorService affected_slot_ids).
          // STEP 4.4 already locks far-future slots outside the 4km/4h scope, so no global
          // candidatePool filter is needed here — wDistance boost is sufficient.
          console.log(`[REPLAN] STEP 4.6: ${isHeavy ? 'heavy' : 'moderate'} traffic (${trafficDelayMin}min) → wDistance ×${distBoost}`);
        } else {
          console.log(`[REPLAN] STEP 4.6 SKIP: not a traffic event`);
        }
      } else {
        console.log(`[REPLAN] STEP 4.6 SKIP: no triggerEventRow`);
      }

      // ── 4.7. Fatigue-driven rebalancing ───────────────────────────────────
      // Khi người dùng mệt (fatigue >0.7): tăng penalty mệt mỏi để BeamSearch
      // tránh chọn kế hoạch dày đặc; đồng thời boost các điểm nghỉ/ăn gần nhất
      // vào requiredPlaceIds để INSERT_ALT ưu tiên chèn chúng vào lịch.
      {
        const currentFatigue = ctx.initialState.fatigue;
        if (currentFatigue > 0.7) {
          const riskBoost = currentFatigue > 0.85 ? 4 : 2;
          ctx = {
            ...ctx,
            weights: {
              ...ctx.weights,
              wRisk: ctx.weights.wRisk * riskBoost,
              wDistance: ctx.weights.wDistance * 1.5,
            },
          };
          const lat0 = ctx.initialState.currentLat;
          const lng0 = ctx.initialState.currentLng;
          const occupied = new Set(ctx.remainingSlots.map(s => s.placeId));
          const restCandidateIds = ctx.candidatePool
            .filter(p =>
              !occupied.has(p.placeId) &&
              p.indoorOutdoor === 'indoor' &&
              p.avgVisitDurationMin <= 60 &&
              (lat0 == null || lng0 == null || haversineM(lat0, lng0, p.lat, p.lng) / 1000 <= 3),
            )
            .slice(0, 3)
            .map(p => p.placeId);
          if (restCandidateIds.length > 0) {
            ctx = { ...ctx, requiredPlaceIds: [...(ctx.requiredPlaceIds ?? []), ...restCandidateIds] };
          }
          console.log(`[REPLAN] STEP 4.7: fatigue=${currentFatigue.toFixed(2)} >0.7 → wRisk ×${riskBoost}, wDistance ×1.5, ${restCandidateIds.length} rest candidates boosted`);
        } else {
          console.log(`[REPLAN] STEP 4.7 SKIP: fatigue=${ctx.initialState.fatigue.toFixed(2)} ≤0.7`);
        }
      }

      // ── 5. Preprocess overflow (global redistribution) ──────────────────
      if (replanScope === 'remaining_trip') {
        ctx = deps.beamSearch.operators.prepareContext(ctx);
      }

      // ── 5.2. TSP pre-ordering ─────────────────────────────────────────────
      // Reorder slots within each day to minimize total travel distance before
      // beam search runs. This gives BeamSearch a better starting point so it
      // can spend its budget on higher-level mutations (swap/replace/insert).
      {
        const tspInitial = deps.beamSearch.operators.tspReorder(ctx.remainingSlots, ctx);
        if (tspInitial.length > 0) {
          ctx = { ...ctx, remainingSlots: tspInitial[0]!.newPlan };
          console.log(`[REPLAN] STEP 5.2: TSP reorder applied`);
        } else {
          console.log(`[REPLAN] STEP 5.2: TSP already optimal`);
        }
      }

      // ── 5.5. Score the baseline plan (after preprocessing) ───────────────
      const oldPlan = ctx.remainingSlots;
      const oldStates = deps.evolver.computeTrajectory(oldPlan, ctx.initialState, ctx);
      const oldScore = deps.scorer.score(oldPlan, oldStates, ctx.weights, ctx);
      console.log(`[REPLAN] STEP 5.5: oldScore=${oldScore.toFixed(6)}, slots in plan=${oldPlan.length}`);
      console.log(`[REPLAN] STEP 5.5: weights =`, JSON.stringify(ctx.weights));
      console.log(`[REPLAN] STEP 5.5: indoorOutdoor per slot =`, oldPlan.map(s => {
        const place = ctx.candidatePool.find(p => p.placeId === s.placeId);
        return `${s.slotId.slice(0,8)} → placeId=${s.placeId} (${place?.indoorOutdoor ?? '?'}, activityType=${s.activityType})`;
      }));

      const searchStartTime = Date.now();
      const traceBuilder = deps.traceBuilder.create();
      let isTimeout = false;
      let isFallback = false;
      let newPlan: TripSlot[];
      let newScore: number;

      try {
        const bestNode = deps.beamSearch.search(ctx);
        newPlan = bestNode.plan;
        newScore = bestNode.score;

        // ── 6.1. Final geographic normalization ───────────────────────────────
        // BeamSearch mutations (REPLACE_PLACE, INSERT_ALT) can leave slots within
        // a day in a suboptimal geographic order. Apply one final TSP pass to ensure
        // the output is always route-optimal, regardless of which mutations were chosen.
        // Stability score uses bestNode.mutationHistory (unchanged), so the comparison is fair.
        {
          const finalTsp = deps.beamSearch.operators.tspReorder(newPlan, ctx);
          if (finalTsp.length > 0) {
            const tspPlan = finalTsp[0]!.newPlan;
            const tspStates = deps.evolver.computeTrajectory(tspPlan, ctx.initialState, ctx);
            const tspScore = deps.scorer.score(tspPlan, tspStates, ctx.weights, ctx, bestNode.mutationHistory);
            // Always apply: geographic route ordering is a hard quality guarantee,
            // not subject to the soft objective tradeoff (wDistance may be very low for some users).
            newPlan = tspPlan;
            newScore = tspScore;
            console.log(`[REPLAN] STEP 6.1: final TSP applied, score ${bestNode.score.toFixed(4)} → ${newScore.toFixed(4)}`);
          } else {
            console.log(`[REPLAN] STEP 6.1: plan already geographically optimal`);
          }
        }

        // Capture once — dùng chung cho cả isTimeout check lẫn log
        const duration = Date.now() - searchStartTime;
        if (duration >= (deps.beamSearch.config?.latencyBudgetMs ?? 4500)) {
          isTimeout = true;
        }

        console.log(`[REPLAN] STEP 6 OK: BeamSearch done in ${duration}ms, isTimeout=${isTimeout}`);
        console.log(`[REPLAN] STEP 6   : scoreBefore=${oldScore.toFixed(6)}, scoreAfter=${newScore.toFixed(6)}, delta=${(newScore - oldScore).toFixed(6)}`);
        console.log(`[REPLAN] STEP 6   : newPlan slots =`, newPlan.map(s => {
          const place = ctx.candidatePool.find(p => p.placeId === s.placeId);
          return `placeId=${s.placeId} (${place?.name ?? '?'}, ${place?.indoorOutdoor ?? '?'})`;
        }));
        console.log(`[REPLAN] STEP 6   : mutations =`, bestNode.mutationHistory.map(m => m.operator));

        // ── 6.15. Time-reschedule: anchor all slot times to capturedAt (NOW) ──────
        // repairSuffix is only called inside mutations. If BeamSearch found no better
        // mutations, the original 8 AM times would survive unchanged. This pass always
        // re-packs from capturedAt so the plan is never temporally stale.
        {
          const rescheduled = deps.beamSearch.operators.rescheduleSlotTimes(newPlan, ctx);
          if (rescheduled) {
            newPlan = rescheduled;
            const rescheduledStates = deps.evolver.computeTrajectory(newPlan, ctx.initialState, ctx);
            newScore = deps.scorer.score(rescheduled, rescheduledStates, ctx.weights, ctx, bestNode.mutationHistory);
            console.log(`[REPLAN] STEP 6.15: times rescheduled from capturedAt=${ctx.initialState.capturedAt}, newScore=${newScore.toFixed(6)}`);
          }
        }

      // ── 6.2. Reattach locked future slots ───────────────────────────────────
      // Slots outside the event's temporal+spatial scope were frozen in STEP 4.4.
      // Append them back after the replanned portion so the full plan is preserved.
      // After reattachment, renumber slotOrder per day to avoid duplicates: repairSuffix
      // in step 6.15 assigns sequential orders starting from 0, but lockedSlots still
      // carry their original DB orders — overlapping orders cause unique constraint
      // violations on (trip_id, day_index, slot_order, version) when the proposal is accepted.
      if (lockedSlots.length > 0) {
        const combined = [...newPlan, ...lockedSlots].sort((a, b) => {
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
          return new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime();
        });
        const dayCounters = new Map<number, number>();
        newPlan = combined.map(s => {
          const order = dayCounters.get(s.dayIndex) ?? 0;
          dayCounters.set(s.dayIndex, order + 1);
          return { ...s, slotOrder: order };
        });
        console.log(`[REPLAN] STEP 6.2: reattached ${lockedSlots.length} locked future slots`);
      }

      traceBuilder.begin(tripId, triggerEvent as TripEvent);
      bestNode.mutationHistory.forEach((m, i) => {
        traceBuilder.record({
          stepIndex: i,
          reason: m.description,
          affectedSlotId: m.affectedSlotIds[0] ?? null,
          alternativeChosen: (() => {
            const affectedId = m.affectedSlotIds[0];
            if (!affectedId) return null;
            const slot = m.newPlan.find(s => s.slotId === affectedId);
            return slot ? { placeId: slot.placeId, reason: m.description } : null;
          })(),
          downstreamImpact: null,
        });
      });
      } catch (err) {
        console.log(`[REPLAN] STEP 6 FAIL: BeamSearch crashed →`, (err as Error).message);
        request.log.error({ err, tripId }, 'BeamSearch crashed — using fallback plan');
        isFallback = true;
        isTimeout = true;
        newPlan = oldPlan;
        newScore = oldScore;
        traceBuilder.begin(tripId, triggerEvent as TripEvent);
      }

    const causalTrace = traceBuilder.finalize();

      // ── 6.5. Evaluate replan effectiveness (dev quality control) ──────────
      const proposalId = randomUUID();
      if (deps.effectivenessEvaluator && triggerEventRow && !isFallback) {
        const incident = buildIncidentContext(triggerEventRow, originalPlanSnapshot, ctx);
        if (incident) {
          const placeMap =
            ctx.placeMap ?? new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
          const report = deps.effectivenessEvaluator.evaluate({
            tripId,
            proposalId,
            oldPlan: originalPlanSnapshot,
            newPlan,
            placeMap,
            incident,
            userState: ctx.initialState,
          });
          console.log(`[EFFECTIVENESS] ${report.devNote}`);
          report.suggestions.forEach((s) => console.log(`[EFFECTIVENESS]  ${s}`));
          deps.effectivenessLogger
            ?.save(report)
            .catch((err: Error) =>
              console.warn('[EFFECTIVENESS] log save failed:', err.message),
            );
        }
      }

    // ── 6.2. Δscore decision: bỏ qua khi cải thiện không đáng kể ────────────
    // Tránh tạo proposal vô ích khi BeamSearch không tìm được gì tốt hơn
    // (plan giống hệt cũ và score không tăng đáng kể).
    const MIN_SCORE_IMPROVEMENT = 0.5;
    const replanScoreDelta = newScore - oldScore;
    const TIME_SHIFT_THRESHOLD_MS = 5 * 60 * 1000;
    const capturedAtMs = new Date(ctx.initialState.capturedAt).getTime();
    const oldFirstStartRaw = oldPlan.length > 0 ? oldPlan[0]!.plannedStart : null;
    const oldFirstStartMs = oldFirstStartRaw != null ? new Date(oldFirstStartRaw).getTime() : NaN;
    const timesWereStale = !isNaN(oldFirstStartMs) && capturedAtMs - oldFirstStartMs > TIME_SHIFT_THRESHOLD_MS;
    const placesChanged = newPlan.some((s, idx) => s.placeId !== (oldPlan[idx]?.placeId ?? -1));
    const planStructurallyChanged = newPlan.length !== oldPlan.length || placesChanged || timesWereStale;
    console.log(`[REPLAN] STEP 6.2 DEBUG:`);
    console.log(`  oldPlan[0].plannedStart (raw) = ${JSON.stringify(oldFirstStartRaw)}`);
    console.log(`  oldFirstStartMs               = ${oldFirstStartMs} (isNaN=${isNaN(oldFirstStartMs)})`);
    console.log(`  capturedAtMs                  = ${capturedAtMs}`);
    console.log(`  capturedAt - oldFirst (min)   = ${isNaN(oldFirstStartMs) ? 'NaN' : ((capturedAtMs - oldFirstStartMs) / 60000).toFixed(1)}`);
    console.log(`  timesWereStale                = ${timesWereStale}`);
    console.log(`  placesChanged                 = ${placesChanged}`);
    console.log(`  planStructurallyChanged       = ${planStructurallyChanged}`);
    console.log(`  newPlan[0].plannedStart       = ${newPlan.length > 0 ? JSON.stringify(newPlan[0]!.plannedStart) : 'N/A'}`);
    if (!isFallback && replanScoreDelta < MIN_SCORE_IMPROVEMENT && !planStructurallyChanged) {
      console.log(`[REPLAN] STEP 6.2: Δscore=${replanScoreDelta.toFixed(4)} < ${MIN_SCORE_IMPROVEMENT} và plan không đổi → no_change`);
      return reply.status(200).send({
        action: 'no_change',
        reason: 'Lịch trình hiện tại đã tối ưu, không cần điều chỉnh thêm',
        scoreBefore: oldScore,
        scoreAfter: newScore,
      });
    }
    console.log(`[REPLAN] STEP 6.2: Δscore=${replanScoreDelta.toFixed(4)}, changed=${planStructurallyChanged} → tạo proposal`);

    console.log(`[REPLAN] STEP 7: saving proposal, isFallback=${isFallback}, isTimeout=${isTimeout}`);

      // ── 7. Build and persist proposal ──────────────────────────────────────
    const now = new Date();

    const proposal: ReplanProposal = {
      proposalId,
      tripId,
      triggeredByEventId: triggeredByEventId ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      oldPlanSnapshot: originalPlanSnapshot,
      newPlanSnapshot: newPlan,
      causalTrace: causalTrace.steps,
      scoreBefore: oldScore,
      scoreAfter: newScore,
      status: 'pending',
    };

    await deps.proposalStore.save(proposal, causalTrace);

      // ── 8. Publish event ───────────────────────────────────────────────────
    deps.publish?.('trip.replan.proposed', {
      userId,
      tripId,
      proposalId,
      scoreDelta: newScore - oldScore,
    });

    console.log(`[REPLAN] ── DONE → 201 (scoreBefore=${oldScore.toFixed(4)}, scoreAfter=${newScore.toFixed(4)}) ──\n`);
    const body: ReplanResponseBody = { ...proposal, isTimeout, isFallback };
    return reply.status(201).send(body);
    } catch (err) {
      console.log(`[REPLAN] ── UNHANDLED ERROR:`, (err as Error).message, `──\n`);
      request.log.error({ err, tripId }, 'Unhandled error in replanHandler');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during replanning',
      });
    }
  };
}

/**
 * @summary Tạo handler Fastify cho endpoint POST `/api/trips/:tripId/replan/:proposalId/accept`.
 *
 * Áp dụng kế hoạch mới từ proposal một cách nguyên tử (atomic), sau đó trả về Trip đã được
 * cập nhật. Luồng xử lý:
 * 1. Xác thực `x-user-id` header.
 * 2. Gọi `validateProposal()` — kiểm tra tồn tại, ownership, trạng thái, hết hạn.
 * 3. Chạy `runAcceptTransaction()` — giao dịch DB nguyên tử (mark replaced + insert new + update score).
 * 4. Lấy `armId` của user từ `user_objective_weights`.
 * 5. Publish event `trip.replan.accepted` kèm `scoreDelta` và `armId`.
 * 6. Gọi `notifyPreferenceReward()` nếu `armId` không null (fire-and-forget).
 * 7. Tải và trả về Trip đã cập nhật qua `fetchUpdatedTrip()`.
 *
 * **Side Effects (mỗi request):**
 * - Nhiều truy vấn DB (validate, transaction, fetchArmId, fetchUpdatedTrip).
 * - Publish event nếu `deps.publish` tồn tại.
 * - HTTP POST fire-and-forget đến preference-service nếu armId không null.
 *
 * **Phản hồi:**
 * - `200 OK`: Đối tượng Trip đầy đủ sau khi cập nhật.
 * - `400`: Thiếu `x-user-id` header.
 * - `404`: Proposal không tìm thấy hoặc sai tripId.
 * - `409`: Proposal không ở trạng thái `pending` hoặc đã hết hạn.
 * - `500`: Lỗi DB trong transaction hoặc các bước sau.
 *
 * @param deps {ReplanDeps} Dependency đã inject — cần `pool`, `proposalStore`, `publish`.
 * @returns Handler function tương thích Fastify.
 *
 * @pre Proposal phải `pending` và chưa hết hạn. `x-user-id` header phải có mặt.
 * @post Trip được cập nhật với slots mới; proposal `status='accepted'`; event resolved (nếu có).
 *
 * @example
 * ```typescript
 * fastify.post('/trips/:tripId/replan/:proposalId/accept', {}, makeAcceptHandler(deps));
 *
 * // Response 200: Trip object với slots mới đã được áp dụng
 * ```
 */
export function makeAcceptHandler(deps: ReplanDeps) {
  return async function acceptHandler(
    request: FastifyRequest<{ Params: ProposalParams; Body: AcceptBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tripId, proposalId } = request.params;
    const { partialNewSlotIds } = request.body ?? {};
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
      return reply.status(400).send({
        error: 'UNAUTHORIZED',
        message: `Missing x-user-id header`,
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
    await runAcceptTransaction(deps.pool, proposal, partialNewSlotIds ?? null);

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
 * @summary Tạo handler Fastify cho endpoint POST `/api/trips/:tripId/replan/:proposalId/reject`.
 *
 * Đánh dấu đề xuất tái lập lịch là bị từ chối (`rejected`) và trả về `204 No Content`.
 * Người dùng có thể kèm theo lý do từ chối (tối đa 500 ký tự) để ghi nhận phản hồi.
 * Luồng xử lý:
 * 1. Xác thực `x-user-id` header.
 * 2. Gọi `validateProposal()` — kiểm tra tồn tại, ownership, trạng thái, hết hạn.
 * 3. Gọi `proposalStore.updateStatus(proposalId, 'rejected', userId)`.
 * 4. Lấy `armId` của user từ `user_objective_weights`.
 * 5. Publish event `trip.replan.rejected` kèm `reason`, `armId`, `tripId`, `proposalId`.
 * 6. Gọi `notifyPreferenceReward()` nếu `armId` không null (fire-and-forget).
 *
 * **Side Effects (mỗi request):**
 * - Ghi DB: `proposalStore.updateStatus()`.
 * - Đọc DB: `fetchCurrentArmId()`.
 * - Publish event nếu `deps.publish` tồn tại.
 * - HTTP POST fire-and-forget đến preference-service nếu armId không null.
 *
 * **Phản hồi:**
 * - `204 No Content`: Từ chối thành công.
 * - `400`: Thiếu `x-user-id` header.
 * - `404`: Proposal không tìm thấy hoặc sai tripId.
 * - `409`: Proposal không ở trạng thái `pending` hoặc đã hết hạn.
 * - `500`: Lỗi DB.
 *
 * @param deps {ReplanDeps} Dependency đã inject — cần `pool`, `proposalStore`, `publish`.
 * @returns Handler function tương thích Fastify.
 *
 * @pre Proposal phải `pending` và chưa hết hạn. `x-user-id` header phải có mặt.
 * @post `proposal.status = 'rejected'`; event `trip.replan.rejected` được publish.
 *   Trip và slot **không** bị thay đổi.
 *
 * @example
 * ```typescript
 * fastify.post('/trips/:tripId/replan/:proposalId/reject', {}, makeRejectHandler(deps));
 *
 * // Request body (tùy chọn): { reason: 'Không phù hợp với lịch trình gia đình' }
 * // Response 204: No Content
 * ```
 */
export function makeRejectHandler(deps: ReplanDeps) {
  return async function rejectHandler(
    request: FastifyRequest<{ Params: ProposalParams; Body: RejectBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tripId, proposalId } = request.params;
    const { reason } = request.body ?? {};
    const userId = request.headers['x-user-id'] as string;

    if (!userId) {
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
