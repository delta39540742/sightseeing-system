import 'dotenv/config';
import pg from 'pg';

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString, ssl });

async function main() {
  console.log('Connecting to:', rawUrl.replace(/:[^:@]+@/, ':***@'));
  const client = await pool.connect();
  try {
    const tables = [
      'place',
      'place_opening_hour',
      'place_tag_map',
      'place_image',
      'place_nearby_amenity',
      'place_peak_time',
      'place_crowd_snapshot',
      'trip',
      'trip_slot',
      'trip_event',
      'trip_state_snapshot',
      'replan_proposal',
      'interaction_log',
      'landmark_recognition',
      'app_user',
    ];
    for (const t of tables) {
      try {
        const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        console.log(`  ${t.padEnd(28)} ${r.rows[0].n}`);
      } catch (e: any) {
        console.log(`  ${t.padEnd(28)} ERROR: ${e.message}`);
      }
    }

    console.log('\nPlace FK references (existing):');
    const fkChecks = [
      `SELECT 'trip.hotel_place_id'::text AS ref, COUNT(*)::int AS n FROM trip WHERE hotel_place_id IS NOT NULL`,
      `SELECT 'trip_slot.place_id'::text AS ref, COUNT(*)::int AS n FROM trip_slot WHERE place_id IS NOT NULL`,
      `SELECT 'interaction_log.place_id'::text AS ref, COUNT(*)::int AS n FROM interaction_log WHERE place_id IS NOT NULL`,
      `SELECT 'landmark_recognition.predicted_place_id'::text AS ref, COUNT(*)::int AS n FROM landmark_recognition WHERE predicted_place_id IS NOT NULL`,
    ];
    for (const q of fkChecks) {
      const r = await client.query(q);
      console.log(`  ${r.rows[0].ref.padEnd(40)} ${r.rows[0].n}`);
    }

    console.log('\nPlace duplicates (same name + same coords):');
    const dup = await client.query(`
      SELECT name, ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat, COUNT(*)::int AS n
      FROM place
      GROUP BY name, geom
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    if (dup.rowCount === 0) console.log('  (none)');
    for (const row of dup.rows) {
      console.log(`  ${row.n}× "${row.name}" (${row.lat?.toFixed(4)}, ${row.lng?.toFixed(4)})`);
    }
    const dupTotal = await client.query(`
      SELECT SUM(n - 1)::int AS extras FROM (
        SELECT COUNT(*)::int AS n FROM place GROUP BY name, geom HAVING COUNT(*) > 1
      ) sub
    `);
    console.log(`  Total duplicate extras (excess rows beyond 1 per group): ${dupTotal.rows[0].extras ?? 0}`);

    console.log('\nPlaces with province IS NULL:');
    const noProv = await client.query(`SELECT COUNT(*)::int AS n FROM place WHERE province IS NULL`);
    console.log(`  ${noProv.rows[0].n}`);

    console.log('\nPlace constraints (unique/check):');
    const con = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'place'::regclass AND contype IN ('u','x','p')
    `);
    for (const r of con.rows) {
      console.log(`  [${r.contype}] ${r.conname}: ${r.def}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
