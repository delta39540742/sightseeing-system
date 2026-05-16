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
  console.log(`Checking history for trip: ${tripId}`);

  const proposals = await prisma.replan_proposal.findMany({
    where: { trip_id: tripId },
    orderBy: { created_at: 'asc' }, // Get earliest first
    take: 10
  });

  console.log('Early Proposals:');
  proposals.forEach(p => {
    console.log(`- ID: ${p.proposal_id}, Status: ${p.status}, Created: ${p.created_at}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
