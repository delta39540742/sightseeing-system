import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const name = 'Pont main';
  console.log(`Checking place: ${name}`);

  const place = await prisma.place.findFirst({
    where: { name: name }
  });

  if (place) {
    console.log('ID:', place.place_id);
    console.log('Name:', place.name);
    console.log('Description:', place.description);
    console.log('Address:', place.address);
    console.log('Lat:', place.lat);
    console.log('Lng:', place.lng);
  } else {
    console.log('Place not found');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
