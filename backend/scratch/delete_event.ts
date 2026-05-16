
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { pool } from '../src/lib/prisma';

async function deleteTiredEvent() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  
  try {
    // Delete proposals referencing these events first
    await pool.query(`
      DELETE FROM replan_proposal 
      WHERE triggered_by_event_id IN (
        SELECT event_id FROM trip_event 
        WHERE trip_id = $1 AND event_type = 'user_tired'
      );
    `, [tripId]);

    const res = await pool.query(`
      DELETE FROM trip_event 
      WHERE trip_id = $1 AND event_type = 'user_tired';
    `, [tripId]);

    console.log(`Deleted ${res.rowCount} 'user_tired' events for trip ${tripId}.`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

deleteTiredEvent();
