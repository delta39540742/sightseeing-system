import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString, ssl });

const TAG_MAP: Record<string, number> = {
  beach:          1,
  mountain:       2,
  culture:        3,
  food:           4,
  local_food:     4,
  coffee:         4,
  spiritual:      5,
  shopping:       6,
  entertainment:  7,
  checkin:        7,
  nature:         8,
  outdoor:        8,
  walk:           8,
  relax:          8,
  sport:          9,
  tourism:        10,
  travel:         10,
  sightseeing:    10,
  landmark:       10,
};

const PRICE_TYPE_MAP: Record<string, string> = {
  restaurant:         'avg_meal',
  cafe:               'avg_meal',
  attraction:         'entry_fee',
  tourist_attraction: 'entry_fee',
  beach:              'free',
  park:               'free',
  hotel:              'entry_fee',
};

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
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const BATCH_SIZE = 300;

async function seedBatch(
  client: pg.PoolClient,
  places: PlaceJson[],
  label: string,
): Promise<{ inserted: number; skipped: number }> {
  // Bulk INSERT places in one query using UNNEST
  const names: string[]        = [];
  const lngs: number[]         = [];
  const lats: number[]         = [];
  const minPrices: number[]    = [];
  const maxPrices: number[]    = [];
  const priceTypes: string[]   = [];
  const durations: number[]    = [];
  const indoors: string[]      = [];
  const popularities: number[] = [];
  const addresses: string[]    = [];

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
    addresses.push(p.address ?? label);
  }

  const placeRes = await client.query<{ place_id: number; name: string }>(
    `INSERT INTO place (name, description, geom, min_price, max_price, price_type,
        avg_visit_duration_min, indoor_outdoor, popularity_score, address)
     SELECT
       n, NULL,
       ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
       min_p, max_p, pt, dur, io, pop, addr
     FROM UNNEST(
       $1::text[], $2::float8[], $3::float8[],
       $4::int[], $5::int[], $6::text[],
       $7::int[], $8::text[], $9::float8[], $10::text[]
     ) AS t(n, lng, lat, min_p, max_p, pt, dur, io, pop, addr)
     ON CONFLICT DO NOTHING
     RETURNING place_id, name`,
    [names, lngs, lats, minPrices, maxPrices, priceTypes, durations, indoors, popularities, addresses],
  );

  const inserted = placeRes.rows.length;
  const skipped = places.length - inserted;

  // Build name→placeId map for inserted rows
  const nameToId = new Map<string, number>();
  for (const row of placeRes.rows) nameToId.set(row.name, row.place_id);

  // Bulk INSERT opening hours
  const ohPlaceIds: number[] = [];
  const ohDays: number[]     = [];
  const ohOpens: string[]    = [];
  const ohCloses: string[]   = [];

  for (const p of places) {
    const pid = nameToId.get(p.name);
    if (pid == null) continue;
    if (!p.opening_hours?.open || !p.opening_hours?.close) continue;
    for (const day of ALL_DAYS) {
      ohPlaceIds.push(pid);
      ohDays.push(day);
      ohOpens.push(p.opening_hours.open);
      ohCloses.push(p.opening_hours.close);
    }
  }

  if (ohPlaceIds.length > 0) {
    await client.query(
      `INSERT INTO place_opening_hour (place_id, day_of_week, open_time, close_time)
       SELECT UNNEST($1::bigint[]), UNNEST($2::int[]), UNNEST($3::time[]), UNNEST($4::time[])
       ON CONFLICT DO NOTHING`,
      [ohPlaceIds, ohDays, ohOpens, ohCloses],
    );
  }

  // Bulk INSERT tags
  const tagPlaceIds: number[] = [];
  const tagIds: number[]      = [];

  for (const p of places) {
    const pid = nameToId.get(p.name);
    if (pid == null) continue;
    const ids = [...new Set(
      (p.tags ?? []).map((t) => TAG_MAP[t]).filter((id): id is number => id !== undefined),
    )];
    for (const tid of ids) {
      tagPlaceIds.push(pid);
      tagIds.push(tid);
    }
  }

  if (tagPlaceIds.length > 0) {
    await client.query(
      `INSERT INTO place_tag_map (place_id, tag_id)
       SELECT UNNEST($1::bigint[]), UNNEST($2::int[])
       ON CONFLICT DO NOTHING`,
      [tagPlaceIds, tagIds],
    );
  }

  return { inserted, skipped };
}

async function seedFile(
  pool: pg.Pool,
  filePath: string,
  label: string,
): Promise<{ inserted: number; skipped: number }> {
  const places: PlaceJson[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`[SEED] ${label}: đọc ${places.length} địa điểm`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < places.length; i += BATCH_SIZE) {
    const batch = places.slice(i, i + BATCH_SIZE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await seedBatch(client, batch, label);
      await client.query('COMMIT');
      inserted += r.inserted;
      skipped += r.skipped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { inserted, skipped };
}

const PROGRESS_FILE = path.resolve(__dirname, '../../../.seed-progress');

function loadProgress(): Set<string> {
  if (!fs.existsSync(PROGRESS_FILE)) return new Set();
  return new Set(fs.readFileSync(PROGRESS_FILE, 'utf-8').split('\n').filter(Boolean));
}

function markDone(file: string) {
  fs.appendFileSync(PROGRESS_FILE, file + '\n');
}

async function main() {
  const dataDir = path.resolve(__dirname, '../../../data');
  if (!fs.existsSync(dataDir)) {
    console.error(`Thư mục data không tồn tại: ${dataDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('Không tìm thấy file JSON nào trong thư mục data/');
    process.exit(1);
  }

  const done = loadProgress();
  const pending = files.filter((f) => !done.has(f));
  console.log(`[SEED] Tìm thấy ${files.length} file, đã xong ${done.size}, còn lại ${pending.length}`);

  if (pending.length === 0) {
    console.log('[SEED] Tất cả file đã được seed. Xóa .seed-progress để chạy lại.');
    await pool.end();
    return;
  }

  // Seed tags once (outside per-file transactions)
  const tagClient = await pool.connect();
  try {
    await tagClient.query(`
      INSERT INTO place_tag (tag_id, name, display_name) VALUES
        (1,'beach','Biển'),(2,'mountain','Núi'),(3,'culture','Văn hóa'),
        (4,'food','Ẩm thực'),(5,'spiritual','Tâm linh'),(6,'shopping','Mua sắm'),
        (7,'entertainment','Giải trí'),(8,'nature','Thiên nhiên'),
        (9,'sport','Thể thao'),(10,'landmark','Điểm tham quan')
      ON CONFLICT (tag_id) DO NOTHING
    `);
  } finally {
    tagClient.release();
  }

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const file of pending) {
    const filePath = path.join(dataDir, file);
    const label = file.replace(/\.json$/, '');
    try {
      const { inserted, skipped } = await seedFile(pool, filePath, label);
      console.log(`[SEED]   ${label}: ${inserted} inserted, ${skipped} skipped`);
      markDone(file);
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (err) {
      console.error(`[SEED] Lỗi file ${file}:`, err);
    }
  }

  await pool.end();
  console.log(`\n[SEED] Hoàn thành: ${totalInserted} inserted, ${totalSkipped} skipped`);
}

main();
