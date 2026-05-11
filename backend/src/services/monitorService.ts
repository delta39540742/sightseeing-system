import axios from 'axios'
import { pool } from '../lib/prisma'

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const RAIN_SCOPE_HOURS = 3;
const RAIN_RADIUS_KM = 4;
const TRAFFIC_SCOPE_HOURS = 4;
const TRAFFIC_RADIUS_KM = 4;

interface IncidentPayload {
  reason: string;
  started_at: string;
  duration_hours: number;
  radius_km: number;
  anchor_lat: number | null;
  anchor_lon: number | null;
}

function isEventExpired(payload: Partial<IncidentPayload> & { timestamp?: string }): boolean {
  // Support old payload format where 'timestamp' was used instead of 'started_at'
  const startedAt = payload.started_at ?? payload.timestamp;
  if (!startedAt) return false;
  const durationHours = payload.duration_hours ?? RAIN_SCOPE_HOURS;
  const expiresAt = new Date(startedAt).getTime() + durationHours * 3_600_000;
  return Date.now() > expiresAt;
}

function isSlotWithinScope(
  slot: { planned_start: string; indoor_outdoor: string; lat: number; lng: number },
  eventType: string,
  payload: IncidentPayload,
): boolean {
  if (eventType === 'rain_heavy' && slot.indoor_outdoor !== 'outdoor') return false;
  const scopeEnd = new Date(payload.started_at).getTime() + payload.duration_hours * 3_600_000;
  if (new Date(slot.planned_start).getTime() >= scopeEnd) return false;
  if (payload.anchor_lat != null && payload.anchor_lon != null) {
    if (haversineKm(payload.anchor_lat, payload.anchor_lon, slot.lat, slot.lng) > payload.radius_km) return false;
  }
  return true;
}

export interface TripSlot {
  id: string
  name: string
  type: 'outdoor' | 'indoor'
  closeTime: number
}

export interface TripData {
  tripId: string
  slots: TripSlot[]
}

export interface TripState {
  currentSlotIndex: number
  plannedArrivalTime: number
}

export interface MonitorAlert {
  eventId?: string
  type: string
  reason: string
  severity: number
  affectedSlotIds: string[]
  timestamp: string
  expiresAt?: string
}

export class MonitorService {
  private lat = 16.047079
  private lon = 108.206230
  private currentTrip: TripData | null = null
  private currentState: TripState | null = null
  private lastAlert: MonitorAlert | null = null
  private forcedRainMmPerH: number | null = null

  setForcedRain(mmPerH: number | null) {
    this.forcedRainMmPerH = mmPerH
  }

  sync(tripData: TripData, state: TripState, location?: { lat: number; lon: number }) {
    this.currentTrip = tripData
    this.currentState = state
    if (location) {
      this.lat = location.lat
      this.lon = location.lon
    }
    this.runMonitoring()
  }

  getLastAlert(): MonitorAlert | null {
    return this.lastAlert
  }

  private async analyzeImpact(type: string, reason: string, severity: number) {
    if (!this.currentTrip || !this.currentState) return
    const futureSlots = this.currentTrip.slots.slice(this.currentState.currentSlotIndex)
    let affectedIds: string[] = []

    switch (type) {
      case 'rain_heavy':
        affectedIds = futureSlots.filter(s => s.type === 'outdoor').map(s => s.id)
        break
      case 'traffic_jam':
        affectedIds = futureSlots.map(s => s.id)
        break
      case 'closing_soon':
        if (futureSlots.length > 0) affectedIds = [futureSlots[0].id]
        break
      case 'user_tired':
        affectedIds = futureSlots.slice(0, 2).map(s => s.id)
        break
    }

    // Persist to trip_event table
    const isRainType = type === 'rain_heavy';
    const legacyPayload: IncidentPayload = {
      reason,
      started_at: new Date().toISOString(),
      duration_hours: isRainType ? RAIN_SCOPE_HOURS : TRAFFIC_SCOPE_HOURS,
      radius_km: isRainType ? RAIN_RADIUS_KM : TRAFFIC_RADIUS_KM,
      anchor_lat: this.lat,
      anchor_lon: this.lon,
    };
    let eventId: string | undefined = undefined
    try {
      const res = await pool.query(
        `INSERT INTO trip_event (trip_id, event_type, severity, source, payload, affected_slot_ids, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')
         RETURNING event_id`,
        [
          this.currentTrip.tripId,
          type,
          severity,
          'monitor_service',
          JSON.stringify(legacyPayload),
          affectedIds,
        ]
      )
      eventId = res.rows[0]?.event_id
    } catch (err) {
      console.error('[MonitorService] Failed to persist trip_event:', err)
    }

    const expiresAt = new Date(
      new Date(legacyPayload.started_at).getTime() + legacyPayload.duration_hours * 3_600_000
    ).toISOString()

    this.lastAlert = {
      eventId,
      type,
      reason,
      severity: parseFloat(severity.toFixed(2)),
      affectedSlotIds: affectedIds,
      timestamp: new Date().toLocaleString('vi-VN'),
      expiresAt,
    }
  }

