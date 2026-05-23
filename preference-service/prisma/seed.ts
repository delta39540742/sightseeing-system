import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ARMS = [
  { armId: 1, name: 'balanced',    wInterest: 1.0, wPace: 1.0, wDistance: 1.0, wBudget: 1.0, wWeather: 1.0, wRisk: 1.0 },
  { armId: 2, name: 'interest',    wInterest: 2.0, wPace: 0.7, wDistance: 0.8, wBudget: 0.7, wWeather: 0.8, wRisk: 0.8 },
  { armId: 3, name: 'pace',        wInterest: 0.7, wPace: 2.0, wDistance: 1.2, wBudget: 0.8, wWeather: 0.8, wRisk: 0.8 },
  { armId: 4, name: 'budget',      wInterest: 0.7, wPace: 0.8, wDistance: 1.2, wBudget: 2.0, wWeather: 0.7, wRisk: 0.8 },
  { armId: 5, name: 'exploration', wInterest: 1.2, wPace: 0.8, wDistance: 2.0, wBudget: 0.7, wWeather: 0.8, wRisk: 0.7 },
  { armId: 6, name: 'safe',        wInterest: 0.8, wPace: 1.0, wDistance: 0.8, wBudget: 0.8, wWeather: 2.0, wRisk: 2.0 },
];

async function main() {
  for (const arm of ARMS) {
    await prisma.banditArm.upsert({
      where: { armId: arm.armId },
      create: arm,
      update: arm,
    });
    console.log(`  ✓ arm[${arm.armId}] ${arm.name}`);
  }
  console.log('Seeded bandit_arm: 6 arms');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
