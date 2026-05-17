import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString, ssl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.app_user.upsert({
    where: { firebase_uid: 'seed-dev-user' },
    update: {},
    create: {
      firebase_uid: 'seed-dev-user',
      email: 'dev@travelsystem.local',
      display_name: 'Dev User',
    },
  });
  console.log('Seed complete');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
