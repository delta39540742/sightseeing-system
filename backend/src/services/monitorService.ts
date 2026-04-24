import axios from 'axios'

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

  private analyzeImpact(type: string, reason: string, severity: number) {
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

    this.lastAlert = {
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
      if (rain >= 5) this.analyzeImpact('rain_heavy', `Mưa lớn thực tế: ${rain}mm/h`, 0.8)
    } catch {
      // weather API unreachable — skip silently
    }
  }

  private collectTrafficData() {
    if (!this.currentState) return
    const now = new Date().getHours()
    const delay = now - this.currentState.plannedArrivalTime
    const realDelay = delay > -12 && delay < 12 ? delay : 0
    if (realDelay > 0.5) {
      this.analyzeImpact('traffic_jam', `Trễ lịch trình: ${(realDelay * 60).toFixed(0)} phút`, 0.7)
    }
  }

  private collectClosingData() {
    if (!this.currentTrip || !this.currentState) return
    const now = new Date().getHours()
    const nextSlot = this.currentTrip.slots[this.currentState.currentSlotIndex]
    if (nextSlot && now < nextSlot.closeTime && now + 1 >= nextSlot.closeTime) {
      this.analyzeImpact('closing_soon', `${nextSlot.name} sắp đóng cửa!`, 0.9)
    }
  }

  runMonitoring() {
    if (!this.currentTrip) return
    this.collectWeatherData()
    this.collectTrafficData()
    this.collectClosingData()
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
