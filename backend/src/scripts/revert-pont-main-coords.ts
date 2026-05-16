import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const oldLat = 16.0520775;
  const oldLng = 108.2156357;

  console.log(`Reverting "Pont main" coordinates to city center (${oldLat}, ${oldLng})...`);
  
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE place 
    SET 
      geom = ST_GeogFromText('SRID=4326;POINT(${oldLng} ${oldLat})'),
      address = 'Da Nang',
      description = null,
      indoor_outdoor = 'indoor'
    WHERE name = 'Pont main' OR place_id = 82
  `);

  console.log(`Updated ${updated} records.`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
