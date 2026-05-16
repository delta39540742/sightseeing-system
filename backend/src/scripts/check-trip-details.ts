import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const tripId = 'd2782105-7ccb-40f1-b69d-64ad83a1af5b';
  const trip = await prisma.trip.findUnique({
    where: { trip_id: tripId }
  });

  if (trip) {
    console.log('Trip Created At:', trip.created_at);
    console.log('Trip Status:', trip.status);
    console.log('Parsed Slots:', trip.parsed_slots);
  } else {
    console.log('Trip not found');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
