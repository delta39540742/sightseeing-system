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
    where: { trip_id: tripId },
    select: {
      version: true,
      status: true,
      day_index: true,
      slot_order: true
    },
    orderBy: { version: 'desc' }
  });

  const versionStats: Record<number, { count: number, statuses: Set<string> }> = {};
  slots.forEach(s => {
    if (!versionStats[s.version]) {
      versionStats[s.version] = { count: 0, statuses: new Set() };
    }
    versionStats[s.version].count++;
    versionStats[s.version].statuses.add(s.status);
  });

  console.log('Version stats:');
  Object.keys(versionStats).forEach(v => {
    console.log(`v${v}: ${versionStats[parseInt(v)].count} slots, Statuses: ${Array.from(versionStats[parseInt(v)].statuses).join(', ')}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
