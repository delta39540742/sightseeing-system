import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  console.log(`Processing restoration for Trip: ${tripId}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Delete pending proposals (they are the "most recent call" in progress)
    console.log("Removing pending proposals...");
    await client.query(`
      DELETE FROM replan_proposal
      WHERE trip_id = $1 AND status = 'pending'
    `, [tripId]);

    // 2. Find the most recent accepted proposal
    const propRes = await client.query(`
      SELECT proposal_id, old_plan_snapshot, created_at
      FROM replan_proposal
      WHERE trip_id = $1 AND status = 'accepted'
      ORDER BY decided_at DESC
      LIMIT 1
    `, [tripId]);

    if (propRes.rows.length === 0) {
      console.log("No accepted proposal found to revert.");
      await client.query('ROLLBACK');
      return;
    }

    const proposal = propRes.rows[0];
    const oldSnapshot = proposal.old_plan_snapshot as any[];

    console.log(`Reverting to state before proposal ${proposal.proposal_id} (created at ${proposal.created_at})`);

    // 3. Delete current slots that were affected (we'll restore from snapshot)
    // Actually, it's safer to delete all non-completed slots for this trip and restore.
    console.log("Cleaning up current non-completed slots...");
    await client.query(`
      DELETE FROM trip_slot
      WHERE trip_id = $1 AND status != 'completed'
    `, [tripId]);

    // 4. Restore slots from snapshot
    console.log(`Restoring ${oldSnapshot.length} slots...`);
    for (const slot of oldSnapshot) {
      await client.query(`
        INSERT INTO trip_slot (
          slot_id, trip_id, day_index, slot_order, version, 
          place_id, planned_start, planned_end, 
          activity_type, status, estimated_cost, rationale
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (slot_id) DO UPDATE SET
          day_index = EXCLUDED.day_index,
          slot_order = EXCLUDED.slot_order,
          version = EXCLUDED.version,
          planned_start = EXCLUDED.planned_start,
          planned_end = EXCLUDED.planned_end,
          status = EXCLUDED.status
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

    // 5. Update the proposal status to 'reverted' (optional, but good for record)
    // Since the schema doesn't have 'reverted', we'll just mark it as 'expired' or something, 
    // or better, just leave it as 'accepted' but we know we've undone it.
    // Actually, let's just delete the 'accepted' record too if we want to "really" go back.
    // Or just rename it?
    // Let's just keep it for history but we've restored the state.

    await client.query('COMMIT');
    console.log("Restoration successful.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Restoration failed:", e);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
