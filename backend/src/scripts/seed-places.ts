import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });

// Map JSON tag string → place_tag.tag_id
const TAG_MAP: Record<string, number> = {
  beach:      1,
  mountain:   2,
  culture:    3,
  food:       4,
  local_food: 4,
  spiritual:  5,
  shopping:   6,
  coffee:     6,
  entertainment: 7,
  checkin:    7,
  nature:     8,
  outdoor:    8,
  walk:       8,
  sport:      9,
  tourism:    10,
  indoor:     3,
  relax:      8,
};

// Map category → price_type khi không rõ
const PRICE_TYPE_MAP: Record<string, string> = {
  restaurant: 'avg_meal',
  cafe:       'avg_meal',
  attraction: 'entry_fee',
  beach:      'free',
  park:       'free',
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

// day_of_week: 0=Sun … 6=Sat — seed tất cả 7 ngày với cùng giờ mở cửa
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

async function main() {
  const filePath = path.resolve(__dirname, '../../../danang_places.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const places: PlaceJson[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`[SEED] Đọc ${places.length} địa điểm từ danang_places.json`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Đảm bảo place_tag cơ bản tồn tại
    await client.query(`
      INSERT INTO place_tag (tag_id, name, display_name) VALUES
        (1,'beach','Biển'),(2,'mountain','Núi'),(3,'culture','Văn hóa'),
        (4,'food','Ẩm thực'),(5,'spiritual','Tâm linh'),(6,'shopping','Mua sắm'),
        (7,'entertainment','Giải trí'),(8,'nature','Thiên nhiên'),
        (9,'sport','Thể thao'),(10,'landmark','Điểm tham quan')
      ON CONFLICT (tag_id) DO NOTHING
    `);

    let inserted = 0;
    let skipped = 0;

    for (const p of places) {
      const indoorOutdoor = p.is_indoor ? 'indoor' : 'outdoor';
      const priceType =
        p.price_min === 0 && p.price_max === 0
          ? 'free'
          : PRICE_TYPE_MAP[p.category] ?? 'entry_fee';
      const popularityScore = Math.min(p.popularity / 100, 1.0);

      // Insert place — bỏ qua nếu đã có cùng tên + tọa độ gần giống
      const res = await client.query<{ place_id: number }>(
        `INSERT INTO place (
            name, description, geom,
            min_price, max_price, price_type,
            avg_visit_duration_min, indoor_outdoor,
            popularity_score, address
          ) VALUES (
            $1, $2,
            ST_GeogFromText('SRID=4326;POINT(' || $3 || ' ' || $4 || ')'),
            $5, $6, $7, $8, $9, $10, $11
          )
          ON CONFLICT DO NOTHING
          RETURNING place_id`,
        [
          p.name,
          null,
          p.lng,
          p.lat,
          p.price_min ?? 0,
          p.price_max ?? 0,
          priceType,
          p.duration_minutes ?? 60,
          indoorOutdoor,
          popularityScore,
          p.address ?? 'Da Nang',
        ],
      );

      if (res.rows.length === 0) {
        skipped++;
        continue;
      }

      const placeId = res.rows[0]!.place_id;
      inserted++;

      // Insert opening hours (tất cả 7 ngày)
      if (p.opening_hours?.open && p.opening_hours?.close) {
        for (const day of ALL_DAYS) {
          await client.query(
            `INSERT INTO place_opening_hour (place_id, day_of_week, open_time, close_time)
             VALUES ($1, $2, $3::time, $4::time)
             ON CONFLICT DO NOTHING`,
            [placeId, day, p.opening_hours.open, p.opening_hours.close],
          );
        }
      }

      // Insert tags
      const tagIds = [...new Set(
        p.tags.map((t) => TAG_MAP[t]).filter((id): id is number => id !== undefined),
      )];
      for (const tagId of tagIds) {
        await client.query(
          `INSERT INTO place_tag_map (place_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [placeId, tagId],
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[SEED] Hoàn thành: ${inserted} inserted, ${skipped} skipped (đã tồn tại)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED] Lỗi, rollback:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
