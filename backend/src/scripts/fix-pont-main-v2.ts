import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const targetLat = 15.9956;
  const targetLng = 108.0188;

  console.log(`Updating "Pont main" geom to (${targetLat}, ${targetLng})...`);
  
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE place 
    SET 
      geom = ST_GeogFromText('SRID=4326;POINT(${targetLng} ${targetLat})'),
      address = 'Bà Nà Hills, Hòa Vang, Đà Nẵng',
      description = 'Cây cầu biểu tượng với hai bàn tay khổng lồ (Golden Bridge - Cầu Vàng).',
      indoor_outdoor = 'outdoor'
    WHERE name = 'Pont main' OR place_id = 82
  `);

  console.log(`Updated ${updated} records.`);

  const check = await prisma.place.findFirst({
    where: { place_id: 82 }
  });

  console.log('Verification:');
  if (check) {
    console.log('Lat:', check.lat);
    console.log('Lng:', check.lng);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
