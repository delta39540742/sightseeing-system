/**
 * history.ts — Dev-only endpoint that lists real replan proposals from DB
 * so developers can browse and compare old vs new plans for QA purposes.
 *
 * Route: GET /api/demo/history?limit=20&offset=0
 * Auth:  None — restricted to NODE_ENV !== 'production'
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

export interface DemoDeps {
  pool: Pool;
}

interface HistoryQuery {
  limit?: string;
  offset?: string;
}

export const demoHistoryPlugin: FastifyPluginAsync<DemoDeps> = async (fastify, { pool }) => {
  if (process.env.NODE_ENV === 'production') {
    fastify.log.warn('[demo] History plugin skipped in production');
    return;
  }

  fastify.get<{ Querystring: HistoryQuery }>('/history', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 50);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10), 0);

    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ count: string }>('SELECT COUNT(*) FROM replan_proposal'),
      pool.query(
        `SELECT
           p.proposal_id, p.trip_id, p.created_at,
           p.old_plan_snapshot, p.new_plan_snapshot, p.causal_trace,
           p.score_before, p.score_after, p.status,
           e.overall_pass, e.pass_rate,
           e.criteria_json, e.suggestions_json,
           e.dev_note, e.incident_type, e.incident_severity
         FROM replan_proposal p
         LEFT JOIN replan_effectiveness_log e ON e.proposal_id = p.proposal_id
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);

    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    // Collect all placeIds across old+new plans to build a unified placesMap
    const placeIds = new Set<number>();
    for (const row of rowsRes.rows) {
      const slots = [
        ...(Array.isArray(row.old_plan_snapshot) ? row.old_plan_snapshot : []),
        ...(Array.isArray(row.new_plan_snapshot) ? row.new_plan_snapshot : []),
      ];
      for (const s of slots) {
        // Handle both camelCase (from app) and snake_case (raw JSONB)
        const id = typeof s?.placeId === 'number' ? s.placeId
          : typeof s?.place_id === 'number' ? s.place_id
          : null;
        if (id !== null) placeIds.add(id);
      }
    }

    const placesMap: Record<number, { placeId: number; name: string; indoorOutdoor: string }> = {};
    if (placeIds.size > 0) {
      const pRes = await pool.query(
        `SELECT place_id, name, indoor_outdoor FROM place WHERE place_id = ANY($1::bigint[])`,
        [[...placeIds]],
      );
      for (const r of pRes.rows) {
        placesMap[r.place_id] = {
          placeId: r.place_id,
          name: r.name,
          indoorOutdoor: r.indoor_outdoor,
        };
      }
    }

    const items = rowsRes.rows.map((row) => ({
      proposalId:  row.proposal_id as string,
      tripId:      row.trip_id as string,
      createdAt:   (row.created_at as Date).toISOString(),
      scoreBefore: parseFloat(row.score_before),
      scoreAfter:  parseFloat(row.score_after),
      status:      row.status as string,
      oldPlan:     Array.isArray(row.old_plan_snapshot) ? row.old_plan_snapshot : [],
      newPlan:     Array.isArray(row.new_plan_snapshot) ? row.new_plan_snapshot : [],
      causalTrace: Array.isArray(row.causal_trace) ? row.causal_trace : [],
      effectiveness: row.overall_pass !== null && row.overall_pass !== undefined
        ? {
            overallPass:      row.overall_pass as boolean,
            passRate:         parseFloat(row.pass_rate),
            criteria:         Array.isArray(row.criteria_json) ? row.criteria_json : [],
            suggestions:      Array.isArray(row.suggestions_json) ? row.suggestions_json : [],
            devNote:          (row.dev_note as string) ?? '',
            incidentType:     row.incident_type as string,
            incidentSeverity: row.incident_severity as string,
          }
        : null,
    }));

    return reply.send({ total, items, placesMap });
  });
};