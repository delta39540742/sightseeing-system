import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const lat = 16.0520775;
  const lng = 108.2156357;
  console.log(`Checking places at: ${lat}, ${lng}`);

  const places = await prisma.place.findMany({
    where: {
      lat: {
        gte: lat - 0.0001,
        lte: lat + 0.0001
      },
      lng: {
        gte: lng - 0.0001,
        lte: lng + 0.0001
      }
    }
  });

  console.log('Found places:');
  places.forEach(p => {
    console.log(`- ${p.name} (ID: ${p.place_id})`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
