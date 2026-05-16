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
  
  const snapshots = await prisma.trip_state_snapshot.findMany({
    where: { trip_id: tripId },
    orderBy: { captured_at: 'asc' }
  });

  console.log(`Total state snapshots: ${snapshots.length}`);
  snapshots.forEach(s => {
    console.log(`- ID: ${s.snapshot_id}, Captured: ${s.captured_at}, Source: ${s.source}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
