
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { pool } from '../src/lib/prisma';

async function debugTrip() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  
  try {
    const slotsRes = await pool.query(`
      SELECT ts.slot_id, ts.day_index, ts.slot_order, p.name, ts.status, ts.planned_start, ts.planned_end
      FROM trip_slot ts
      JOIN place p ON p.place_id = ts.place_id
      WHERE ts.trip_id = $1
      ORDER BY ts.day_index, ts.slot_order;
    `, [tripId]);

    console.log('--- TRIP SLOTS START ---');
    slotsRes.rows.forEach(r => {
      console.log(`${r.day_index}-${r.slot_order}: ${r.name} [${r.status}] ${r.planned_start.toISOString()} -> ${r.planned_end.toISOString()}`);
    });
    console.log('--- TRIP SLOTS END ---');

    const eventsRes = await pool.query(`
      SELECT event_id, event_type, status, detected_at, payload
      FROM trip_event
      WHERE trip_id = $1
      ORDER BY detected_at DESC LIMIT 5;
    `, [tripId]);

    console.log('--- RECENT EVENTS ---');
    eventsRes.rows.forEach(e => {
        console.log(`${e.detected_at.toISOString()} | ${e.event_type} | ${e.status}`);
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

debugTrip();
