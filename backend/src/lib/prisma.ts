import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const rawUrl = process.env.DATABASE_URL ?? '';
const connectionString = rawUrl.replace(/[?&]sslmode=\w+/g, '');
const ssl = rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined;

// Singleton: trong dev (HMR/ts-node-dev reload), tránh tạo nhiều
// Pool/PrismaClient instance làm leak connection.
const globalForPrisma = globalThis as unknown as {
  pool?: pg.Pool;
  prisma?: PrismaClient;
};

export const pool = globalForPrisma.pool ?? new pg.Pool({ connectionString, ssl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(pool) });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pool = pool;
  globalForPrisma.prisma = prisma;
}
