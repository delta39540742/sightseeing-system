import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const rawUrl = process.env.DATABASE_URL!;
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString, ssl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const tripId = '6286745f-0b31-42f0-a7e8-5d1583518704';

  const trip = await prisma.trip.findUnique({
    where: { trip_id: tripId },
    include: {
      trip_slot: {
        include: {
          place: {
            include: {
              place_tag_map: { include: { place_tag: true } },
              place_opening_hour: true,
            },
          },
        },
        orderBy: [{ day_index: 'asc' }, { slot_order: 'asc' }],
      },
      trip_state_snapshot: {
        orderBy: { captured_at: 'desc' },
        take: 1,
      },
    },
  });

  const replacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  console.log(JSON.stringify(trip, replacer, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
