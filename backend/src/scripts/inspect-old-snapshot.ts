import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const proposalId = '913dc00d-0a0f-4e68-b08c-52d8d0c74c81';
  const proposal = await prisma.replan_proposal.findUnique({
    where: { proposal_id: proposalId }
  });

  if (proposal) {
    console.log('Old Plan Snapshot:');
    console.log(JSON.stringify(proposal.old_plan_snapshot, null, 2));
  } else {
    console.log('Proposal not found');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
