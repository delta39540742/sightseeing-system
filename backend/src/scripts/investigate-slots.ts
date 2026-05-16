import 'dotenv/config';
import { pool } from '../lib/prisma';

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';

  console.log(`Investigation for Trip ${tripId}`);
  
  const res = await pool.query(`
    SELECT slot_id, day_index, slot_order, version, status
    FROM trip_slot
    WHERE trip_id = $1
    ORDER BY day_index, slot_order, version
  `, [tripId]);

  console.table(res.rows);

  await pool.end();
}

main().catch(console.error);
