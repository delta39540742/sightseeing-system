import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  
  const proposals = await pool.query(`
    SELECT proposal_id, status, created_at, old_plan_snapshot, new_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1
    ORDER BY created_at DESC
    LIMIT 2
  `, [tripId]);

  for (const p of proposals.rows) {
    console.log(`\nProposal: ${p.proposal_id} (${p.status}) Created at: ${p.created_at}`);
    console.log('Old Plan Snapshot (First 2 slots):');
    console.log(JSON.stringify(p.old_plan_snapshot.slice(0, 2), null, 2));
    console.log('New Plan Snapshot (First 2 slots):');
    console.log(JSON.stringify(p.new_plan_snapshot.slice(0, 2), null, 2));
  }

  await pool.end();
}

main().catch(console.error);
