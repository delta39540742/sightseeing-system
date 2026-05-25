import type { Pool } from 'pg';
import type { TripSlot, TripState, Place, UserPreference, ObjectiveWeights } from '@app/types';
import type { BeamSearchContext } from './BeamSearch';

const DA_NANG_CENTER = { lat: 16.0544, lng: 108.2022 };
const DEFAULT_DAY_MINUTES = 12 * 60;

const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  'da nang':  DA_NANG_CENTER,
  'đà nẵng': DA_NANG_CENTER,
  'danang':   DA_NANG_CENTER,
  'hoi an':   { lat: 15.8801, lng: 108.3380 },
  'hội an':   { lat: 15.8801, lng: 108.3380 },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1,
  wStability: 0.5, wPotentialBias: 1.0, wProximity: 0, wSynergy: 0.3,
};

export class PlanLoader {
  constructor(private readonly pool: Pool) { }

  /**
   * @summary Tải và lắp ráp toàn bộ BeamSearchContext từ database cho một chuyến đi.
   *
   * Thực hiện 3 giai đoạn truy vấn để xây dựng context phục vụ Beam Search:
   * 1. **Trip header** (tuần tự): Lấy thông tin cơ bản (`userId`, `budget`, `city`...).
   * 2. **Song song (`Promise.all`)**:
   *    - `v_trip_slot_active`: Danh sách slot chưa bị replaced/completed.
   *    - `trip_state_snapshot`: Snapshot trạng thái mới nhất (fatigue, budget, location).
   *    - `user_preference + user_objective_weights`: Vector sở thích và trọng số mục tiêu.
   * 3. **Địa điểm ứng viên** (song song): Tags và giờ mở cửa cho toàn bộ địa điểm trong thành phố
   *    cộng với các placeId đang có trong slot (mustInclude).
   *
   * **Side Effects:**
   * - Thực hiện ít nhất 5 truy vấn SQL đến `this.pool`.
   * - Nếu không có snapshot: gọi thêm `buildDefaultState()` (có thể thêm 1 truy vấn nữa).
   *
   * @param tripId {string} UUID của chuyến đi cần tải — phải là UUID hợp lệ và tồn tại trong DB.
   * @returns {Promise<BeamSearchContext>} Context hoàn chỉnh gồm `remainingSlots`, `initialState`,
   *   `weights`, `candidatePool`, `user`, `defaultWeather` (mưa=0), `weatherForecast` (mặc định `[]`).
   * @throws {Error} `"Trip ${tripId} not found"` khi tripId không tồn tại.
   * @throws {Error} Bất kỳ lỗi database nào (connection, timeout, constraint...) — không xử lý nội bộ.
   *
   * @pre `tripId` là UUID hợp lệ tồn tại trong bảng `trip`.
   *   `this.pool` đang kết nối và có quyền đọc các bảng liên quan.
   * @post `candidatePool` luôn chứa đầy đủ các địa điểm trong slot (mustInclude).
   *   `weatherForecast` mặc định là `[]` — caller tự inject nếu cần dự báo thời tiết.
   *
   * @example
   * ```typescript
   * const loader = new PlanLoader(pool);
   * const ctx = await loader.load('550e8400-e29b-41d4-a716-446655440000');
   * // ctx.remainingSlots → các slot chưa hoàn thành
   * // ctx.initialState   → snapshot mới nhất hoặc state mặc định nếu trip mới
   * // ctx.candidatePool  → tất cả địa điểm trong thành phố + địa điểm đang có trong slot
   * ```
   */
  async load(tripId: string): Promise<BeamSearchContext> {
    // 1. Load trip header
    const tripRes = await this.pool.query<{
      trip_id: string;
      user_id: string;
      destination_city: string;
      start_date: string;
      end_date: string;
      budget_total: number;
      hotel_place_id: string | null;
    }>(
      `SELECT trip_id, user_id, destination_city, start_date, end_date, budget_total, hotel_place_id
         FROM trip WHERE trip_id = $1`,
      [tripId],
    );
    const trip = tripRes.rows[0];
    if (!trip) throw new Error(`Trip ${tripId} not found`);

    // 2. Parallel: remaining slots + latest state snapshot + user pref + weights
    const [slotsRes, stateRes, prefRes] = await Promise.all([
      this.pool.query<{
        slot_id: string; trip_id: string; day_index: number; slot_order: number;
        version: number; place_id: string; planned_start: string; planned_end: string;
        actual_start: string | null; actual_end: string | null; estimated_cost: number;
        activity_type: string; rationale: string | null; status: string;
      }>(
        `SELECT slot_id, trip_id, day_index, slot_order, version,
                place_id, planned_start, planned_end,
                actual_start, actual_end, estimated_cost,
                activity_type, rationale, status
           FROM v_trip_slot_active
          WHERE trip_id = $1
          ORDER BY day_index, slot_order`,
        [tripId],
      ),

      this.pool.query<{
        day_index: number; slot_order: number; time_remaining_min: number;
        budget_remaining: number; fatigue: number;
        lat: number | null; lng: number | null;
        mood_proxy: number; captured_at: string; source: string;
      }>(
        `SELECT day_index, slot_order, time_remaining_min, budget_remaining, fatigue,
                ST_Y(current_geom::geometry) AS lat,
                ST_X(current_geom::geometry) AS lng,
                mood_proxy, captured_at, source
           FROM trip_state_snapshot
          WHERE trip_id = $1
          ORDER BY captured_at DESC
          LIMIT 1`,
        [tripId],
      ),

      this.pool.query<{
        preference_vector: number[]; pace: number; mobility_restrictions: string[];
        w_interest: number; w_pace: number; w_distance: number;
        w_budget: number; w_weather: number; w_risk: number;
        w_stability: number; w_potential_bias: number; w_proximity: number; w_synergy: number;
      }>(
        `SELECT up.preference_vector, up.pace, up.mobility_restrictions,
                COALESCE(uow.w_interest,       1.0) AS w_interest,
                COALESCE(uow.w_pace,           1.0) AS w_pace,
                COALESCE(uow.w_distance,       1.5) AS w_distance,
                COALESCE(uow.w_budget,         1.0) AS w_budget,
                COALESCE(uow.w_weather,        1.0) AS w_weather,
                COALESCE(uow.w_risk,           1.0) AS w_risk,
                COALESCE(uow.w_stability,      0.5) AS w_stability,
                COALESCE(uow.w_potential_bias, 1.0) AS w_potential_bias,
                COALESCE(uow.w_proximity,      0.0) AS w_proximity,
                COALESCE(uow.w_synergy,        0.3) AS w_synergy
           FROM user_preference up
           LEFT JOIN user_objective_weights uow ON uow.user_id = up.user_id
          WHERE up.user_id = $1`,
        [trip.user_id],
      ),
    ]);

    // 3. Map slots
    const remainingSlots: TripSlot[] = slotsRes.rows.map((r) => ({
      slotId: r.slot_id,
      tripId: r.trip_id,
      dayIndex: r.day_index,
      slotOrder: r.slot_order,
      version: r.version,
      placeId: Number(r.place_id),
      plannedStart: r.planned_start,
      plannedEnd: r.planned_end,
      actualStart: r.actual_start,
      actualEnd: r.actual_end,
      estimatedCost: r.estimated_cost,
      activityType: r.activity_type as TripSlot['activityType'],
      rationale: r.rationale,
      status: r.status as TripSlot['status'],
    }));

    // 4. Build initial state (from snapshot or derive from trip)
    const snap = stateRes.rows[0];
    let initialState: TripState = snap
      ? {
        tripId,
        dayIndex: snap.day_index,
        slotOrder: snap.slot_order,
        timeRemainingMin: snap.time_remaining_min,
        budgetRemaining: snap.budget_remaining,
        fatigue: snap.fatigue,
        currentLat: snap.lat ?? DA_NANG_CENTER.lat,
        currentLng: snap.lng ?? DA_NANG_CENTER.lng,
        moodProxy: snap.mood_proxy,
        capturedAt: snap.captured_at,
        source: snap.source === 'actual' ? 'actual' : 'simulated',
      }
      : await this.buildDefaultState(tripId, trip.budget_total, trip.start_date, trip.end_date, trip.hotel_place_id);

    // 4.1. Sanity-check snapshot position: if the stored coordinates are > 150 km from the
    // trip city, the snapshot was captured from a remote location (e.g. user was home in HCMC
    // while testing a Da Nang trip). Reset to hotel / city-center so TSP starts correctly.
    if (snap && snap.lat !== null && snap.lng !== null) {
      const cityKey = trip.destination_city.toLowerCase().trim();
      const cityCenter = CITY_CENTERS[cityKey] ?? DA_NANG_CENTER;
      const distKm = haversineKm(initialState.currentLat, initialState.currentLng, cityCenter.lat, cityCenter.lng);
      if (distKm > 150) {
        let lat = cityCenter.lat;
        let lng = cityCenter.lng;
        if (trip.hotel_place_id !== null) {
          const hotelRes = await this.pool.query<{ lat: number; lng: number }>(
            `SELECT lat, lng FROM place WHERE place_id = $1`,
            [trip.hotel_place_id],
          );
          if (hotelRes.rows[0]) {
            lat = hotelRes.rows[0].lat;
            lng = hotelRes.rows[0].lng;
          }
        }
        console.log(`[PlanLoader] snapshot (${snap.lat.toFixed(4)},${snap.lng.toFixed(4)}) is ${distKm.toFixed(0)}km from city → reset to (${lat.toFixed(4)},${lng.toFixed(4)})`);
        initialState = { ...initialState, currentLat: lat, currentLng: lng };
      }
    }

    // 5. Build user preference + weights
    const prefRow = prefRes.rows[0];
    const user: UserPreference = prefRow
      ? {
        preferenceVector: prefRow.preference_vector,
        pace: prefRow.pace,
        mobilityRestrictions: prefRow.mobility_restrictions ?? [],
      }
      : { preferenceVector: new Array(10).fill(0.1), pace: 0.5, mobilityRestrictions: [] };

    const weights: ObjectiveWeights = prefRow
      ? {
        wInterest: prefRow.w_interest,
        wPace: prefRow.w_pace,
        wDistance: prefRow.w_distance,
        wBudget: prefRow.w_budget,
        wWeather: prefRow.w_weather,
        wRisk: prefRow.w_risk,
        wStability: prefRow.w_stability,
        wPotentialBias: prefRow.w_potential_bias,
        wProximity: prefRow.w_proximity,
        wSynergy: prefRow.w_synergy,
      }
      : DEFAULT_WEIGHTS;

    // 6. Load candidate places for this city + ensure all slot places are included
    const slotPlaceIds = remainingSlots.map((s) => s.placeId);
    const candidatePool = await this.loadPlaces(trip.destination_city, slotPlaceIds);

    return {
      remainingSlots,
      weights,
      initialState,
      candidatePool,
      user,
      defaultWeather: { rainMmPerH: 0 },
      weatherForecast: [],
    };
  }

