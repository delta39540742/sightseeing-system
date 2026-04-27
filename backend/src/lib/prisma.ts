import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL!;

// Singleton: trong dev (HMR/ts-node-dev reload), tránh tạo nhiều
// Pool/PrismaClient instance làm leak connection.
const globalForPrisma = globalThis as unknown as {
  pool?: pg.Pool;
  prisma?: PrismaClient;
};

export const pool =
  globalForPrisma.pool ?? new pg.Pool({ connectionString });

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(pool) });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pool = pool;
  globalForPrisma.prisma = prisma;
}
