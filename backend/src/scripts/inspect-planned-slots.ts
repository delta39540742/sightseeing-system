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
  console.log(`Checking trip: ${tripId}`);

  const slots = await prisma.trip_slot.findMany({
    where: { 
      trip_id: tripId,
      status: 'planned'
    },
    include: {
      place: true
    },
    orderBy: [
      { day_index: 'asc' },
      { slot_order: 'asc' }
    ]
  });

  console.log('Planned Slots:');
  slots.forEach(slot => {
    console.log(`- Day ${slot.day_index}, Slot ${slot.slot_order} (v${slot.version}): ${slot.place?.name} (${slot.place?.lat}, ${slot.place?.lng})`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