  /**
   * @summary Tải vector sở thích và cấu hình di chuyển của người dùng từ database.
   *
   * Truy vấn bảng `user_preference` lấy `preference_vector`, `pace`, `mobility_restrictions`.
   * Nếu người dùng chưa thiết lập preference (chưa có row), trả về giá trị mặc định an toàn
   * (vector trung lập, pace=0.5, restrictions=[]) thay vì throw error — tránh làm vỡ replan pipeline
   * đối với người dùng mới.
   *
   * **Side Effects:** Thực hiện 1 truy vấn SQL SELECT.
   *
   * @param userId {string} ID người dùng (Firebase UID) — không được null hay rỗng.
   * @returns {Promise<UserPreference>} Đối tượng preference gồm:
   *   - `preferenceVector`: Mảng 10 số [0,1] đại diện mức độ yêu thích theo từng tag.
   *   - `pace`: Số thực [0,1] — 0: thư thả, 1: dày đặc lịch.
   *   - `mobilityRestrictions`: Mảng tên hạn chế di chuyển (ví dụ: `['wheelchair']`).
   *   Khi không tìm thấy user: vector=[0.1×10], pace=0.5, restrictions=[].
   * @throws {Error} Lỗi database (connection, timeout...) — được ném lên caller.
   *
   * @pre `userId` là chuỗi không rỗng; `this.pool` đang hoạt động.
   * @post Không bao giờ trả về `null` hay `undefined`.
   *
   * @example
   * ```typescript
   * const loader = new PlanLoader(pool);
   * const pref = await loader.loadPreferences('firebase-uid-abc123');
   * console.log(pref.preferenceVector); // [0.8, 0.2, ...]
   * console.log(pref.pace);             // 0.6
   * ```
   */
  async loadPreferences(userId: string): Promise<UserPreference> {
    const res = await this.pool.query<{
      preference_vector: number[];
      pace: number;
      mobility_restrictions: string[];
    }>(
      `SELECT preference_vector, pace, mobility_restrictions
         FROM user_preference WHERE user_id = $1`,
      [userId],
    );
    const row = res.rows[0];
    // Fallback giống nhánh này trong load(): user mới chưa setup preference
    // không nên làm vỡ replan pipeline.
    if (!row) {
      return {
        preferenceVector: new Array(10).fill(0.1),
        pace: 0.5,
        mobilityRestrictions: [],
      };
    }
    return {
      preferenceVector: row.preference_vector,
      pace: row.pace,
      mobilityRestrictions: row.mobility_restrictions ?? [],
    };
  }

