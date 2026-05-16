import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  const res = await pool.query(`
    SELECT proposal_id, status, old_plan_snapshot, new_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1 AND status = 'accepted'
    ORDER BY decided_at DESC
    LIMIT 2
  `, [tripId]);

  if (res.rows.length < 2) {
    console.log("Not enough accepted replans to go back 2 times.");
    return;
  }

  const secondRecent = res.rows[1];
  console.log(`State before 2 replans (old_plan_snapshot of proposal ${secondRecent.proposal_id}):`);
  console.log(JSON.stringify(secondRecent.old_plan_snapshot, null, 2));

  // The user probably wants to REVERT the trip to this state.
  // To revert, we need to:
  // 1. Set status of current 'planned' slots to 'replaced' or 'deleted'.
  // 2. Restore slots from the snapshot.
}

main().catch(console.error);
