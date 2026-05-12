-- Dev-facing quality-control log for replan effectiveness evaluation.
-- Populated automatically by ReplanEffectivenessEvaluator after each replan proposal is created.

CREATE TABLE IF NOT EXISTS replan_effectiveness_log (
  log_id            BIGSERIAL        PRIMARY KEY,
  trip_id           UUID             NOT NULL,
  proposal_id       UUID             NOT NULL,
  incident_type     TEXT             NOT NULL,  -- 'rain' | 'traffic_delay'
  incident_severity TEXT             NOT NULL,  -- 'low' | 'medium' | 'high'
  overall_pass      BOOLEAN          NOT NULL,
  pass_rate         NUMERIC(5, 4)    NOT NULL,  -- 0.0000 – 1.0000
  criteria_json     JSONB            NOT NULL DEFAULT '[]',
  suggestions_json  JSONB            NOT NULL DEFAULT '[]',
  dev_note          TEXT,
  evaluated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eff_log_trip       ON replan_effectiveness_log (trip_id);
CREATE INDEX IF NOT EXISTS idx_eff_log_proposal   ON replan_effectiveness_log (proposal_id);
CREATE INDEX IF NOT EXISTS idx_eff_log_evaluated  ON replan_effectiveness_log (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_eff_log_fail       ON replan_effectiveness_log (overall_pass)
  WHERE overall_pass = FALSE;
