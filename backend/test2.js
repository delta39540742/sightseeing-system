const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.place.count({
    where: { address: { contains: 'Khánh Hòa', mode: 'insensitive' } }
  });
  console.log('Places with address containing Khánh Hòa:', count);

  const sample = await prisma.place.findMany({
    where: { address: { contains: 'Khánh Hòa', mode: 'insensitive' } },
    take: 5,
    select: { name: true, address: true }
  });
  console.log('Sample places:', sample);
}
main().finally(() => prisma.$disconnect());
