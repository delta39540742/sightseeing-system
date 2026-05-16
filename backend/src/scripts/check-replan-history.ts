import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  console.log(`Checking trip_slot versions for Trip: ${tripId}`);
  
  const res = await pool.query(`
    SELECT DISTINCT version
    FROM trip_slot
    WHERE trip_id = $1
    ORDER BY version DESC
  `, [tripId]);

  console.log('Available versions:', res.rows.map(r => r.version));

  const slotsRes = await pool.query(`
    SELECT slot_id, day_index, slot_order, version, status, p.name
    FROM trip_slot ts
    JOIN place p ON p.place_id = ts.place_id
    WHERE ts.trip_id = $1
    ORDER BY version DESC, day_index ASC, slot_order ASC
  `, [tripId]);

  const slots = slotsRes.rows;
  const versions = [...new Set(slots.map(s => s.version))];

  versions.forEach(v => {
      const vSlots = slots.filter(s => s.version === v);
      console.log(`Version ${v}: ${vSlots.length} slots. Statuses: ${[...new Set(vSlots.map(s => s.status))]}`);
  });

  await pool.end();
}

main().catch(console.error);
