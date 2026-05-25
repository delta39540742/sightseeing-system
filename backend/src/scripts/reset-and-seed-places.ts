import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const PROGRESS_FILE = path.resolve(__dirname, '../../../.seed-progress');
const DATA_DIR = path.resolve(__dirname, '../../../data');

const TAG_MAP: Record<string, number> = {
  beach: 1, mountain: 2, culture: 3,
  food: 4, local_food: 4, coffee: 4,
  spiritual: 5, shopping: 6,
  entertainment: 7, checkin: 7,
  nature: 8, outdoor: 8, walk: 8, relax: 8,
  sport: 9,
  tourism: 10, travel: 10, sightseeing: 10, landmark: 10,
};

const PRICE_TYPE_MAP: Record<string, string> = {
  restaurant: 'avg_meal', cafe: 'avg_meal',
  attraction: 'entry_fee', tourist_attraction: 'entry_fee',
  beach: 'free', park: 'free', hotel: 'entry_fee',
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const BATCH_SIZE = 300;

interface PlaceJson {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  tags: string[];
  price_min: number;
  price_max: number;
  visit_cost: number;
  opening_hours: { open: string; close: string };
  duration_minutes: number;
  is_indoor: boolean;
  popularity: number;
  rating: number;
  address: string;
  province?: string;
  province_slug?: string;
}

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString, ssl });

function maskedUrl() {
  return rawUrl.replace(/:[^:@]+@/, ':***@');
}

async function getCounts(client: pg.PoolClient) {
  const tables = ['place', 'place_opening_hour', 'place_tag_map', 'trip', 'trip_slot', 'trip_event', 'replan_proposal', 'trip_state_snapshot', 'interaction_log', 'landmark_recognition', 'app_user'];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = r.rows[0].n;
  }
  return out;
}

function printCounts(label: string, c: Record<string, number>) {
  console.log(`\n[${label}]`);
  for (const [k, v] of Object.entries(c)) console.log(`  ${k.padEnd(22)} ${v}`);
}

async function wipe(client: pg.PoolClient) {
  console.log('\n[WIPE] TRUNCATE place CASCADE (xoá luôn trip, trip_slot, interaction_log, ...)...');
  await client.query(`TRUNCATE place RESTART IDENTITY CASCADE`);
  console.log('[WIPE]   done.');
}