  // --------------------------------------------------------------------------

  /**
   * @summary Tạo TripState mặc định cho chuyến đi chưa có snapshot trạng thái.
   *
   * Được gọi khi `trip_state_snapshot` không có row nào cho `tripId` — thường gặp với trip mới
   * chưa bắt đầu. Logic tính toán:
   * - **Tọa độ xuất phát**: Lấy lat/lng của hotel (nếu `hotelPlaceId` không null), ngược lại
   *   dùng trung tâm Đà Nẵng (16.0544, 108.2022) làm mặc định.
   * - **dayIndex**: Số ngày nguyên đã trôi qua kể từ `startDate` của trip đến hiện tại (wall-clock).
   *   Tối thiểu là 0 (dù trip chưa bắt đầu, vẫn dùng ngày 0).
   * - **timeRemainingMin**: Cố định 720 phút (12 giờ hoạt động/ngày).
   * - **budgetRemaining**: Bằng `budgetTotal` của trip (chưa tiêu gì).
   * - **fatigue**: 0 (người dùng chưa mệt); **moodProxy**: 0.8 (tâm trạng tốt).
   *
   * **Side Effects:**
   * - Gọi `new Date()` để lấy thời điểm hiện tại (wall-clock — không thuần túy, không stable trong test).
   * - Thực hiện 1 truy vấn SQL nếu `hotelPlaceId` không null.
   *
   * @param tripId       {string}      UUID chuyến đi — điền vào `TripState.tripId`.
   * @param budgetTotal  {number}      Tổng ngân sách ban đầu (VND) — phải ≥ 0.
   * @param startDate    {string}      ISO date string ngày bắt đầu chuyến đi.
   * @param hotelPlaceId {string|null} `place_id` khách sạn để lấy tọa độ xuất phát, hoặc `null`.
   * @returns {Promise<TripState>} State mặc định với `source = 'simulated'`.
   * @throws {Error} Lỗi database khi tra cứu tọa độ hotel.
   *
   * @pre `budgetTotal ≥ 0`; `startDate` là chuỗi ngày hợp lệ.
   * @post `dayIndex ≥ 0`; `timeRemainingMin = 720`; `budgetRemaining = budgetTotal`.
   *
   * @example
   * ```typescript
   * // Gọi nội bộ trong load() khi không có snapshot:
   * const state = await this.buildDefaultState(tripId, 2_000_000, '2026-04-20', 'hotel-uuid');
   * // state.currentLat → tọa độ hotel (nếu có)
   * // state.dayIndex   → số ngày từ ngày 20/4 đến hôm nay
   * ```
   */
  private async buildDefaultState(
    tripId: string,
    budgetTotal: number,
    startDate: string,
    endDate: string,
    hotelPlaceId: string | null,
  ): Promise<TripState> {
    let lat = DA_NANG_CENTER.lat;
    let lng = DA_NANG_CENTER.lng;

    if (hotelPlaceId !== null) {
      const hotelRes = await this.pool.query<{ lat: number; lng: number }>(
        `SELECT lat, lng FROM place WHERE place_id = $1`,
        [hotelPlaceId],
      );
      if (hotelRes.rows[0]) {
        lat = hotelRes.rows[0].lat;
        lng = hotelRes.rows[0].lng;
      }
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();
    const dayIndex = Math.max(
      0,
      Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // Total trip duration in days (inclusive: start=day0, end=lastDay).
    const totalDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    );
    const daysRemaining = Math.max(1, totalDays - dayIndex);

    return {
      tripId,
      dayIndex,
      slotOrder: 0,
      timeRemainingMin: daysRemaining * DEFAULT_DAY_MINUTES,
      budgetRemaining: budgetTotal,
      fatigue: 0,
      currentLat: lat,
      currentLng: lng,
      moodProxy: 0.8,
      capturedAt: now.toISOString(),
      source: 'simulated',
    };
  }

  /**
   * @summary Tải toàn bộ danh sách địa điểm (Place) cho một thành phố kèm tags và giờ mở cửa.
   *
   * Thực hiện truy vấn theo 2 bước:
   * 1. Tìm tất cả địa điểm theo `address ILIKE '%city%'` HOẶC `place_id IN (mustInclude)`.
   *    Đảm bảo các địa điểm đang có trong slot luôn được đưa vào pool dù không ở đúng thành phố.
   * 2. Song song (`Promise.all`): Tải tags (`place_tag_map`) và giờ mở cửa (`place_opening_hour`)
   *    cho tất cả placeId vừa tìm được, sau đó ghép vào từng Place object.
   *
   * **Side Effects:** Thực hiện 1 truy vấn tuần tự (places), sau đó 2 truy vấn song song (tags, hours).
   *
   * @param city                {string}   Tên thành phố để tìm kiếm (ILIKE, case-insensitive).
   *   Ví dụ: `"Da Nang"`, `"Hoi An"`.
   * @param mustIncludePlaceIds {number[]} Danh sách placeId bắt buộc phải có trong kết quả,
   *   bất kể thuộc thành phố nào. Thường là placeId của các slot hiện tại trong trip.
   * @returns {Promise<Place[]>} Mảng Place với đầy đủ `tags` và `openingHours`.
   *   Trả về `[]` khi không tìm thấy địa điểm nào.
   * @throws {Error} Lỗi database (connection, syntax...) — được ném lên caller.
   *
   * @pre `city` là chuỗi không rỗng; `this.pool` đang hoạt động.
   * @post `Place.tags` và `Place.openingHours` không bao giờ `null` (có thể là `[]`).
   *
   * @example
   * ```typescript
   * const places = await this.loadPlaces('Da Nang', [101, 205]);
   * // → Tất cả địa điểm ở Đà Nẵng + place 101, 205 (dù không ở Đà Nẵng)
   * // Mỗi place có đầy đủ tags và openingHours
   * ```
   */
  private async loadPlaces(city: string, mustIncludePlaceIds: number[]): Promise<Place[]> {
    // Normalize to cover both "Da Nang" ↔ "Đà Nẵng", "Hoi An" ↔ "Hội An", etc.
    const CITY_ALIASES: Record<string, string[]> = {
      'da nang': ['da nang', 'đà nẵng', 'danang'],
      'đà nẵng': ['da nang', 'đà nẵng', 'danang'],
      'danang': ['da nang', 'đà nẵng', 'danang'],
      'hoi an': ['hoi an', 'hội an', 'hoian'],
      'hội an': ['hoi an', 'hội an', 'hoian'],
    };
    const key = city.toLowerCase().trim();
    const variants = CITY_ALIASES[key] ?? [city];
    const addressConditions = variants.map((_, i) => `address ILIKE $${i + 1}`).join(' OR ');
    const addressParams = variants.map(v => `%${v}%`);

    const placesRes = await this.pool.query<{
      place_id: string; name: string; lat: number; lng: number;
      avg_visit_duration_min: number; terrain_easiness: number | null;
      indoor_outdoor: string; min_price: number | null; max_price: number | null;
    }>(
      `SELECT place_id, name, lat, lng, avg_visit_duration_min,
              terrain_easiness, indoor_outdoor, min_price, max_price
         FROM place
        WHERE (${addressConditions}) OR place_id = ANY($${variants.length + 1}::bigint[])`,
      [...addressParams, mustIncludePlaceIds],
    );

    // Proximity fallback: if city filter found no extra places beyond mustInclude,
    // load the 60 nearest places by coordinates of the mustInclude places' centroid.
    const mustIncludeSet = new Set(mustIncludePlaceIds);
    const extraCount = placesRes.rows.filter(r => !mustIncludeSet.has(Number(r.place_id))).length;
    if (extraCount === 0 && mustIncludePlaceIds.length > 0) {
      const fallbackRes = await this.pool.query<{
        place_id: string; name: string; lat: number; lng: number;
        avg_visit_duration_min: number; terrain_easiness: number | null;
        indoor_outdoor: string; min_price: number | null; max_price: number | null;
      }>(
        `SELECT p.place_id, p.name, p.lat, p.lng, p.avg_visit_duration_min,
                p.terrain_easiness, p.indoor_outdoor, p.min_price, p.max_price
           FROM place p,
                (SELECT AVG(lat) AS clat, AVG(lng) AS clng
                   FROM place WHERE place_id = ANY($1::bigint[])) AS c
          ORDER BY CASE WHEN p.place_id = ANY($1::bigint[]) THEN 0 ELSE 1 END,
                   (p.lat - c.clat)^2 + (p.lng - c.clng)^2
          LIMIT 60`,
        [mustIncludePlaceIds],
      );
      placesRes.rows = fallbackRes.rows;
    }

    if (placesRes.rows.length === 0) return [];

    const placeIds = placesRes.rows.map((r) => Number(r.place_id));

    const [tagsRes, hoursRes] = await Promise.all([
      this.pool.query<{ place_id: string; tag_id: number }>(
        `SELECT place_id, tag_id FROM place_tag_map WHERE place_id = ANY($1::bigint[])`,
        [placeIds],
      ),
      this.pool.query<{
        place_id: string; day_of_week: number; open_time: string; close_time: string;
      }>(
        `SELECT place_id, day_of_week, open_time::text, close_time::text
           FROM place_opening_hour WHERE place_id = ANY($1::bigint[])`,
        [placeIds],
      ),
    ]);

    const tagsByPlace = new Map<number, { tagId: number }[]>();
    for (const row of tagsRes.rows) {
      const id = Number(row.place_id);
      if (!tagsByPlace.has(id)) tagsByPlace.set(id, []);
      tagsByPlace.get(id)!.push({ tagId: row.tag_id });
    }

    const hoursByPlace = new Map<number, { dayOfWeek: number; openTime: string; closeTime: string }[]>();
    for (const row of hoursRes.rows) {
      const id = Number(row.place_id);
      if (!hoursByPlace.has(id)) hoursByPlace.set(id, []);
      hoursByPlace.get(id)!.push({
        dayOfWeek: row.day_of_week,
        openTime: row.open_time,
        closeTime: row.close_time,
      });
    }

    return placesRes.rows.map((r) => {
      const id = Number(r.place_id);
      return {
        placeId: id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        avgVisitDurationMin: r.avg_visit_duration_min,
        terrainEasiness: r.terrain_easiness ?? undefined,
        indoorOutdoor: r.indoor_outdoor as Place['indoorOutdoor'],
        minPrice: r.min_price ?? undefined,
        estimatedCost: r.min_price ?? 0,
        tags: tagsByPlace.get(id) ?? [],
        openingHours: hoursByPlace.get(id) ?? [],
      };
    });
  }
}
