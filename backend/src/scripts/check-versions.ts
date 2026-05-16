import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  
  console.log(`Analyzing versions for Trip: ${tripId}`);
  
  const res = await pool.query(`
    SELECT slot_id, day_index, slot_order, version, status, place_id, planned_start
    FROM trip_slot
    WHERE trip_id = $1
    ORDER BY day_index ASC, slot_order ASC, version DESC
  `, [tripId]);

  console.log('Slots found:');
  console.table(res.rows);

  const proposals = await pool.query(`
    SELECT proposal_id, status, created_at, score_before, score_after
    FROM replan_proposal
    WHERE trip_id = $1
    ORDER BY created_at DESC
  `, [tripId]);

  console.log('Proposals found:');
  console.table(proposals.rows);

  await pool.end();
}

main().catch(console.error);
