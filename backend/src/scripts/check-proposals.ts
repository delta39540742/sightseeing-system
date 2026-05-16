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
  console.log(`Checking proposals for trip: ${tripId}`);

  const proposals = await prisma.replan_proposal.findMany({
    where: { trip_id: tripId },
    orderBy: { created_at: 'desc' },
    take: 5
  });

  console.log('Recent Proposals:');
  proposals.forEach(p => {
    console.log(`- ID: ${p.proposal_id}, Status: ${p.status}, Created: ${p.created_at}`);
  });

  if (proposals.length > 0) {
    const latestAccepted = proposals.find(p => p.status === 'accepted');
    if (latestAccepted) {
      console.log('\nLatest Accepted Proposal Details:');
      console.log('Old Plan Snapshot (keys):', Object.keys(latestAccepted.old_plan_snapshot as object));
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
