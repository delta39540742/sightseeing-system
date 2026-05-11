import type { Pool } from 'pg';
import type { EffectivenessReport, IncidentContext } from '@app/types';

interface LogRow {
  log_id: number;
  trip_id: string;
  proposal_id: string;
  incident_type: string;
  incident_severity: string;
  overall_pass: boolean;
  pass_rate: string;
  criteria_json: unknown;
  suggestions_json: unknown;
  dev_note: string | null;
  evaluated_at: string;
}

export class EffectivenessLogger {
  constructor(private readonly pool: Pool) {}

  async save(report: EffectivenessReport): Promise<void> {
    await this.pool.query(
      `INSERT INTO replan_effectiveness_log
         (trip_id, proposal_id, incident_type, incident_severity,
          overall_pass, pass_rate, criteria_json, suggestions_json,
          dev_note, evaluated_at)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,$10)`,
      [
        report.tripId,
        report.proposalId,
        report.incident.type,
        report.incident.severity,
        report.overallPass,
        report.passRate,
        JSON.stringify(report.criteria),
        JSON.stringify(report.suggestions),
        report.devNote,
        report.evaluatedAt,
      ],
    );
  }

  async findByTripId(tripId: string): Promise<EffectivenessReport[]> {
    const r = await this.pool.query<LogRow>(
      `SELECT * FROM replan_effectiveness_log
        WHERE trip_id = $1
        ORDER BY evaluated_at DESC
        LIMIT 50`,
      [tripId],
    );
    return r.rows.map(rowToReport);
  }

  async findByProposalId(proposalId: string): Promise<EffectivenessReport | null> {
    const r = await this.pool.query<LogRow>(
      `SELECT * FROM replan_effectiveness_log WHERE proposal_id = $1 LIMIT 1`,
      [proposalId],
    );
    return r.rows[0] ? rowToReport(r.rows[0]) : null;
  }
}

function rowToReport(row: LogRow): EffectivenessReport {
  return {
    tripId:       row.trip_id,
    proposalId:   row.proposal_id,
    evaluatedAt:  row.evaluated_at,
    incident: {
      type:     row.incident_type as IncidentContext['type'],
      severity: row.incident_severity as IncidentContext['severity'],
    },
    overallPass:  row.overall_pass,
    passRate:     parseFloat(row.pass_rate),
    criteria:     Array.isArray(row.criteria_json) ? (row.criteria_json as any) : [],
    suggestions:  Array.isArray(row.suggestions_json) ? (row.suggestions_json as any) : [],
    devNote:      row.dev_note ?? '',
  };
}
