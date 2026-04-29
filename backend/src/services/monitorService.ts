import axios from 'axios'
import { pool } from '../lib/prisma'

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
}

export class MonitorService {
  private lat = 16.047079
  private lon = 108.206230
  private currentTrip: TripData | null = null
  private currentState: TripState | null = null
  private lastAlert: MonitorAlert | null = null

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
          JSON.stringify({ reason, timestamp: new Date().toISOString() }),
          affectedIds,
        ]
      )
      eventId = res.rows[0]?.event_id
    } catch (err) {
      console.error('[MonitorService] Failed to persist trip_event:', err)
    }

    this.lastAlert = {
      eventId,
      type,
      reason,
      severity: parseFloat(severity.toFixed(2)),
      affectedSlotIds: affectedIds,
      timestamp: new Date().toLocaleString('vi-VN'),
    }
  }

  private async collectWeatherData() {
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (!apiKey) return

    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${this.lat}&lon=${this.lon}&appid=${apiKey}&units=metric`
      const res = await axios.get(url)
      const rain: number = res.data.rain?.['1h'] ?? 0
      if (rain >= 5) await this.analyzeImpact('rain_heavy', `Mưa lớn thực tế: ${rain}mm/h`, 0.8)
    } catch {
      // weather API unreachable — skip silently
    }
  }

  private async collectTrafficData() {
    if (!this.currentState) return
    const now = new Date().getHours()
    const delay = now - this.currentState.plannedArrivalTime
    const realDelay = delay > -12 && delay < 12 ? delay : 0
    if (realDelay > 0.5) {
      await this.analyzeImpact('traffic_jam', `Trễ lịch trình: ${(realDelay * 60).toFixed(0)} phút`, 0.7)
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

  async runMonitoring() {
    if (!this.currentTrip) return
    await this.collectWeatherData()
    await this.collectTrafficData()
    await this.collectClosingData()
  }

  injectMockAlert(type: string, reason: string, severity: number, affectedSlotIds: string[]) {
    this.lastAlert = {
      type,
      reason,
      severity: parseFloat(severity.toFixed(2)),
      affectedSlotIds,
      timestamp: new Date().toLocaleString('vi-VN'),
    }
  }
}

export const monitorService = new MonitorService()
