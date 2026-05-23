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
  const ntCount = await prisma.place.count({
    where: { OR: [
      { name: { contains: 'Nha Trang', mode: 'insensitive' } },
      { address: { contains: 'Nha Trang', mode: 'insensitive' } }
    ]}
  });
  console.log('Places containing Nha Trang:', ntCount);
  
  if (ntCount > 0) {
    const ntSample = await prisma.place.findMany({
      where: { OR: [
        { name: { contains: 'Nha Trang', mode: 'insensitive' } },
        { address: { contains: 'Nha Trang', mode: 'insensitive' } }
      ]},
      take: 5,
      select: { name: true, address: true }
    });
    console.log('Sample places for Nha Trang:', ntSample);
  }
}
main().finally(() => { prisma.$disconnect(); pool.end(); });
