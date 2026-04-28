import type { Pool } from 'pg';
import type { ReplanProposal } from '@app/types';
import type { CausalTrace } from './CausalTraceBuilder';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface ProposalFilter {
  tripId?: string;
  status?: ProposalStatus;
  createdAfter?: Date;
  limit?: number;
  offset?: number;
}

export class ProposalStore {
  constructor(private readonly pool: Pool) {}

  async save(proposal: ReplanProposal, trace: CausalTrace): Promise<string> {
    await this.pool.query(
      `INSERT INTO replan_proposal
         (proposal_id, trip_id, triggered_by_event_id, expires_at,
          old_plan_snapshot, new_plan_snapshot, causal_trace,
          score_before, score_after, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
      [
        proposal.proposalId,
        proposal.tripId,
        proposal.triggeredByEventId ?? null,
        new Date(proposal.expiresAt),
        JSON.stringify(proposal.oldPlanSnapshot),
        JSON.stringify(proposal.newPlanSnapshot),
        JSON.stringify(trace.steps),
        proposal.scoreBefore,
        proposal.scoreAfter,
      ],
    );
    return proposal.proposalId;
  }

  async findMany(filter: ProposalFilter): Promise<ReplanProposal[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.tripId) {
      conditions.push(`trip_id = $${idx++}`);
      params.push(filter.tripId);
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      params.push(filter.status);
    }
    if (filter.createdAfter) {
      conditions.push(`created_at > $${idx++}`);
      params.push(filter.createdAfter);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit !== undefined ? `LIMIT $${idx++}` : '';
    if (filter.limit !== undefined) params.push(filter.limit);

    const offset = filter.offset !== undefined ? `OFFSET $${idx++}` : '';
    if (filter.offset !== undefined) params.push(filter.offset);

    const res = await this.pool.query(
      `SELECT * FROM replan_proposal ${where} ORDER BY created_at DESC ${limit} ${offset}`,
      params,
    );
    return res.rows.map(rowToProposal);
  }

  async findById(proposalId: string): Promise<ReplanProposal | null> {
    const res = await this.pool.query(
      `SELECT * FROM replan_proposal WHERE proposal_id = $1`,
      [proposalId],
    );
    return res.rows[0] ? rowToProposal(res.rows[0]) : null;
  }

  async updateStatus(
    proposalId: string,
    status: ProposalStatus,
    _actorId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE replan_proposal SET status = $1, decided_at = NOW() WHERE proposal_id = $2`,
      [status, proposalId],
    );
  }

  async expireOld(tripId: string, ttlMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs);
    const res = await this.pool.query<{ count: string }>(
      `UPDATE replan_proposal
          SET status = 'expired'
        WHERE trip_id = $1 AND status = 'pending' AND created_at < $2
        RETURNING proposal_id`,
      [tripId, cutoff],
    );
    return res.rowCount ?? 0;
  }
}

function rowToProposal(row: Record<string, unknown>): ReplanProposal {
  return {
    proposalId: row['proposal_id'] as string,
    tripId: row['trip_id'] as string,
    triggeredByEventId: (row['triggered_by_event_id'] as string) ?? null,
    createdAt: (row['created_at'] as Date).toISOString(),
    expiresAt: (row['expires_at'] as Date).toISOString(),
    oldPlanSnapshot: row['old_plan_snapshot'] as ReplanProposal['oldPlanSnapshot'],
    newPlanSnapshot: row['new_plan_snapshot'] as ReplanProposal['newPlanSnapshot'],
    causalTrace: row['causal_trace'] as unknown[],
    scoreBefore: row['score_before'] as number,
    scoreAfter: row['score_after'] as number,
    status: row['status'] as ReplanProposal['status'],
  };
}
