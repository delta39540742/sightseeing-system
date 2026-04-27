import axios from 'axios'

export interface RouteLeg {
  distance: number // meters
  duration: number // seconds
}

export interface OsrmRoute {
  distance: number
  duration: number
  geometry: {
    coordinates: [number, number][] // [lng, lat][]
    type: string
  }
  legs: RouteLeg[]
}

export const routingService = {
  /**
   * Fetch driving route from OSRM
   * @param coords Array of points {lat, lng}
   * @returns Route object with distance, duration, geometry and legs
   */
  async getRoute(coords: { lat: number; lng: number }[]): Promise<OsrmRoute | null> {
    if (coords.length < 2) return null
    
    // OSRM expects lng,lat
    const coordsString = coords.map((c) => `${c.lng},${c.lat}`).join(';')
    try {
      const res = await axios.get(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      )
      if (res.data.code === 'Ok' && res.data.routes.length > 0) {
        return res.data.routes[0]
      }
      return null
    } catch (e) {
      console.error('OSRM Routing error', e)
      return null
    }
  },
}
