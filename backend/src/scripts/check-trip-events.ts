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
  
  const events = await prisma.trip_event.findMany({
    where: { trip_id: tripId },
    orderBy: { detected_at: 'asc' }
  });

  console.log(`Total events: ${events.length}`);
  events.forEach(e => {
    console.log(`- ID: ${e.event_id}, Type: ${e.event_type}, Detected: ${e.detected_at}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
