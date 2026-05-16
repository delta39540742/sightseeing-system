import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  const res = await pool.query(`
    SELECT proposal_id, old_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1 AND status = 'accepted'
    ORDER BY decided_at DESC
    LIMIT 2
  `, [tripId]);

  if (res.rows.length < 1) {
    console.log("No accepted replans found.");
    return;
  }

  // "Trước 1 lần replan" relative to the history.
  // If the user wants the state before the MOST RECENT accepted replan.
  const target = res.rows[0];
  console.log(`State before 1 replan (old_plan_snapshot of proposal ${target.proposal_id}):`);
  console.log(JSON.stringify(target.old_plan_snapshot, null, 2));
}

main().catch(console.error);
