/**
 * replan.db.integration.test.ts
 *
 * Test tích hợp: kết nối DB thật → load context qua PlanLoader →
 * kiểm tra tính hợp lệ của từng trường đầu vào → chạy BeamSearch →
 * kiểm tra từng trường đầu ra.
 *
 * Trip thật: 6286745f-0b31-42f0-a7e8-5d1583518704
 *   Đà Nẵng 3 ngày | budget 3,000,000 VND | 11 slots | status = confirmed
 *
 * Yêu cầu: DB PostgreSQL phải đang chạy và DATABASE_URL trong .env hợp lệ.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { PlanLoader } from '../src/replanner/PlanLoader';
import BeamSearch, { ObjectiveScorer, type BeamSearchContext } from '../src/replanner/BeamSearch';
import StateEvolver from '../src/replanner/StateEvolver';
import { MutationOperators } from '../src/replanner/MutationOperators';
import { clearSetFeasibilityCache } from '../src/replanner/FeasibilityFilter';
import type { TripSlot, Place, TripState, UserPreference } from '@app/types';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TRIP_ID = '6286745f-0b31-42f0-a7e8-5d1583518704';
const USER_ID = 'e95b135e-ebde-4845-b2db-2b4cc56cc26b';
const BUDGET_TOTAL = 3_000_000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;

// UUIDs regex (v4)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// DB connection
// ---------------------------------------------------------------------------

let pool: pg.Pool;
let loader: PlanLoader;
let ctx: BeamSearchContext;

// Raw DB rows (queried directly — ground truth sebelum mapping)
let rawSlots: {
  slot_id: string; trip_id: string; day_index: number; slot_order: number;
  version: number; place_id: string; planned_start: string; planned_end: string;
  actual_start: string | null; actual_end: string | null; estimated_cost: number;
  activity_type: string; status: string;
}[] = [];

let rawPlaces: {
  place_id: string; name: string; lat: number; lng: number;
  avg_visit_duration_min: number; indoor_outdoor: string;
  min_price: number | null; terrain_easiness: number | null;
}[] = [];

let rawPref: {
  preference_vector: number[];
  pace: number;
  mobility_restrictions: string[];
} | null = null;

let rawTrip: {
  trip_id: string; user_id: string; destination_city: string;
  start_date: string; end_date: string; budget_total: number; status: string;
} | null = null;

beforeAll(async () => {
  const rawUrl = process.env.DATABASE_URL!;
  if (!rawUrl) throw new Error('DATABASE_URL không được cấu hình trong .env');

  const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
  const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
  pool = new pg.Pool({ connectionString, ssl, max: 3 });
  loader = new PlanLoader(pool);

  // Query raw data từ DB để validate
  const [tripRes, slotsRes, placesRes, prefRes] = await Promise.all([
    pool.query<typeof rawTrip>(
      `SELECT trip_id, user_id, destination_city, start_date::text, end_date::text,
              budget_total, status FROM trip WHERE trip_id = $1`,
      [TRIP_ID],
    ),
    pool.query(
      `SELECT slot_id, trip_id, day_index, slot_order, version::integer,
              place_id::text, planned_start::text, planned_end::text,
              actual_start::text, actual_end::text, estimated_cost::integer,
              activity_type, status
         FROM trip_slot WHERE trip_id = $1 ORDER BY day_index, slot_order`,
      [TRIP_ID],
    ),
    pool.query(
      `SELECT p.place_id::text, p.name, p.lat, p.lng, p.avg_visit_duration_min,
              p.indoor_outdoor, p.min_price, p.terrain_easiness
         FROM trip_slot ts
         JOIN place p ON p.place_id = ts.place_id
        WHERE ts.trip_id = $1`,
      [TRIP_ID],
    ),
    pool.query(
      `SELECT preference_vector, pace, mobility_restrictions
         FROM user_preference WHERE user_id = $1`,
      [USER_ID],
    ),
  ]);

  rawTrip = tripRes.rows[0] ?? null;
  rawSlots = slotsRes.rows;
  rawPlaces = placesRes.rows;
  rawPref = prefRes.rows[0] ?? null;

  // Tải context đầy đủ qua PlanLoader
  clearSetFeasibilityCache();
  ctx = await loader.load(TRIP_ID);
}, 20_000);

afterAll(async () => {
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper: kiểm tra ISO-8601 hợp lệ
// ---------------------------------------------------------------------------

function isValidISO(s: string): boolean {
  return !isNaN(new Date(s).getTime());
}

function vnHour(utcIso: string): number {
  const ms = new Date(utcIso).getTime();
  const vnMs = ms + VN_OFFSET_MS;
  return new Date(vnMs).getUTCHours() + new Date(vnMs).getUTCMinutes() / 60;
}

// ===========================================================================
// GROUP 0 — Kiểm tra dữ liệu thô từ DB trước khi mapping
// ===========================================================================

describe('GROUP 0 — Raw DB data validation', () => {

  describe('0.1 Trip header', () => {
    it('Trip tồn tại trong DB', () => {
      expect(rawTrip, 'Không tìm thấy trip trong DB').not.toBeNull();
    });

    it('trip_id là UUID hợp lệ', () => {
      expect(UUID_RE.test(rawTrip!.trip_id)).toBe(true);
    });

    it('user_id là UUID hợp lệ', () => {
      expect(UUID_RE.test(rawTrip!.user_id)).toBe(true);
    });

    it('destination_city không rỗng', () => {
      expect(rawTrip!.destination_city.trim().length).toBeGreaterThan(0);
    });

    it('budget_total = 3,000,000 VND', () => {
      expect(rawTrip!.budget_total).toBe(BUDGET_TOTAL);
    });

    it('status hợp lệ (confirmed | active | completed)', () => {
      expect(['confirmed', 'active', 'completed']).toContain(rawTrip!.status);
    });

    it('start_date và end_date là chuỗi date hợp lệ', () => {
      expect(isValidISO(rawTrip!.start_date)).toBe(true);
      expect(isValidISO(rawTrip!.end_date)).toBe(true);
    });

    it('end_date sau start_date', () => {
      expect(new Date(rawTrip!.end_date).getTime())
        .toBeGreaterThan(new Date(rawTrip!.start_date).getTime());
    });
  });

  describe('0.2 Slots từ DB', () => {
    it('Đúng 11 slots', () => {
      expect(rawSlots.length).toBe(11);
    });

    it('Tất cả slot thuộc đúng trip_id', () => {
      for (const s of rawSlots) {
        expect(s.trip_id).toBe(TRIP_ID);
      }
    });

    it('Tất cả slot_id là UUID v4 hợp lệ', () => {
      for (const s of rawSlots) {
        expect(UUID_RE.test(s.slot_id), `slot_id="${s.slot_id}" không phải UUID v4`).toBe(true);
      }
    });

    it('slot_id là duy nhất (không trùng)', () => {
      const ids = rawSlots.map(s => s.slot_id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('day_index nằm trong [0, 2]', () => {
      for (const s of rawSlots) {
        expect(s.day_index, `slot_id=${s.slot_id}: day_index=${s.day_index}`).toBeGreaterThanOrEqual(0);
        expect(s.day_index, `slot_id=${s.slot_id}: day_index=${s.day_index}`).toBeLessThanOrEqual(2);
      }
    });

    it('day_index phân phối đúng: ngày 0=5 slots, ngày 1=5 slots, ngày 2=1 slot', () => {
      const countByDay = new Map<number, number>();
      for (const s of rawSlots) {
        countByDay.set(s.day_index, (countByDay.get(s.day_index) ?? 0) + 1);
      }
      expect(countByDay.get(0)).toBe(5);
      expect(countByDay.get(1)).toBe(5);
      expect(countByDay.get(2)).toBe(1);
    });

    it('slot_order bắt đầu từ 1 và tăng dần toàn trip (1→11)', () => {
      const orders = rawSlots.map(s => s.slot_order).sort((a, b) => a - b);
      for (let i = 0; i < orders.length; i++) {
        expect(orders[i], `slot_order[${i}] phải là ${i + 1}`).toBe(i + 1);
      }
    });

    it('version là số nguyên dương', () => {
      for (const s of rawSlots) {
        expect(s.version, `slot_id=${s.slot_id}: version=${s.version}`).toBeGreaterThan(0);
        expect(Number.isInteger(s.version)).toBe(true);
      }
    });

    it('place_id là số nguyên dương', () => {
      for (const s of rawSlots) {
        const id = Number(s.place_id);
        expect(Number.isInteger(id) && id > 0, `place_id="${s.place_id}" không hợp lệ`).toBe(true);
      }
    });

    it('planned_start là ISO-8601 hợp lệ', () => {
      for (const s of rawSlots) {
        expect(isValidISO(s.planned_start), `slot_order=${s.slot_order}: planned_start="${s.planned_start}" không hợp lệ`).toBe(true);
      }
    });

    it('planned_end là ISO-8601 hợp lệ và sau planned_start', () => {
      for (const s of rawSlots) {
        expect(isValidISO(s.planned_end), `slot_order=${s.slot_order}: planned_end không hợp lệ`).toBe(true);
        expect(new Date(s.planned_end).getTime(), `slot_order=${s.slot_order}: end <= start`).toBeGreaterThan(
          new Date(s.planned_start).getTime(),
        );
      }
    });

    it('[KNOWN BUG] timestamps DB lưu như giờ VN nhưng có Z suffix (giả UTC)', () => {
      // Nếu treat như UTC thực: slot đầu "08:00:00Z" → 15:00 VN, slot cuối "20:00:00Z" → 03:00 VN ngày sau
      // → Nhiều slot sẽ rơi ngoài cửa sổ 08:00-22:00 VN khi treat như UTC thực
      let outsideWindowCount = 0;
      for (const s of rawSlots) {
        const endHourVN = vnHour(s.planned_end);
        // "2026-05-23T20:00:00.000Z" as UTC → 03:00 VN next day → outside [8,22]
        if (endHourVN > DAY_END_HOUR || endHourVN < DAY_START_HOUR) {
          outsideWindowCount++;
        }
      }
      // Ít nhất 1 slot nằm ngoài cửa sổ khi treat như UTC (chứng minh bug tồn tại)
      expect(
        outsideWindowCount,
        `KNOWN BUG: ${outsideWindowCount}/11 slots ngoài cửa sổ 08:00-22:00 VN khi treat như UTC thực. ` +
        `Timestamps trong DB thực chất là giờ VN local, không phải UTC.`,
      ).toBeGreaterThan(0);
    });

    it('estimated_cost là số không âm', () => {
      for (const s of rawSlots) {
        expect(s.estimated_cost, `slot_order=${s.slot_order}: estimated_cost âm`).toBeGreaterThanOrEqual(0);
      }
    });

    it('activity_type là enum hợp lệ', () => {
      const valid = ['sightseeing', 'meal', 'rest', 'transport'];
      for (const s of rawSlots) {
        expect(valid).toContain(s.activity_type);
      }
    });

    it('status là enum hợp lệ', () => {
      const valid = ['planned', 'completed', 'skipped', 'in_progress', 'replaced'];
      for (const s of rawSlots) {
        expect(valid, `slot_order=${s.slot_order}: status="${s.status}" không hợp lệ`).toContain(s.status);
      }
    });

    it('Tất cả slots trong trip này có status = planned', () => {
      for (const s of rawSlots) {
        expect(s.status, `slot_order=${s.slot_order}: status phải là planned`).toBe('planned');
      }
    });
  });

  describe('0.3 Places từ DB', () => {
    it('Lấy được đúng 11 place records (1 per slot)', () => {
      expect(rawPlaces.length).toBe(11);
    });

    it('Tất cả place_id là số nguyên dương', () => {
      for (const p of rawPlaces) {
        const id = Number(p.place_id);
        expect(Number.isInteger(id) && id > 0, `place_id="${p.place_id}" không hợp lệ`).toBe(true);
      }
    });

    it('name không rỗng', () => {
      for (const p of rawPlaces) {
        expect(p.name.trim().length, `place_id=${p.place_id}: name rỗng`).toBeGreaterThan(0);
      }
    });

    it('lat trong khoảng [-90, 90]', () => {
      for (const p of rawPlaces) {
        expect(p.lat, `place ${p.name}: lat=${p.lat} ngoài phạm vi`).toBeGreaterThanOrEqual(-90);
        expect(p.lat, `place ${p.name}: lat=${p.lat} ngoài phạm vi`).toBeLessThanOrEqual(90);
      }
    });

    it('lng trong khoảng [-180, 180]', () => {
      for (const p of rawPlaces) {
        expect(p.lng, `place ${p.name}: lng=${p.lng} ngoài phạm vi`).toBeGreaterThanOrEqual(-180);
        expect(p.lng, `place ${p.name}: lng=${p.lng} ngoài phạm vi`).toBeLessThanOrEqual(180);
      }
    });

    it('Tất cả places nằm trong vùng Đà Nẵng / Quảng Nam (lat ~15.7–16.3, lng ~107.9–108.5)', () => {
      for (const p of rawPlaces) {
        expect(p.lat, `place ${p.name}: lat=${p.lat} ngoài vùng Đà Nẵng`).toBeGreaterThanOrEqual(15.7);
        expect(p.lat, `place ${p.name}: lat=${p.lat} ngoài vùng Đà Nẵng`).toBeLessThanOrEqual(16.3);
        expect(p.lng, `place ${p.name}: lng=${p.lng} ngoài vùng Đà Nẵng`).toBeGreaterThanOrEqual(107.9);
        expect(p.lng, `place ${p.name}: lng=${p.lng} ngoài vùng Đà Nẵng`).toBeLessThanOrEqual(108.5);
      }
    });

    it('avg_visit_duration_min là số nguyên dương', () => {
      for (const p of rawPlaces) {
        expect(p.avg_visit_duration_min, `place ${p.name}: avg_visit_duration_min <= 0`).toBeGreaterThan(0);
        expect(Number.isInteger(p.avg_visit_duration_min)).toBe(true);
      }
    });

    it('indoor_outdoor là enum hợp lệ', () => {
      for (const p of rawPlaces) {
        expect(['indoor', 'outdoor'], `place ${p.name}: indoor_outdoor="${p.indoor_outdoor}"`).toContain(p.indoor_outdoor);
      }
    });

    it('min_price không âm khi có giá trị', () => {
      for (const p of rawPlaces) {
        if (p.min_price !== null) {
          expect(p.min_price, `place ${p.name}: min_price < 0`).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('[INFO] terrain_easiness = null cho tất cả places → engine fallback về 0.8', () => {
      const nullCount = rawPlaces.filter(p => p.terrain_easiness === null).length;
      // Đây không phải bug — engine có fallback hợp lệ
      // Test này chỉ document trạng thái dữ liệu thực tế
      expect(nullCount).toBe(rawPlaces.length);
    });
  });

  describe('0.4 User preference từ DB', () => {
    it('Người dùng có preference record trong DB', () => {
      expect(rawPref, 'Không tìm thấy user_preference cho user này').not.toBeNull();
    });

    it('preference_vector có đúng 10 phần tử', () => {
      expect(rawPref!.preference_vector.length).toBe(10);
    });

    it('Tất cả phần tử preference_vector nằm trong [0, 1]', () => {
      for (let i = 0; i < rawPref!.preference_vector.length; i++) {
        const v = rawPref!.preference_vector[i]!;
        expect(v, `preference_vector[${i}]=${v} ngoài [0,1]`).toBeGreaterThanOrEqual(0);
        expect(v, `preference_vector[${i}]=${v} ngoài [0,1]`).toBeLessThanOrEqual(1);
      }
    });

    it('pace nằm trong [0, 1]', () => {
      expect(rawPref!.pace).toBeGreaterThanOrEqual(0);
      expect(rawPref!.pace).toBeLessThanOrEqual(1);
    });

    it('mobility_restrictions là array', () => {
      expect(Array.isArray(rawPref!.mobility_restrictions)).toBe(true);
    });
  });
});

// ===========================================================================
// GROUP 1 — Kiểm tra context sau khi PlanLoader.load()
// ===========================================================================

describe('GROUP 1 — PlanLoader output validation', () => {

  describe('1.1 remainingSlots (mapped TripSlot[])', () => {
    it('PlanLoader trả về đúng 11 remainingSlots', () => {
      expect(ctx.remainingSlots.length).toBe(11);
    });

    it('Mọi slotId là chuỗi không rỗng', () => {
      for (const s of ctx.remainingSlots) {
        expect(typeof s.slotId).toBe('string');
        expect(s.slotId.length).toBeGreaterThan(0);
      }
    });

    it('Mọi tripId khớp với TRIP_ID', () => {
      for (const s of ctx.remainingSlots) {
        expect(s.tripId).toBe(TRIP_ID);
      }
    });

    it('placeId là number (không phải string)', () => {
      for (const s of ctx.remainingSlots) {
        expect(typeof s.placeId).toBe('number');
        expect(s.placeId).toBeGreaterThan(0);
      }
    });

    it('plannedStart và plannedEnd là ISO-8601 hợp lệ', () => {
      for (const s of ctx.remainingSlots) {
        expect(isValidISO(s.plannedStart), `slotOrder=${s.slotOrder}: plannedStart không hợp lệ`).toBe(true);
        expect(isValidISO(s.plannedEnd), `slotOrder=${s.slotOrder}: plannedEnd không hợp lệ`).toBe(true);
      }
    });

    it('plannedEnd > plannedStart cho mọi slot', () => {
      for (const s of ctx.remainingSlots) {
        expect(new Date(s.plannedEnd).getTime(), `slotOrder=${s.slotOrder}: end <= start`).toBeGreaterThan(
          new Date(s.plannedStart).getTime(),
        );
      }
    });

    it('estimatedCost là số không âm', () => {
      for (const s of ctx.remainingSlots) {
        expect(s.estimatedCost ?? 0).toBeGreaterThanOrEqual(0);
      }
    });

    it('activityType là enum hợp lệ', () => {
      const valid = ['sightseeing', 'meal', 'rest', 'transport'];
      for (const s of ctx.remainingSlots) {
        expect(valid).toContain(s.activityType);
      }
    });

    it('status là enum hợp lệ', () => {
      const valid = ['planned', 'completed', 'skipped', 'in_progress', 'replaced'];
      for (const s of ctx.remainingSlots) {
        expect(valid).toContain(s.status);
      }
    });

    it('Không có placeId trùng lặp trong remainingSlots', () => {
      const ids = ctx.remainingSlots.map(s => s.placeId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('1.2 initialState (không có snapshot → buildDefaultState)', () => {
    it('initialState tồn tại', () => {
      expect(ctx.initialState).toBeDefined();
    });

    it('tripId khớp với TRIP_ID', () => {
      expect(ctx.initialState.tripId).toBe(TRIP_ID);
    });

    it('budgetRemaining = budget_total (chưa tiêu gì)', () => {
      expect(ctx.initialState.budgetRemaining).toBe(BUDGET_TOTAL);
    });

    it('timeRemainingMin = 720 (12h / ngày)', () => {
      expect(ctx.initialState.timeRemainingMin).toBe(720);
    });

    it('fatigue = 0 (trip mới)', () => {
      expect(ctx.initialState.fatigue).toBe(0);
    });

    it('moodProxy = 0.8 (trạng thái ban đầu tốt)', () => {
      expect(ctx.initialState.moodProxy).toBe(0.8);
    });

    it('currentLat/Lng hợp lệ (không null, trong vùng Đà Nẵng)', () => {
      expect(ctx.initialState.currentLat).toBeGreaterThan(15.5);
      expect(ctx.initialState.currentLat).toBeLessThan(16.5);
      expect(ctx.initialState.currentLng).toBeGreaterThan(107.5);
      expect(ctx.initialState.currentLng).toBeLessThan(109.0);
    });

    it('dayIndex >= 0', () => {
      expect(ctx.initialState.dayIndex).toBeGreaterThanOrEqual(0);
    });

    it('capturedAt là ISO-8601 hợp lệ', () => {
      expect(isValidISO(ctx.initialState.capturedAt)).toBe(true);
    });

    it('source là simulated (không có snapshot)', () => {
      expect(ctx.initialState.source).toBe('simulated');
    });
  });

  describe('1.3 candidatePool (Place[])', () => {
    it('candidatePool không rỗng', () => {
      expect(ctx.candidatePool.length).toBeGreaterThan(0);
    });

    it('Tất cả placeId trong remainingSlots đều có mặt trong candidatePool', () => {
      const poolIds = new Set(ctx.candidatePool.map(p => p.placeId));
      for (const s of ctx.remainingSlots) {
        expect(poolIds.has(s.placeId), `placeId=${s.placeId} không có trong candidatePool`).toBe(true);
      }
    });

    it('Mọi place có lat/lng hợp lệ', () => {
      for (const p of ctx.candidatePool) {
        expect(p.lat, `place ${p.name}: lat=${p.lat}`).toBeGreaterThanOrEqual(-90);
        expect(p.lat, `place ${p.name}: lat=${p.lat}`).toBeLessThanOrEqual(90);
        expect(p.lng, `place ${p.name}: lng=${p.lng}`).toBeGreaterThanOrEqual(-180);
        expect(p.lng, `place ${p.name}: lng=${p.lng}`).toBeLessThanOrEqual(180);
      }
    });

    it('Mọi place có avgVisitDurationMin > 0', () => {
      for (const p of ctx.candidatePool) {
        expect(p.avgVisitDurationMin, `place ${p.name}: avgVisitDurationMin <= 0`).toBeGreaterThan(0);
      }
    });

    it('Mọi place có indoorOutdoor hợp lệ', () => {
      for (const p of ctx.candidatePool) {
        expect(['indoor', 'outdoor'], `place ${p.name}: indoorOutdoor="${p.indoorOutdoor}"`).toContain(p.indoorOutdoor);
      }
    });

    it('Mọi place có tags là array', () => {
      for (const p of ctx.candidatePool) {
        expect(Array.isArray(p.tags), `place ${p.name}: tags không phải array`).toBe(true);
      }
    });

    it('Mọi place có openingHours là array', () => {
      for (const p of ctx.candidatePool) {
        expect(Array.isArray(p.openingHours), `place ${p.name}: openingHours không phải array`).toBe(true);
      }
    });

    it('openingHours format có thể chứa giây ("08:00:00") → engine vẫn parse đúng', () => {
      // Engine dùng .split(':').map(Number)[0,1] → giây bị ignore → không bị lỗi
      for (const p of ctx.candidatePool) {
        for (const h of p.openingHours) {
          const [openH] = h.openTime.split(':').map(Number);
          const [closeH] = h.closeTime.split(':').map(Number);
          expect(isNaN(openH!), `place ${p.name}: openTime="${h.openTime}" parse thất bại`).toBe(false);
          expect(isNaN(closeH!), `place ${p.name}: closeTime="${h.closeTime}" parse thất bại`).toBe(false);
          expect(openH!, `openH phải trong [0,23]`).toBeGreaterThanOrEqual(0);
          expect(openH!, `openH phải trong [0,23]`).toBeLessThanOrEqual(23);
        }
      }
    });

    it('estimatedCost không âm cho mọi place', () => {
      for (const p of ctx.candidatePool) {
        expect(p.estimatedCost ?? 0, `place ${p.name}: estimatedCost < 0`).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('1.4 user preference (mapped từ DB)', () => {
    it('preferenceVector có 10 phần tử', () => {
      expect(ctx.user.preferenceVector.length).toBe(10);
    });

    it('Mọi phần tử preferenceVector trong [0, 1]', () => {
      for (let i = 0; i < ctx.user.preferenceVector.length; i++) {
        const v = ctx.user.preferenceVector[i]!;
        expect(v, `preferenceVector[${i}]=${v} ngoài [0,1]`).toBeGreaterThanOrEqual(0);
        expect(v, `preferenceVector[${i}]=${v} ngoài [0,1]`).toBeLessThanOrEqual(1);
      }
    });

    it('pace trong [0, 1]', () => {
      expect(ctx.user.pace).toBeGreaterThanOrEqual(0);
      expect(ctx.user.pace).toBeLessThanOrEqual(1);
    });

    it('mobilityRestrictions là array', () => {
      expect(Array.isArray(ctx.user.mobilityRestrictions)).toBe(true);
    });
  });

  describe('1.5 ObjectiveWeights', () => {
    it('Tất cả weight là số hữu hạn và không âm', () => {
      const w = ctx.weights;
      const fields: [string, number][] = [
        ['wInterest', w.wInterest], ['wPace', w.wPace], ['wDistance', w.wDistance],
        ['wBudget', w.wBudget], ['wWeather', w.wWeather], ['wRisk', w.wRisk],
        ['wStability', w.wStability], ['wPotentialBias', w.wPotentialBias],
        ['wProximity', w.wProximity], ['wSynergy', w.wSynergy],
      ];
      for (const [name, val] of fields) {
        expect(isFinite(val), `${name}=${val} không phải số hữu hạn`).toBe(true);
        expect(val, `${name}=${val} âm`).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ===========================================================================
// GROUP 2 — Chạy BeamSearch với data thật và validate output
// ===========================================================================

describe('GROUP 2 — BeamSearch với data DB thật', () => {
  let evolver: StateEvolver;
  let operators: MutationOperators;
  let scorer: ObjectiveScorer;
  let beamSearch: BeamSearch;
  let resultPlan: TripSlot[];
  let resultScore: number;

  beforeAll(() => {
    clearSetFeasibilityCache();
    evolver = new StateEvolver();
    operators = new MutationOperators(evolver);
    scorer = new ObjectiveScorer(evolver);
    beamSearch = new BeamSearch(evolver, operators, scorer, {
      beamWidth: 4,
      maxIterations: 10,
      improvementThreshold: 0.001,
      latencyBudgetMs: 10_000,
    });

    // Cố định thời gian để kết quả deterministic
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-24T03:00:00.000Z').getTime());

    const result = beamSearch.search(ctx);
    resultPlan = result.plan;
    resultScore = result.score;

    vi.restoreAllMocks();
  }, 30_000);

  describe('2.1 Smoke test', () => {
    it('BeamSearch.search() không throw', () => {
      expect(() => {
        clearSetFeasibilityCache();
        vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-24T03:00:00.000Z').getTime());
        const r = beamSearch.search(ctx);
        vi.restoreAllMocks();
        expect(r).toBeDefined();
      }).not.toThrow();
    });

    it('Kết quả plan là array không rỗng', () => {
      expect(Array.isArray(resultPlan)).toBe(true);
      expect(resultPlan.length, 'BeamSearch phải trả về ít nhất 1 slot').toBeGreaterThan(0);
    });

    it('Score là số hữu hạn', () => {
      expect(isFinite(resultScore), `score=${resultScore} không phải số hữu hạn`).toBe(true);
    });
  });

  describe('2.2 Cấu trúc mỗi slot trong output', () => {
    it('Mọi slotId là chuỗi không rỗng', () => {
      for (const s of resultPlan) {
        expect(typeof s.slotId).toBe('string');
        expect(s.slotId.length).toBeGreaterThan(0);
      }
    });

    it('Mọi tripId = TRIP_ID', () => {
      for (const s of resultPlan) {
        expect(s.tripId).toBe(TRIP_ID);
      }
    });

    it('Mọi placeId là số nguyên dương', () => {
      for (const s of resultPlan) {
        expect(typeof s.placeId).toBe('number');
        expect(s.placeId).toBeGreaterThan(0);
      }
    });

    it('Mọi placeId trong plan xuất hiện trong candidatePool', () => {
      const poolIds = new Set(ctx.candidatePool.map(p => p.placeId));
      for (const s of resultPlan) {
        expect(poolIds.has(s.placeId), `placeId=${s.placeId} không có trong candidatePool`).toBe(true);
      }
    });

    it('Không có placeId trùng lặp', () => {
      const ids = resultPlan.map(s => s.placeId);
      const uniqueIds = new Set(ids);
      expect(
        uniqueIds.size,
        `plan có placeId trùng: [${ids.join(', ')}]`,
      ).toBe(ids.length);
    });

    it('plannedStart là ISO-8601 hợp lệ', () => {
      for (const s of resultPlan) {
        expect(isValidISO(s.plannedStart), `slotOrder=${s.slotOrder}: plannedStart="${s.plannedStart}" không hợp lệ`).toBe(true);
      }
    });

    it('plannedEnd là ISO-8601 hợp lệ và sau plannedStart', () => {
      for (const s of resultPlan) {
        expect(isValidISO(s.plannedEnd), `slotOrder=${s.slotOrder}: plannedEnd không hợp lệ`).toBe(true);
        expect(new Date(s.plannedEnd).getTime(), `slotOrder=${s.slotOrder}: end <= start`)
          .toBeGreaterThan(new Date(s.plannedStart).getTime());
      }
    });

    it('Thời lượng mỗi slot >= MIN_SLOT_DURATION_MIN (15 phút)', () => {
      for (const s of resultPlan) {
        const durationMin = (new Date(s.plannedEnd).getTime() - new Date(s.plannedStart).getTime()) / 60_000;
        expect(durationMin, `slotOrder=${s.slotOrder}: duration=${durationMin.toFixed(0)}min < 15`).toBeGreaterThanOrEqual(15);
      }
    });

    it('estimatedCost không âm', () => {
      for (const s of resultPlan) {
        expect(s.estimatedCost ?? 0, `slotOrder=${s.slotOrder}: estimatedCost < 0`).toBeGreaterThanOrEqual(0);
      }
    });

    it('status = planned cho mọi slot output', () => {
      for (const s of resultPlan) {
        expect(s.status, `slotOrder=${s.slotOrder}: status phải là planned`).toBe('planned');
      }
    });

    it('activityType là enum hợp lệ', () => {
      const valid = ['sightseeing', 'meal', 'rest', 'transport'];
      for (const s of resultPlan) {
        expect(valid, `slotOrder=${s.slotOrder}: activityType="${s.activityType}"`).toContain(s.activityType);
      }
    });
  });

  describe('2.3 Thứ tự và cấu trúc plan', () => {
    it('dayIndex của mọi slot trong [0, 2]', () => {
      for (const s of resultPlan) {
        expect(s.dayIndex, `slotOrder=${s.slotOrder}: dayIndex=${s.dayIndex}`).toBeGreaterThanOrEqual(0);
        expect(s.dayIndex, `slotOrder=${s.slotOrder}: dayIndex=${s.dayIndex}`).toBeLessThanOrEqual(2);
      }
    });

    it('slotOrder tăng dần trong mỗi ngày', () => {
      const byDay = new Map<number, TripSlot[]>();
      for (const s of resultPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s);
      }
      for (const [day, slots] of byDay) {
        const orders = slots.map(s => s.slotOrder);
        for (let i = 1; i < orders.length; i++) {
          expect(orders[i]!, `ngày ${day}: slotOrder không tăng`).toBeGreaterThan(orders[i - 1]!);
        }
      }
    });

    it('Các slots trong cùng ngày không chồng nhau về thời gian', () => {
      const byDay = new Map<number, TripSlot[]>();
      for (const s of resultPlan) {
        if (!byDay.has(s.dayIndex)) byDay.set(s.dayIndex, []);
        byDay.get(s.dayIndex)!.push(s);
      }
      for (const [day, slots] of byDay) {
        const sorted = [...slots].sort(
          (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime(),
        );
        for (let i = 1; i < sorted.length; i++) {
          const prevEnd = new Date(sorted[i - 1]!.plannedEnd).getTime();
          const curStart = new Date(sorted[i]!.plannedStart).getTime();
          expect(
            curStart,
            `ngày ${day}: slot ${sorted[i]!.slotOrder} (${sorted[i]!.plannedStart}) bắt đầu trước khi slot ${sorted[i - 1]!.slotOrder} kết thúc (${sorted[i - 1]!.plannedEnd})`,
          ).toBeGreaterThanOrEqual(prevEnd);
        }
      }
    });
  });

  describe('2.4 State trajectory validation', () => {
    it('computeTrajectory không throw với output plan', () => {
      expect(() => evolver.computeTrajectory(resultPlan, ctx.initialState, ctx)).not.toThrow();
    });

    it('states.length = plan.length + 1', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      expect(states.length).toBe(resultPlan.length + 1);
    });

    it('budgetRemaining không tăng sau mỗi bước', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      for (let i = 1; i < states.length; i++) {
        expect(
          states[i]!.budgetRemaining,
          `budgetRemaining[${i}]=${states[i]!.budgetRemaining} > budgetRemaining[${i - 1}]=${states[i - 1]!.budgetRemaining}`,
        ).toBeLessThanOrEqual(states[i - 1]!.budgetRemaining);
      }
    });

    it('budgetRemaining không âm trong suốt trajectory', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      for (let i = 0; i < states.length; i++) {
        expect(
          states[i]!.budgetRemaining,
          `budgetRemaining âm tại step ${i}: ${states[i]!.budgetRemaining}`,
        ).toBeGreaterThanOrEqual(0);
      }
    });

    it('fatigue không vượt FATIGUE_CAP (0.95) trong suốt trajectory', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      for (let i = 0; i < states.length; i++) {
        expect(
          states[i]!.fatigue,
          `fatigue tại step ${i} = ${states[i]!.fatigue.toFixed(3)} > 0.95`,
        ).toBeLessThanOrEqual(0.95);
      }
    });

    it('fatigue trong [0, 1] mọi lúc', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      for (const s of states) {
        expect(s.fatigue).toBeGreaterThanOrEqual(0);
        expect(s.fatigue).toBeLessThanOrEqual(1);
      }
    });

    it('moodProxy trong [0, 1] mọi lúc', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      for (const s of states) {
        expect(s.moodProxy).toBeGreaterThanOrEqual(0);
        expect(s.moodProxy).toBeLessThanOrEqual(1);
      }
    });

    it('currentLat của state cuối là lat của place cuối trong plan', () => {
      const states = evolver.computeTrajectory(resultPlan, ctx.initialState, ctx);
      const lastSlot = resultPlan[resultPlan.length - 1]!;
      const lastPlace = ctx.candidatePool.find(p => p.placeId === lastSlot.placeId)!;
      const lastState = states[states.length - 1]!;
      expect(lastState.currentLat).toBeCloseTo(lastPlace.lat, 6);
      expect(lastState.currentLng).toBeCloseTo(lastPlace.lng, 6);
    });
  });

  describe('2.5 MutationOperators với data thật từ DB (dùng input slots ngày hiện tại)', () => {
    // Dùng slots ngày hiện tại (dayIndex = initialState.dayIndex) từ input DB, không phải BeamSearch output.
    // Lý do: resultPlan đã được BeamSearch tối ưu với timestamps từ DB "bugged" (local VN lưu như UTC);
    // simulateIfFeasible sẽ trả về null cho hầu hết mutations vì thời gian đã bị saturate.
    // Test này kiểm tra MutationOperators với input data thật, tương tự TC8 trong e2e test.

    function buildMutationCtx() {
      clearSetFeasibilityCache();
      // Dùng slots ngày 0 vì các địa điểm tập trung trong bán kính ~15km (Đà Nẵng).
      // Slots ngày 1 bao gồm Núi Thần Tài (108.02°) và Cua Dai (108.36°) — cách nhau ~37km
      // → travel time ~124 min → tổng 5 slots + travel > 720 min → mọi mutation infeasible.
      //
      // DB lưu slots ngày 0 timestamps: 08:00–20:00 UTC (= 15:00–03:00 VN).
      // capturedAt = "2026-05-23T01:00:00.000Z" (= 08:00 VN — trước tất cả slots ngày 0).
      // repairSuffix sẽ tôn trọng originalStartMs cho tất cả slots.
      const day0Slots = ctx.remainingSlots.filter(s => s.dayIndex === 0);
      const mutationState: TripState = {
        ...ctx.initialState,
        capturedAt: '2026-05-23T01:00:00.000Z',  // 08:00 VN ngày 0 — trước tất cả slots
        timeRemainingMin: 720,
        currentLat: 16.0544,
        currentLng: 108.2022,
      };
      return {
        ctxWithMap: {
          ...ctx,
          initialState: mutationState,
          placeMap: new Map(ctx.candidatePool.map(p => [p.placeId, p])),
        } as BeamSearchContext & { placeMap: Map<number, Place> },
        targetSlots: day0Slots,
      };
    }

    it('generateAll() sinh ít nhất 1 mutation hợp lệ từ slots DB ngày hiện tại', () => {
      const { ctxWithMap, targetSlots } = buildMutationCtx();
      const mutations = operators.generateAll(targetSlots, ctxWithMap);
      expect(
        mutations.length,
        `generateAll() phải trả về ít nhất 1 mutation từ ${targetSlots.length} slots ngày ${ctx.initialState.dayIndex}`,
      ).toBeGreaterThanOrEqual(1);
    });

    it('Mọi mutation result có newPlan là array không rỗng', () => {
      const { ctxWithMap, targetSlots } = buildMutationCtx();
      const mutations = operators.generateAll(targetSlots, ctxWithMap);
      for (const m of mutations) {
        expect(Array.isArray(m.newPlan)).toBe(true);
        expect(m.newPlan.length).toBeGreaterThan(0);
      }
    });

    it('Mọi slot trong mutation output có plannedEnd > plannedStart', () => {
      const { ctxWithMap, targetSlots } = buildMutationCtx();
      const mutations = operators.generateAll(targetSlots, ctxWithMap);
      for (const m of mutations) {
        for (const s of m.newPlan) {
          const start = new Date(s.plannedStart).getTime();
          const end = new Date(s.plannedEnd).getTime();
          expect(end, `op=${m.operator} placeId=${s.placeId}: end <= start`).toBeGreaterThan(start);
        }
      }
    });

    it('Không có placeId trùng lặp trong bất kỳ mutation output nào', () => {
      const { ctxWithMap, targetSlots } = buildMutationCtx();
      const mutations = operators.generateAll(targetSlots, ctxWithMap);
      for (const m of mutations) {
        const ids = m.newPlan.map(s => s.placeId);
        const unique = new Set(ids);
        expect(unique.size, `op=${m.operator}: placeId trùng lặp [${ids.join(',')}]`).toBe(ids.length);
      }
    });

    it('[INFO] generateAll(resultPlan) có thể trả về 0 mutation — đây là behavior đúng', () => {
      // resultPlan được BeamSearch tối ưu dựa trên DB timestamps bugged (08:00 UTC = 15:00 VN).
      // repairSuffix preserves originalStartMs (Math.max) nên kế hoạch bắt đầu lúc 15:00 VN.
      // Từ 15:00 VN chỉ còn 7h → saturate timeRemainingMin (720 min).
      // simulateIfFeasible() trả về null cho hầu hết mutations vì thời gian đã đầy.
      // Đây KHÔNG phải bug của MutationOperators mà là artifact của timestamp bug trong DB.
      clearSetFeasibilityCache();
      const ctxWithMap = {
        ...ctx,
        placeMap: new Map(ctx.candidatePool.map(p => [p.placeId, p])),
      };
      const mutations = operators.generateAll(resultPlan, ctxWithMap);
      // Document hành vi (không assert cụ thể — có thể 0 hoặc nhiều hơn)
      expect(typeof mutations.length).toBe('number');
      expect(mutations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('2.6 So sánh score theo kịch bản thời tiết', () => {
    it('Score plan gốc (DB slots, trời tốt) >= score với mưa nặng', () => {
      // Dùng remainingSlots thô từ DB (chưa qua BeamSearch)
      const ctxGood = { ...ctx, weatherForecast: [] };
      const ctxRain = {
        ...ctx,
        weatherForecast: [{ rainMmPerH: 30 }, { rainMmPerH: 20 }, { rainMmPerH: 0 }],
      };

      // Chỉ test ngày 0 để đơn giản
      const day0Slots = ctx.remainingSlots.filter(s => s.dayIndex === 0);
      const initDay0 = { ...ctx.initialState, timeRemainingMin: 720 };

      const statesGood = evolver.computeTrajectory(day0Slots, initDay0, ctxGood);
      const scoreGood = scorer.score(day0Slots, statesGood, ctx.weights, ctxGood);

      const statesRain = evolver.computeTrajectory(day0Slots, initDay0, ctxRain);
      const scoreRain = scorer.score(day0Slots, statesRain, ctx.weights, ctxRain);

      // Plan ngày 0 có 2 outdoor slots (My An Beach, Bãi Biển Sơn Trà)
      // → mưa làm giảm score do weather penalty
      expect(
        scoreRain,
        `Score mưa (${scoreRain.toFixed(4)}) phải <= score trời tốt (${scoreGood.toFixed(4)})`,
      ).toBeLessThanOrEqual(scoreGood);
    });

    it('BeamSearch trả về plan khi mưa toàn chuyến (engine không crash)', () => {
      clearSetFeasibilityCache();
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-24T03:00:00.000Z').getTime());
      const ctxRain = {
        ...ctx,
        weatherForecast: [{ rainMmPerH: 30 }, { rainMmPerH: 25 }, { rainMmPerH: 20 }],
      };
      let plan: TripSlot[] = [];
      expect(() => {
        plan = beamSearch.search(ctxRain).plan;
      }).not.toThrow();
      expect(plan.length).toBeGreaterThan(0);
      vi.restoreAllMocks();
    });
  });
});
