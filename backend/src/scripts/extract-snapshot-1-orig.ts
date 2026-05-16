import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  const res = await pool.query(`
    SELECT proposal_id, old_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1 AND status = 'accepted'
    ORDER BY decided_at DESC
  `, [tripId]);

  // We want the state before the original last replan.
  // Original last was 0b08. 
  // In the current list, 0b08 is at index 1.
  
  const originalLast = res.rows.find(r => r.proposal_id === '0b086f5f-6085-4998-9c07-f551b15a33b4');
  if (!originalLast) {
      console.log("Could not find proposal 0b08.");
      return;
  }

  console.log(`State before 1 original replan (old_plan_snapshot of proposal ${originalLast.proposal_id}):`);
  console.log(JSON.stringify(originalLast.old_plan_snapshot, null, 2));
}

main().catch(console.error);
