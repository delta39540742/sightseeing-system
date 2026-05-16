import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  // 1. Find the 2nd most recent accepted proposal
  const propRes = await pool.query(`
    SELECT proposal_id, old_plan_snapshot
    FROM replan_proposal
    WHERE trip_id = $1 AND status = 'accepted'
    ORDER BY decided_at DESC
    LIMIT 1 OFFSET 1
  `, [tripId]);

  if (propRes.rows.length === 0) {
    console.log("No 2nd recent accepted proposal found.");
    return;
  }

  const proposal = propRes.rows[0];
  const oldSnapshot = proposal.old_plan_snapshot as any[];

  console.log(`Reverting Trip ${tripId} to state before proposal ${proposal.proposal_id}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Delete all non-completed slots that might conflict
    console.log("Deleting non-completed slots...");
    await client.query(`
      DELETE FROM trip_slot
      WHERE trip_id = $1 AND status != 'completed'
    `, [tripId]);

    // 3. Restore slots from snapshot
    console.log(`Restoring ${oldSnapshot.length} slots from snapshot...`);
    for (const slot of oldSnapshot) {
        // We use INSERT since we deleted them. 
        // If a slot with the same ID still exists (e.g. it was 'completed' but also in snapshot?), we might need to handle it.
        // But 'completed' slots shouldn't usually be in 'old_plan_snapshot' as 'planned'.
        
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

    // 4. Mark the last two accepted proposals as 'reverted' or just delete them?
    // Let's just leave them, but maybe it's better to update their status so they don't show up in history as the "current" path.
    // However, 'replan_proposal' status is usually 'pending', 'accepted', 'rejected', 'expired'.
    // There's no 'reverted'.

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