  private async collectTrafficData() {
    if (!this.currentState || !this.currentTrip) return
    const now = new Date().getHours()
    const delay = now - this.currentState.plannedArrivalTime
    // Cap at 3h: a cross-day comparison (e.g. 17:00 vs tomorrow's 08:00) produces ~9h delay
    // which is not a real traffic jam — ignore it.
    if (delay > 0.5 && delay <= 3) {
      await this.createEventIfAbsent(
        this.currentTrip.tripId,
        'traffic_jam',
        `Trễ lịch trình: ${(delay * 60).toFixed(0)} phút`,
        0.7,
        this.lat,
        this.lon,
      )
    }
  }

  private async collectClosingData() {
    if (!this.currentTrip || !this.currentState) return
    const now = new Date().getHours()
    const nextSlot = this.currentTrip.slots[this.currentState.currentSlotIndex]
    if (nextSlot && now < nextSlot.closeTime && now + 1 >= nextSlot.closeTime) {
      await this.analyzeImpact('closing_soon', `${nextSlot.name} sắp đóng cửa!`, 0.9)
    }
  }

  // ---------------------------------------------------------------------------
  // DB-based scan: weather check for ALL active trips
  // ---------------------------------------------------------------------------

  private async fetchRainAtLocation(lat: number, lon: number): Promise<number> {
    if (this.forcedRainMmPerH !== null) return this.forcedRainMmPerH
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (!apiKey) return 0
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`
      const res = await axios.get(url)
      return (res.data.rain?.['1h'] as number) ?? 0
    } catch {
      return 0
    }
  }

  private async createEventIfAbsent(
    tripId: string,
    type: string,
    reason: string,
    severity: number,
    anchorLat: number,
    anchorLon: number,
    opts?: { radiusKm?: number; durationHours?: number },
  ): Promise<void> {
    const slotsRes = await pool.query<{ slot_id: string; indoor_outdoor: string; planned_start: string; lat: number; lng: number }>(
      `SELECT ts.slot_id, p.indoor_outdoor, ts.planned_start, p.lat, p.lng
         FROM trip_slot ts
         JOIN place p ON p.place_id = ts.place_id
        WHERE ts.trip_id = $1 AND ts.status = 'planned' AND ts.planned_start > NOW()`,
      [tripId],
    )

    const isRain = type === 'rain_heavy';
    const radiusKm = opts?.radiusKm ?? (isRain ? RAIN_RADIUS_KM : TRAFFIC_RADIUS_KM);
    const durationHours = opts?.durationHours ?? (isRain ? RAIN_SCOPE_HOURS : TRAFFIC_SCOPE_HOURS);

    const payload: IncidentPayload = {
      reason,
      started_at: new Date().toISOString(),
      duration_hours: durationHours,
      radius_km: radiusKm,
      anchor_lat: anchorLat,
      anchor_lon: anchorLon,
    };

    const affectedIds = slotsRes.rows
      .filter(s => isSlotWithinScope(s, type, payload))
      .map(s => s.slot_id);

    if (affectedIds.length === 0) {
      console.log(`[MonitorService] No affected slots for ${type} event on trip ${tripId} — skipping`)
      return
    }

    try {
      // Single atomic INSERT ... WHERE NOT EXISTS — avoids SELECT+INSERT race condition.
      // Also blocks re-creation within 6h of a recently dismissed/resolved event to prevent flooding.
      const res = await pool.query(
        `INSERT INTO trip_event (trip_id, event_type, severity, source, payload, affected_slot_ids, status)
         SELECT $1, $2, $3, 'monitor_service', $4, $5, 'open'
         WHERE NOT EXISTS (
           SELECT 1 FROM trip_event
           WHERE trip_id = $1 AND event_type = $2
             AND (
               status = 'open'
               OR (status IN ('dismissed', 'resolved_by_replan') AND detected_at > NOW() - INTERVAL '6 hours')
             )
         )`,
        [tripId, type, severity, JSON.stringify(payload), affectedIds],
      )
      if (res.rowCount && res.rowCount > 0) {
        console.log(`[MonitorService] Created ${type} event for trip ${tripId} — ${affectedIds.length} affected slots`)
      }
    } catch (err) {
      console.error('[MonitorService] Failed to create trip_event:', err)
    }
  }

  // ---------------------------------------------------------------------------
  // Event-centric broadcast: fire event → find affected trips → notify each
  // ---------------------------------------------------------------------------

  /**
   * Returns IDs of all active trips that have at least one planned slot
   * falling within the event's spatial + temporal scope.
   *
   * TODO: Currently a full DB scan (O(trips × slots)). Future improvement:
   *   - Subscribe to real-time event streams from external systems
   *     (e.g. ride-hailing platforms reporting road conditions,
   *     municipal weather APIs, venue management systems).
   *   - Replace polling with a spatial index query (PostGIS ST_DWithin)
   *     to find affected trips in one round-trip instead of N.
   */
  private async findAffectedTripIds(
    type: string,
    anchorLat: number,
    anchorLon: number,
    opts: { radiusKm: number; durationHours: number },
  ): Promise<string[]> {
    const probe: IncidentPayload = {
      reason: '',
      started_at: new Date().toISOString(),
      duration_hours: opts.durationHours,
      radius_km: opts.radiusKm,
      anchor_lat: anchorLat,
      anchor_lon: anchorLon,
    }

    let tripIds: string[]
    try {
      const res = await pool.query<{ trip_id: string }>(
        `SELECT trip_id FROM trip WHERE status IN ('active', 'confirmed')`,
      )
      tripIds = res.rows.map(r => r.trip_id)
    } catch (err) {
      console.error('[MonitorService] findAffectedTripIds: failed to load trips', err)
      return []
    }

    const affected: string[] = []
    for (const tripId of tripIds) {
      try {
        const slotsRes = await pool.query<{
          slot_id: string; indoor_outdoor: string; planned_start: string; lat: number; lng: number
        }>(
          `SELECT ts.slot_id, p.indoor_outdoor, ts.planned_start, p.lat, p.lng
             FROM trip_slot ts
             JOIN place p ON p.place_id = ts.place_id
            WHERE ts.trip_id = $1 AND ts.status = 'planned' AND ts.planned_start > NOW()`,
          [tripId],
        )
        if (slotsRes.rows.some(s => isSlotWithinScope(s, type, probe))) {
          affected.push(tripId)
        }
      } catch { /* skip this trip on error */ }
    }

    return affected
  }

  /**
   * Broadcast an incident event to all active trips whose planned slots
   * fall within the given spatial + temporal scope.
   * Returns the number of trips notified.
   */
  async broadcastEvent(
    type: string,
    reason: string,
    severity: number,
    anchorLat: number,
    anchorLon: number,
    opts?: { radiusKm?: number; durationHours?: number },
  ): Promise<{ affectedTripCount: number; expiresAt: string }> {
    const isRain = type === 'rain_heavy'
    const radiusKm = opts?.radiusKm ?? (isRain ? RAIN_RADIUS_KM : TRAFFIC_RADIUS_KM)
    const durationHours = opts?.durationHours ?? (isRain ? RAIN_SCOPE_HOURS : TRAFFIC_SCOPE_HOURS)

    const tripIds = await this.findAffectedTripIds(type, anchorLat, anchorLon, { radiusKm, durationHours })

    for (const tripId of tripIds) {
      await this.createEventIfAbsent(tripId, type, reason, severity, anchorLat, anchorLon, { radiusKm, durationHours })
    }

    console.log(`[MonitorService] broadcastEvent ${type} → ${tripIds.length} trips notified`)

    return {
      affectedTripCount: tripIds.length,
      expiresAt: new Date(Date.now() + durationHours * 3_600_000).toISOString(),
    }
  }

  private async scanAllActiveTrips(): Promise<void> {
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (!apiKey) return

    let trips: Array<{ trip_id: string }>
    try {
      const res = await pool.query<{ trip_id: string }>(
        `SELECT trip_id FROM trip WHERE status IN ('active', 'confirmed')`,
      )
      trips = res.rows
    } catch (err) {
      console.error('[MonitorService] scanAllActiveTrips: failed to load trips', err)
      return
    }

    for (const { trip_id: tripId } of trips) {
      // Prefer actual GPS from latest snapshot; fall back to Da Nang default
      let lat = this.lat
      let lon = this.lon
      try {
        const locRes = await pool.query<{ lat: number; lon: number }>(
          `SELECT ST_Y(current_geom::geometry) AS lat, ST_X(current_geom::geometry) AS lon
             FROM trip_state_snapshot
            WHERE trip_id = $1 AND current_geom IS NOT NULL
            ORDER BY captured_at DESC LIMIT 1`,
          [tripId],
        )
        if (locRes.rows[0]) {
          lat = locRes.rows[0].lat
          lon = locRes.rows[0].lon
        }
      } catch { /* use defaults */ }

      const rain = await this.fetchRainAtLocation(lat, lon)
      if (rain >= 5) {
        await this.createEventIfAbsent(tripId, 'rain_heavy', `Mưa lớn: ${rain}mm/h`, 0.8, lat, lon)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cron entry point
  // ---------------------------------------------------------------------------

  async runMonitoring() {
    // Scan ALL active trips from DB (weather)
    await this.scanAllActiveTrips()

    // Legacy: in-memory traffic & closing checks for the trip synced via /sync-trip
    if (this.currentTrip) {
      await this.collectTrafficData()
      await this.collectClosingData()
    }
  }

  async getLatestOpenEvent(tripId: string): Promise<MonitorAlert | null> {
    try {
      const res = await pool.query(
        `SELECT event_id, event_type, severity, payload, affected_slot_ids
           FROM trip_event
          WHERE trip_id = $1 AND status = 'open'
          ORDER BY detected_at DESC
          LIMIT 1`,
        [tripId],
      )
      const row = res.rows[0]
      if (!row) return null

      const p: Partial<IncidentPayload> & { timestamp?: string } = typeof row.payload === 'string'
        ? JSON.parse(row.payload)
        : (row.payload ?? {})

      if (isEventExpired(p)) {
        await pool.query(`UPDATE trip_event SET status = 'dismissed' WHERE event_id = $1`, [row.event_id])
        return null
      }

      // Support old payload format: 'timestamp' field instead of 'started_at'
      const startedAt = p.started_at ?? p.timestamp;
      const durationHours = p.duration_hours ?? RAIN_SCOPE_HOURS;
      const expiresAt = startedAt
        ? new Date(new Date(startedAt).getTime() + durationHours * 3_600_000).toISOString()
        : undefined

      return {
        eventId: row.event_id as string,
        type: row.event_type as string,
        reason: p.reason ?? '',
        severity: parseFloat(Number(row.severity).toFixed(2)),
        affectedSlotIds: (row.affected_slot_ids as string[]) ?? [],
        timestamp: new Date().toLocaleString('vi-VN'),
        expiresAt,
      }
    } catch (err) {
      console.error('[MonitorService] getLatestOpenEvent error:', err)
      return null
    }
  }

  // TODO (auto-detect, option 2): trigger user_tired automatically by comparing actual
  // dwell time (from trip_state_snapshot) against planned slot duration — if user spent
  // >150% of planned time at a slot, infer fatigue and call reportUserTired() server-side
  // without requiring user input. Needs a per-slot dwell tracker in runMonitoring().
  async reportUserTired(tripId: string): Promise<{ eventId?: string; affectedSlotIds: string[] }> {
    const slotsRes = await pool.query<{ slot_id: string; planned_start: string }>(
      `SELECT slot_id, planned_start FROM trip_slot
        WHERE trip_id = $1 AND status = 'planned' AND planned_end > NOW()
        ORDER BY planned_start ASC LIMIT 2`,
      [tripId],
    )
    const affectedSlotIds = slotsRes.rows.map(r => r.slot_id)
    if (affectedSlotIds.length === 0) return { affectedSlotIds: [] }

    // Cover until at least 2h after the last affected slot starts so the frontend
    // withinWindow check (isBefore(slotStart, expiresAt)) passes even when slots
    // are several hours away (e.g. reported at 03:00 for slots at 09:00).
    const lastSlotStart = slotsRes.rows.at(-1)!.planned_start
    const hoursUntilLastSlot = (new Date(lastSlotStart).getTime() - Date.now()) / 3_600_000
    const durationHours = Math.max(2, hoursUntilLastSlot + 2)

    const payload = {
      reason: 'Người dùng báo cáo mệt mỏi',
      started_at: new Date().toISOString(),
      duration_hours: durationHours,
      radius_km: 0,
      anchor_lat: null,
      anchor_lon: null,
    }

    let eventId: string | undefined
    try {
      const res = await pool.query(
        `INSERT INTO trip_event (trip_id, event_type, severity, source, payload, affected_slot_ids, status)
         SELECT $1, 'user_tired', 0.6, 'user_report', $2, $3, 'open'
         WHERE NOT EXISTS (
           SELECT 1 FROM trip_event
           WHERE trip_id = $1 AND event_type = 'user_tired'
             AND detected_at > NOW() - INTERVAL '2 hours'
         )
         RETURNING event_id`,
        [tripId, JSON.stringify(payload), affectedSlotIds],
      )
      eventId = res.rows[0]?.event_id
    } catch (err) {
      console.error('[MonitorService] reportUserTired failed:', err)
    }

    if (eventId) {
      try {
        await pool.query(
          `DELETE FROM replan_proposal WHERE trip_id = $1 AND status = 'pending'`,
          [tripId],
        )
      } catch { /* non-fatal */ }

      this.lastAlert = {
        eventId,
        type: 'user_tired',
        reason: payload.reason,
        severity: 0.6,
        affectedSlotIds,
        timestamp: new Date().toLocaleString('vi-VN'),
        expiresAt: new Date(Date.now() + durationHours * 3_600_000).toISOString(),
      }
    }

    return { eventId, affectedSlotIds }
  }

  async injectMockAlert(opts: {
    type: string;
    reason: string;
    severity: number;
    tripId?: string;
    affectedSlotIds?: string[];
    anchorLat?: number | null;
    anchorLon?: number | null;
    radiusKm?: number;
    durationHours?: number;
  }) {
    const {
      type,
      reason,
      severity,
      affectedSlotIds: explicitIds,
      anchorLat = null,
      anchorLon = null,
      radiusKm = type === 'rain_heavy' ? RAIN_RADIUS_KM : TRAFFIC_RADIUS_KM,
      durationHours = type === 'rain_heavy' ? RAIN_SCOPE_HOURS : TRAFFIC_SCOPE_HOURS,
    } = opts;

    const effectiveTripId = opts.tripId ?? this.currentTrip?.tripId;

    const mockPayload: IncidentPayload = {
      reason,
      started_at: new Date().toISOString(),
      duration_hours: durationHours,
      radius_km: radiusKm,
      anchor_lat: anchorLat,
      anchor_lon: anchorLon,
    };

    // Compute affected slots from DB when coords are known; otherwise use explicit list
    let affectedSlotIds: string[] = explicitIds ?? [];
    if (effectiveTripId && anchorLat != null && anchorLon != null) {
      try {
        const slotsRes = await pool.query<{
          slot_id: string;
          indoor_outdoor: string;
          planned_start: string;
          lat: number;
          lng: number;
        }>(
          `SELECT ts.slot_id, p.indoor_outdoor, ts.planned_start, p.lat, p.lng
             FROM trip_slot ts
             JOIN place p ON p.place_id = ts.place_id
            WHERE ts.trip_id = $1 AND ts.status = 'planned' AND ts.planned_start > NOW()`,
          [effectiveTripId],
        );
        affectedSlotIds = slotsRes.rows
          .filter(s => isSlotWithinScope(s, type, mockPayload))
          .map(s => s.slot_id);
      } catch (err) {
        console.error('[MonitorService] Failed to compute mock affected slots:', err);
        affectedSlotIds = explicitIds ?? [];
      }
    }

    let eventId: string | undefined;
    if (effectiveTripId) {
      try {
        const res = await pool.query(
          `INSERT INTO trip_event (trip_id, event_type, severity, source, payload, affected_slot_ids, status)
           VALUES ($1, $2, $3, 'mock', $4, $5, 'open')
           RETURNING event_id`,
          [effectiveTripId, type, severity, JSON.stringify(mockPayload), affectedSlotIds],
        );
        eventId = res.rows[0]?.event_id;
      } catch (err) {
        console.error('[MonitorService] Failed to persist mock trip_event:', err);
      }
    }

    if (effectiveTripId && eventId) {
      try {
        await pool.query(
          `DELETE FROM replan_proposal WHERE trip_id = $1 AND status = 'pending'`,
          [effectiveTripId],
        );
      } catch (err) {
        console.error('[MonitorService] Failed to clear pending proposals:', err);
      }
    }

    const expiresAt = new Date(
      new Date(mockPayload.started_at).getTime() + durationHours * 3_600_000
    ).toISOString();

    this.lastAlert = {
      eventId,
      type,
      reason,
      severity: parseFloat(severity.toFixed(2)),
      affectedSlotIds,
      timestamp: new Date().toLocaleString('vi-VN'),
      expiresAt,
    };
  }
}

export const monitorService = new MonitorService()
