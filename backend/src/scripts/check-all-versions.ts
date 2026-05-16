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
  
  const counts = await prisma.$queryRawUnsafe(`
    SELECT version, count(*) 
    FROM trip_slot 
    WHERE trip_id = $1 
    GROUP BY version 
    ORDER BY version
  `, tripId);

  console.log('Slot counts by version:');
  console.log(counts);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
