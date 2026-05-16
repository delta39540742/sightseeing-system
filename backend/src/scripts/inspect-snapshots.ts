import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  const res = await pool.query(`
    SELECT proposal_id, decided_at, old_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1 AND status = 'accepted'
    ORDER BY decided_at DESC
  `, [tripId]);

  res.rows.forEach((r, i) => {
      console.log(`[${i}] Proposal ID: ${r.proposal_id} Decided: ${r.decided_at}`);
      const snap = r.old_plan_snapshot as any[];
      console.log(`    Snapshot size: ${snap.length} slots`);
      console.log(`    Versions in snapshot: ${[...new Set(snap.map(s => s.version))]}`);
  });

  await pool.end();
}

main().catch(console.error);
