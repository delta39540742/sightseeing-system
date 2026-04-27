import type { Pool } from 'pg';
import type { TripSlot, TripState, Place, UserPreference, ObjectiveWeights } from '@app/types';
import type { BeamSearchContext } from './BeamSearch';

const DA_NANG_CENTER = { lat: 16.0544, lng: 108.2022 };
const DEFAULT_DAY_MINUTES = 12 * 60;
const DEFAULT_WEIGHTS: ObjectiveWeights = {
  wInterest: 1, wPace: 1, wDistance: 1, wBudget: 1, wWeather: 1, wRisk: 1,
};

export class PlanLoader {
  constructor(private readonly pool: Pool) {}

  async load(tripId: string): Promise<BeamSearchContext> {
    // 1. Load trip header
    const tripRes = await this.pool.query<{
      trip_id: string;
      user_id: string;
      destination_city: string;
      start_date: string;
      budget_total: number;
      hotel_place_id: string | null;
    }>(
      `SELECT trip_id, user_id, destination_city, start_date, budget_total, hotel_place_id
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
      }>(
        `SELECT up.preference_vector, up.pace, up.mobility_restrictions,
                COALESCE(uow.w_interest, 1.0) AS w_interest,
                COALESCE(uow.w_pace,     1.0) AS w_pace,
                COALESCE(uow.w_distance, 1.0) AS w_distance,
                COALESCE(uow.w_budget,   1.0) AS w_budget,
                COALESCE(uow.w_weather,  1.0) AS w_weather,
                COALESCE(uow.w_risk,     1.0) AS w_risk
           FROM user_preference up
           LEFT JOIN user_objective_weights uow ON uow.user_id = up.user_id
          WHERE up.user_id = $1`,
        [trip.user_id],
      ),
    ]);

    // 3. Map slots
    const remainingSlots: TripSlot[] = slotsRes.rows.map((r) => ({
      slotId:        r.slot_id,
      tripId:        r.trip_id,
      dayIndex:      r.day_index,
      slotOrder:     r.slot_order,
      version:       r.version,
      placeId:       Number(r.place_id),
      plannedStart:  r.planned_start,
      plannedEnd:    r.planned_end,
      actualStart:   r.actual_start,
      actualEnd:     r.actual_end,
      estimatedCost: r.estimated_cost,
      activityType:  r.activity_type as TripSlot['activityType'],
      rationale:     r.rationale,
      status:        r.status as TripSlot['status'],
    }));

    // 4. Build initial state (from snapshot or derive from trip)
    const snap = stateRes.rows[0];
    const initialState: TripState = snap
      ? {
          tripId,
          dayIndex:          snap.day_index,
          slotOrder:         snap.slot_order,
          timeRemainingMin:  snap.time_remaining_min,
          budgetRemaining:   snap.budget_remaining,
          fatigue:           snap.fatigue,
          currentLat:        snap.lat ?? DA_NANG_CENTER.lat,
          currentLng:        snap.lng ?? DA_NANG_CENTER.lng,
          moodProxy:         snap.mood_proxy,
          capturedAt:        snap.captured_at,
          source:            snap.source === 'actual' ? 'actual' : 'simulated',
        }
      : await this.buildDefaultState(tripId, trip.budget_total, trip.start_date, trip.hotel_place_id);

    // 5. Build user preference + weights
    const prefRow = prefRes.rows[0];
    const user: UserPreference = prefRow
      ? {
          preferenceVector:    prefRow.preference_vector,
          pace:                prefRow.pace,
          mobilityRestrictions: prefRow.mobility_restrictions ?? [],
        }
      : { preferenceVector: new Array(10).fill(0.1), pace: 0.5, mobilityRestrictions: [] };

    const weights: ObjectiveWeights = prefRow
      ? {
          wInterest: prefRow.w_interest,
          wPace:     prefRow.w_pace,
          wDistance: prefRow.w_distance,
          wBudget:   prefRow.w_budget,
          wWeather:  prefRow.w_weather,
          wRisk:     prefRow.w_risk,
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
      weatherBySlotId: {},
      defaultWeather:  { rainMmPerH: 0 },
      weatherForecast: [],
    };
  }

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
      preferenceVector:    row.preference_vector,
      pace:                row.pace,
      mobilityRestrictions: row.mobility_restrictions ?? [],
    };
  }

  // --------------------------------------------------------------------------

  private async buildDefaultState(
    tripId: string,
    budgetTotal: number,
    startDate: string,
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
    const now   = new Date();
    const dayIndex = Math.max(
      0,
      Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );

    return {
      tripId,
      dayIndex,
      slotOrder:        0,
      timeRemainingMin: DEFAULT_DAY_MINUTES,
      budgetRemaining:  budgetTotal,
      fatigue:          0,
      currentLat:       lat,
      currentLng:       lng,
      moodProxy:        0.8,
      capturedAt:       now.toISOString(),
      source:           'simulated',
    };
  }

  private async loadPlaces(city: string, mustIncludePlaceIds: number[]): Promise<Place[]> {
    const placesRes = await this.pool.query<{
      place_id: string; name: string; lat: number; lng: number;
      avg_visit_duration_min: number; terrain_easiness: number | null;
      indoor_outdoor: string; min_price: number | null; max_price: number | null;
    }>(
      `SELECT place_id, name, lat, lng, avg_visit_duration_min,
              terrain_easiness, indoor_outdoor, min_price, max_price
         FROM place
        WHERE address ILIKE $1 OR place_id = ANY($2::bigint[])`,
      [`%${city}%`, mustIncludePlaceIds],
    );

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
        openTime:  row.open_time,
        closeTime: row.close_time,
      });
    }

    return placesRes.rows.map((r) => {
      const id = Number(r.place_id);
      return {
        placeId:             id,
        name:                r.name,
        lat:                 r.lat,
        lng:                 r.lng,
        avgVisitDurationMin: r.avg_visit_duration_min,
        terrainEasiness:     r.terrain_easiness ?? undefined,
        indoorOutdoor:       r.indoor_outdoor as Place['indoorOutdoor'],
        minPrice:            r.min_price ?? undefined,
        estimatedCost:       r.min_price ?? 0,
        tags:                tagsByPlace.get(id) ?? [],
        openingHours:        hoursByPlace.get(id) ?? [],
      };
    });
  }
}
