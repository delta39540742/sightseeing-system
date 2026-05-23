require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const turf = require('@turf/turf');

const rawUrl = process.env.DATABASE_URL ?? '';
const pool = new pg.Pool({ 
  connectionString: rawUrl.replace(/[?&]sslmode=\w+/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined 
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  console.log('Fetching Vietnam GeoJSON...');
  const res = await fetch('https://raw.githubusercontent.com/TungTh/tungth.github.io/master/data/vn-provinces.json');
  const geojson = await res.json();
  console.log(`Loaded ${geojson.features.length} provinces.`);

  // Clean up province names: "Tỉnh Khánh Hòa" -> "Khánh Hòa", "Thành phố Hồ Chí Minh" -> "Hồ Chí Minh"
  const getProvinceName = (ten) => {
    return ten.replace(/^Tỉnh\s+|^Thành phố\s+/i, '').trim();
  };

  console.log('Fetching places from DB...');
  const places = await prisma.place.findMany({
    select: { place_id: true, lat: true, lng: true },
    where: { lat: { not: null }, lng: { not: null }, province: null }
  });
  console.log(`Found ${places.length} places to process.`);

  let updatedCount = 0;
  
  for (const place of places) {
    if (!place.lat || !place.lng) continue;
    
    const pt = turf.point([place.lng, place.lat]);
    let foundProvince = null;

    for (const feature of geojson.features) {
      if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        if (turf.booleanPointInPolygon(pt, feature)) {
          foundProvince = getProvinceName(feature.properties.Ten);
          break;
        }
      }
    }

    if (foundProvince) {
      await prisma.place.update({
        where: { place_id: place.place_id },
        data: { province: foundProvince }
      });
      updatedCount++;
      if (updatedCount % 500 === 0) {
        console.log(`Processed ${updatedCount} places...`);
      }
    }
  }

  console.log(`Successfully updated province for ${updatedCount} places.`);
}

main()
  .catch(console.error)
  .finally(() => {
    prisma.$disconnect();
    pool.end();
  });