async function ensureUniqueConstraint(client: pg.PoolClient) {
  console.log('\n[CONSTRAINT] Đảm bảo UNIQUE INDEX place(name, ST_X, ST_Y)...');
  // Expression-based unique index: name + rounded lng/lat (avoids float precision noise)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS place_name_coords_uidx
      ON place (
        name,
        round((ST_X(geom::geometry))::numeric, 6),
        round((ST_Y(geom::geometry))::numeric, 6)
      )
  `);
  console.log('[CONSTRAINT]   place_name_coords_uidx ready.');
}

async function ensureTags(client: pg.PoolClient) {
  await client.query(`
    INSERT INTO place_tag (tag_id, name, display_name) VALUES
      (1,'beach','Biển'),(2,'mountain','Núi'),(3,'culture','Văn hóa'),
      (4,'food','Ẩm thực'),(5,'spiritual','Tâm linh'),(6,'shopping','Mua sắm'),
      (7,'entertainment','Giải trí'),(8,'nature','Thiên nhiên'),
      (9,'sport','Thể thao'),(10,'landmark','Điểm tham quan')
    ON CONFLICT (tag_id) DO NOTHING
  `);
}

async function seedBatch(client: pg.PoolClient, places: PlaceJson[], province: string) {
  const names: string[] = [];
  const lngs: number[] = [];
  const lats: number[] = [];
  const minPrices: number[] = [];
  const maxPrices: number[] = [];
  const priceTypes: string[] = [];
  const durations: number[] = [];
  const indoors: string[] = [];
  const popularities: number[] = [];
  const addresses: string[] = [];
  const provinces: string[] = [];

  for (const p of places) {
    names.push(p.name);
    lngs.push(p.lng);
    lats.push(p.lat);
    minPrices.push(p.price_min ?? 0);
    maxPrices.push(p.price_max ?? 0);
    priceTypes.push(
      p.price_min === 0 && p.price_max === 0
        ? 'free'
        : PRICE_TYPE_MAP[p.category] ?? 'entry_fee',
    );
    durations.push(p.duration_minutes ?? 60);
    indoors.push(p.is_indoor ? 'indoor' : 'outdoor');
    popularities.push(Math.min((p.popularity ?? 50) / 100, 1.0));
    addresses.push(p.address ?? province);
    provinces.push(p.province ?? province);
  }

  const placeRes = await client.query<{ place_id: number; name: string }>(
    `INSERT INTO place (name, description, geom, min_price, max_price, price_type,
        avg_visit_duration_min, indoor_outdoor, popularity_score, address, province)
     SELECT
       n, NULL,
       ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
       min_p, max_p, pt, dur, io, pop, addr, prov
     FROM UNNEST(
       $1::text[], $2::float8[], $3::float8[],
       $4::int[], $5::int[], $6::text[],
       $7::int[], $8::text[], $9::float8[], $10::text[], $11::text[]
     ) AS t(n, lng, lat, min_p, max_p, pt, dur, io, pop, addr, prov)
     ON CONFLICT DO NOTHING
     RETURNING place_id, name`,
    [names, lngs, lats, minPrices, maxPrices, priceTypes, durations, indoors, popularities, addresses, provinces],
  );

  const inserted = placeRes.rows.length;
  const skipped = places.length - inserted;
  const nameToId = new Map<string, number>();
  for (const row of placeRes.rows) nameToId.set(row.name, row.place_id);

  // Opening hours
  const ohPid: number[] = [], ohDay: number[] = [], ohOpen: string[] = [], ohClose: string[] = [];
  for (const p of places) {
    const pid = nameToId.get(p.name);
    if (pid == null) continue;
    if (!p.opening_hours?.open || !p.opening_hours?.close) continue;
    for (const d of ALL_DAYS) {
      ohPid.push(pid); ohDay.push(d); ohOpen.push(p.opening_hours.open); ohClose.push(p.opening_hours.close);
    }
  }
  if (ohPid.length > 0) {
    await client.query(
      `INSERT INTO place_opening_hour (place_id, day_of_week, open_time, close_time)
       SELECT UNNEST($1::bigint[]), UNNEST($2::int[]), UNNEST($3::time[]), UNNEST($4::time[])
       ON CONFLICT DO NOTHING`,
      [ohPid, ohDay, ohOpen, ohClose],
    );
  }

  // Tags
  const tPid: number[] = [], tTid: number[] = [];
  for (const p of places) {
    const pid = nameToId.get(p.name);
    if (pid == null) continue;
    const ids = [...new Set((p.tags ?? []).map(t => TAG_MAP[t]).filter((x): x is number => x !== undefined))];
    for (const tid of ids) { tPid.push(pid); tTid.push(tid); }
  }
  if (tPid.length > 0) {
    await client.query(
      `INSERT INTO place_tag_map (place_id, tag_id)
       SELECT UNNEST($1::bigint[]), UNNEST($2::int[])
       ON CONFLICT DO NOTHING`,
      [tPid, tTid],
    );
  }

  return { inserted, skipped };
}

async function seedFile(filePath: string, fileLabel: string): Promise<{ inserted: number; skipped: number }> {
  const places: PlaceJson[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const province = places[0]?.province ?? fileLabel.replace(/^places_/, '').replace(/\.json$/, '');
  let inserted = 0, skipped = 0;
  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await seedBatch(client, batch, province);
      await client.query('COMMIT');
      inserted += r.inserted; skipped += r.skipped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return { inserted, skipped };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has('--yes');
  const skipWipe = args.has('--no-wipe');

  console.log('='.repeat(80));
  console.log('RESET AND SEED PLACES');
  console.log('='.repeat(80));
  console.log(`DB target: ${maskedUrl()}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log(`Wipe: ${skipWipe ? 'SKIP' : 'YES'}`);

  if (!fs.existsSync(DATA_DIR)) { console.error(`Data dir not found: ${DATA_DIR}`); process.exit(1); }
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
  let recordCount = 0;
  for (const f of files) recordCount += JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')).length;
  console.log(`Files: ${files.length}, records: ${recordCount}`);

  const client = await pool.connect();
  try {
    const before = await getCounts(client);
    printCounts('BEFORE', before);

    if (dryRun) {
      console.log('\n[DRY RUN] Sẽ TRUNCATE place CASCADE (xoá toàn bộ place + trip + slot + ...) sau đó seed 23299 records.');
      console.log('[DRY RUN] Truyền --yes để thực thi.');
      return;
    }

    if (!skipWipe) {
      await client.query('BEGIN');
      await wipe(client);
      await client.query('COMMIT');
    } else {
      console.log('\n[SKIP] Bỏ qua bước wipe theo flag --no-wipe.');
    }

    await client.query('BEGIN');
    await ensureUniqueConstraint(client);
    await ensureTags(client);
    await client.query('COMMIT');

    // Reset progress file so seed picks up all files
    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
      console.log('\n[PROGRESS] Đã xoá .seed-progress (data files vẫn nguyên).');
    }
  } finally {
    client.release();
  }

  console.log('\n[SEED] Bắt đầu seed 34 file...');
  let totalIns = 0, totalSkip = 0;
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const label = file.replace(/\.json$/, '');
    try {
      const { inserted, skipped } = await seedFile(filePath, file);
      console.log(`  ${label.padEnd(28)} inserted=${String(inserted).padStart(5)} skipped=${String(skipped).padStart(5)}`);
      totalIns += inserted; totalSkip += skipped;
    } catch (err: any) {
      console.error(`  [ERROR] ${label}: ${err.message}`);
    }
  }
  console.log(`\n[SEED] Total inserted=${totalIns}, skipped=${totalSkip}`);

  const after = await pool.connect();
  try {
    const counts = await getCounts(after);
    printCounts('AFTER', counts);
  } finally { after.release(); }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
