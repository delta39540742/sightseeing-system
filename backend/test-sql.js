require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;

const pool = new pg.Pool({ connectionString, ssl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const addressCount = await prisma.place.count({
    where: { address: { contains: 'Khánh Hòa', mode: 'insensitive' } }
  });
  console.log('Places with address containing Khánh Hòa:', addressCount);
  if (addressCount > 0) {
    const sample = await prisma.place.findMany({
      where: { address: { contains: 'Khánh Hòa', mode: 'insensitive' } },
      take: 2,
      select: { name: true, address: true }
    });
    console.log('Sample places:', sample);
  } else {
    // maybe Khanh Hoa instead of Khánh Hòa?
    const addressCount2 = await prisma.place.count({
      where: { address: { contains: 'Khanh Hoa', mode: 'insensitive' } }
    });
    console.log('Places with address containing Khanh Hoa:', addressCount2);
  }

  // test raw query
  const q = 'Khánh Hòa';
  const rows = await prisma.$queryRaw`
    SELECT p.place_id, p.name, p.address
    FROM place p
    WHERE (
      unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR unaccent(lower(COALESCE(p.address, ''))) LIKE '%' || unaccent(lower(${q})) || '%'
      OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
    )
    LIMIT 5
  `;
  console.log('Raw query results:', rows);
}
main().catch(console.error).finally(() => { prisma.$disconnect(); pool.end(); });
