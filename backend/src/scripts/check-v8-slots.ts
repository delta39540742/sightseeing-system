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
  const slots = await prisma.trip_slot.findMany({
    where: { 
      trip_id: tripId,
      version: 8
    }
  });

  console.log(`v8 slots count: ${slots.length}`);
  slots.forEach(s => {
    console.log(`- Slot ${s.slot_order}, Status: ${s.status}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
