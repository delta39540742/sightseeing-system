import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { placesPlugin } from './routes/places';
import { tripsPlugin } from './routes/trips';
import { internalEventsPlugin } from './routes/internalEvents';
import { authPlugin } from './routes/auth';
import tripRoutes from './api/plan/routes';

dotenv.config();

// Fix BigInt JSON serialization globally
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const fastify = Fastify({ logger: true });
const port = parseInt(process.env.PORT || '3000', 10);

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

async function start() {
  await fastify.register(cors);
  await fastify.register(placesPlugin, { prefix: '/api/places' });
  await fastify.register(tripsPlugin, { prefix: '/api/trips' });
  await fastify.register(internalEventsPlugin, { prefix: '/api/internal/events' });
  await fastify.register(authPlugin, { prefix: '/api/auth' });

  fastify.get('/health', async () => {
    return { status: 'ok', message: 'TDTT Backend is running' };
  });

  try {
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

fastify.register(tripRoutes, { prefix: '/api/trips' });

start();
