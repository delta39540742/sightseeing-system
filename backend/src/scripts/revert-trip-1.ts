import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  const targetProposalId = '0b086f5f-6085-4998-9c07-f551b15a33b4'; // Before 1 replan

  console.log(`Reverting Trip ${tripId} to state before proposal ${targetProposalId}`);

  const propRes = await pool.query(`
    SELECT old_plan_snapshot
    FROM replan_proposal
    WHERE proposal_id = $1
  `, [targetProposalId]);

  if (propRes.rows.length === 0) {
    console.log("Proposal not found.");
    return;
  }

  const oldSnapshot = propRes.rows[0].old_plan_snapshot as any[];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log("Deleting non-completed slots...");
    await client.query(`
      DELETE FROM trip_slot
      WHERE trip_id = $1 AND status != 'completed'
    `, [tripId]);

    console.log(`Restoring ${oldSnapshot.length} slots from snapshot...`);
    for (const slot of oldSnapshot) {
        await client.query(`
            INSERT INTO trip_slot (slot_id, trip_id, day_index, slot_order, version, place_id, planned_start, planned_end, activity_type, status, estimated_cost, rationale)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (slot_id) DO UPDATE SET
                status = EXCLUDED.status,
                day_index = EXCLUDED.day_index,
                slot_order = EXCLUDED.slot_order,
                version = EXCLUDED.version,
                planned_start = EXCLUDED.planned_start,
                planned_end = EXCLUDED.planned_end
        `, [
            slot.slotId, 
            slot.tripId, 
            slot.dayIndex, 
            slot.slotOrder, 
            slot.version, 
            slot.placeId, 
            slot.plannedStart, 
            slot.plannedEnd, 
            slot.activityType, 
            slot.status, 
            slot.estimatedCost, 
            slot.rationale
        ]);
    }

    await client.query('COMMIT');
    console.log("Reversion successful.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Reversion failed:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
