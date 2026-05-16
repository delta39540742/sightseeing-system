import 'dotenv/config';
import { pool } from '../lib/prisma';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isSlotWithinScope(slot: any, eventType: string, payload: any): boolean {
  if (eventType === 'rain_heavy' && slot.indoor_outdoor !== 'outdoor') return false;
  const scopeEnd = new Date(payload.started_at).getTime() + payload.duration_hours * 3_600_000;
  const slotStart = new Date(slot.planned_start).getTime();
  if (slotStart >= scopeEnd) return false;
  if (payload.anchor_lat != null && payload.anchor_lon != null) {
    const dist = haversineKm(payload.anchor_lat, payload.anchor_lon, slot.lat, slot.lng);
    if (dist > payload.radius_km) return false;
  }
  return true;
}

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  const incident = {
    type: 'traffic_jam',
    anchorLat: 16.047,
    anchorLon: 108.206,
    radiusKm: 5,
    durationHours: 48,
    started_at: new Date().toISOString()
  };

  console.log(`Checking impact for Trip: ${tripId}`);
  
  const res = await pool.query(`
    SELECT ts.slot_id, ts.slot_order, ts.status, p.name, p.indoor_outdoor, ts.planned_start, p.lat, p.lng
    FROM trip_slot ts
    JOIN place p ON p.place_id = ts.place_id
    WHERE ts.trip_id = $1
    ORDER BY ts.planned_start ASC
  `, [tripId]);

  const slots = res.rows;
  console.log(`Found ${slots.length} future planned slots.`);

  slots.forEach(s => {
    const dist = haversineKm(incident.anchorLat, incident.anchorLon, s.lat, s.lng);
    const scopeEnd = new Date(new Date(incident.started_at).getTime() + incident.durationHours * 3_600_000);
    const inTime = new Date(s.planned_start) < scopeEnd;
    const isOutdoor = s.indoor_outdoor === 'outdoor';
    const inRange = dist <= incident.radiusKm;
    console.log(`Slot: ${s.name} (${s.indoor_outdoor}) - Status: ${s.status}
      Start: ${s.planned_start}
      Coords: ${s.lat}, ${s.lng}
      Distance: ${dist.toFixed(2)} km (Radius: ${incident.radiusKm})
      In Time Scope: ${inTime} (Until: ${scopeEnd.toISOString()})
      In Range: ${inRange}`);
  });

  const affectedSlots = slots.filter(s => isSlotWithinScope(s, incident.type, {
      started_at: incident.started_at,
      duration_hours: incident.durationHours,
      anchor_lat: incident.anchorLat,
      anchor_lon: incident.anchorLon,
      radius_km: incident.radiusKm
  }));

  if (affectedSlots.length > 0) {
    console.log(`\nAFFECTED SLOTS:`);
    affectedSlots.forEach(s => {
      const dist = haversineKm(incident.anchorLat, incident.anchorLon, s.lat, s.lng);
      console.log(`- [${s.slot_id}] ${s.name} (${s.indoor_outdoor}) at ${s.planned_start}. Distance: ${dist.toFixed(2)} km`);
    });
    console.log(`\nRESULT: Trip IS affected.`);
  } else {
    console.log(`\nRESULT: Trip is NOT affected.`);
  }
  
  await pool.end();
}

main().catch(console.error);
