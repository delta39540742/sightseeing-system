import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Finding "Cầu Vàng" details...');
  const cauVang = await prisma.place.findFirst({
    where: { name: { contains: 'Cầu Vàng' } }
  });

  if (cauVang) {
    console.log('Cầu Vàng found:');
    console.log('ID:', cauVang.place_id.toString());
    console.log('Lat:', cauVang.lat);
    console.log('Lng:', cauVang.lng);
  } else {
    console.log('Cầu Vàng not found in DB');
  }

  console.log('\nUpdating "Pont main" (ID 82)...');
  
  // Coordinates from seed.ts or the found Cầu Vàng
  const targetLat = cauVang?.lat || 15.9956;
  const targetLng = cauVang?.lng || 108.0188;

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE place 
    SET 
      geom = ST_GeogFromText('SRID=4326;POINT(${targetLng} ${targetLat})'),
      lat = ${targetLat},
      lng = ${targetLng},
      address = 'Bà Nà Hills, Hòa Vang, Đà Nẵng',
      description = 'Cây cầu biểu tượng với hai bàn tay khổng lồ (Golden Bridge).',
      indoor_outdoor = 'outdoor'
    WHERE name = 'Pont main' OR place_id = 82
  `);

  console.log(`Updated ${updated} records.`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
