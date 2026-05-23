require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const rawUrl = process.env.DATABASE_URL ?? '';
const pool = new pg.Pool({ 
  connectionString: rawUrl.replace(/[?&]sslmode=\w+/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined 
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const sample = await prisma.place.findMany({
    where: { name: { contains: 'Nha Trang', mode: 'insensitive' } },
    take: 10,
    select: { name: true, address: true, lat: true, lng: true }
  });
  console.log('Sample places with Nha Trang:', sample);
}
main().finally(() => { prisma.$disconnect(); pool.end(); });
