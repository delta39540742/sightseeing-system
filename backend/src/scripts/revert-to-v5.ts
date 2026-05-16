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
  const firstProposalId = '8c61416f-ee38-4a5a-a5d4-736c7a6c42e2';

  console.log(`Reverting Trip ${tripId} to state before the FIRST proposal today (${firstProposalId})`);

  const proposal = await prisma.replan_proposal.findUnique({
    where: { proposal_id: firstProposalId }
  });

  if (!proposal) {
    console.log("First proposal not found.");
    return;
  }

  const oldSnapshot = proposal.old_plan_snapshot as any[];
  console.log(`Restoring ${oldSnapshot.length} slots (version ${oldSnapshot[0]?.version || 'unknown'})...`);

  // We use a transaction to ensure atomicity
  await prisma.$transaction(async (tx) => {
    // 1. Delete all non-completed slots
    await tx.trip_slot.deleteMany({
      where: { 
        trip_id: tripId,
        status: { not: 'completed' }
      }
    });

    // 2. Restore from snapshot
    for (const slot of oldSnapshot) {
      await tx.trip_slot.create({
        data: {
          slot_id: slot.slotId,
          trip_id: slot.tripId,
          day_index: slot.dayIndex,
          slot_order: slot.slotOrder,
          version: slot.version,
          place_id: BigInt(slot.placeId),
          planned_start: new Date(slot.plannedStart),
          planned_end: new Date(slot.plannedEnd),
          activity_type: slot.activityType,
          status: slot.status,
          estimated_cost: slot.estimatedCost,
          rationale: slot.rationale
        }
      });
    }

    // 3. Optional: Delete or mark all proposals created after this one as invalid?
    // The user wants to "go back", so we'll just leave the proposals but the slots are now old.
  });

  console.log("Restoration to v5 successful.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
