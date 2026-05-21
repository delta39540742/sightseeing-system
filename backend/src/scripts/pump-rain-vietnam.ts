/**
 * pump-rain-vietnam.ts
 *
 * Bơm sự kiện mưa lớn bao phủ toàn bộ Việt Nam vào tất cả chuyến đi
 * đang active/confirmed có slot planned trong tương lai.
 *
 * Chạy: DATABASE_URL="postgres://..." npx ts-node src/scripts/pump-rain-vietnam.ts
 */
import 'dotenv/config'
// Render dùng self-signed cert trong chain — tắt TLS verification cho script này
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
import { Pool } from 'pg'

// Tâm Việt Nam (khoảng Quảng Trị), bán kính 1500km phủ toàn quốc
const ANCHOR_LAT     = 16.5
const ANCHOR_LON     = 107.0
const RADIUS_KM      = 1500
const DURATION_HOURS = 24
const SEVERITY       = 0.9
const EVENT_TYPE     = 'rain_heavy'
const REASON         = 'Mưa lớn diện rộng toàn quốc — giả lập'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const client = await pool.connect()
  try {
    // 1. Lấy tất cả trip active/confirmed
    const tripsRes = await client.query<{ trip_id: string }>(
      `SELECT trip_id FROM trip WHERE status IN ('active', 'confirmed')`,
    )
    const trips = tripsRes.rows
    console.log(`[pump-rain] Tìm thấy ${trips.length} trip(s) active/confirmed`)

    if (trips.length === 0) {
      console.log('[pump-rain] Không có trip nào — thoát.')
      return
    }

    const payload = {
      reason:         REASON,
      started_at:     new Date().toISOString(),
      duration_hours: DURATION_HOURS,
      radius_km:      RADIUS_KM,
      anchor_lat:     ANCHOR_LAT,
      anchor_lon:     ANCHOR_LON,
    }

    let created = 0
    let skipped = 0

    for (const { trip_id } of trips) {
      // 2. Kiểm tra trip có slot planned trong tương lai không
      const slotsRes = await client.query<{ slot_id: string }>(
        `SELECT ts.slot_id
           FROM trip_slot ts
           JOIN place p ON p.place_id = ts.place_id
          WHERE ts.trip_id = $1
            AND ts.status  = 'planned'
            AND ts.planned_start > NOW()
          LIMIT 1`,
        [trip_id],
      )

      if (slotsRes.rows.length === 0) {
        skipped++
        continue
      }

      // Lấy toàn bộ slot planned để ghi vào affected_slot_ids
      const allSlotsRes = await client.query<{ slot_id: string }>(
        `SELECT ts.slot_id
           FROM trip_slot ts
          WHERE ts.trip_id = $1
            AND ts.status  = 'planned'
            AND ts.planned_start > NOW()`,
        [trip_id],
      )
      const affectedSlotIds = allSlotsRes.rows.map(r => r.slot_id)

      // 3. INSERT nếu chưa có event open cùng loại trong 6h gần nhất
      const res = await client.query(
        `INSERT INTO trip_event
           (trip_id, event_type, severity, source, payload, affected_slot_ids, status)
         SELECT $1, $2, $3, 'pump_script', $4, $5, 'open'
         WHERE NOT EXISTS (
           SELECT 1 FROM trip_event
            WHERE trip_id    = $1
              AND event_type = $2
              AND (
                status = 'open'
                OR (status IN ('dismissed', 'resolved_by_replan')
                    AND detected_at > NOW() - INTERVAL '6 hours')
              )
         )`,
        [trip_id, EVENT_TYPE, SEVERITY, JSON.stringify(payload), affectedSlotIds],
      )

      if (res.rowCount && res.rowCount > 0) {
        console.log(`  ✓ trip ${trip_id} — ${affectedSlotIds.length} slot(s) bị ảnh hưởng`)
        created++
      } else {
        console.log(`  ~ trip ${trip_id} — đã có event open, bỏ qua`)
        skipped++
      }
    }

    console.log(`\n[pump-rain] Xong: ${created} event tạo mới, ${skipped} bỏ qua.`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error('[pump-rain] Lỗi:', err)
  process.exit(1)
})
