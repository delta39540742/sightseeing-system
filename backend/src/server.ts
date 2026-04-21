import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import pg from 'pg';

import { placesPlugin } from './routes/places';
import { tripsPlugin } from './routes/trips';
import { internalEventsPlugin } from './routes/internalEvents';
import { authPlugin } from './routes/auth';
import tripRoutes from './api/plan/routes';

import { replanPlugin } from './api/replan/routes';
import {
  PlanLoader,
  StateEvolver,
  MutationOperators,
  ObjectiveScorer,
  BeamSearch,
  CausalTraceBuilder,
  ProposalStore,
} from './replanner/index';


// Fix BigInt JSON serialization globally
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const fastify = Fastify({ logger: true });
const port = parseInt(process.env.PORT || '3000', 10);

export { prisma } from './lib/prisma';

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });

async function start() {
  const evolver = new StateEvolver();
  const operators = new MutationOperators(evolver);
  const scorer = new ObjectiveScorer(evolver);
  const beamSearch = new BeamSearch(evolver, operators, scorer);
  const replanDeps = {
    pool,
    planLoader: new PlanLoader(pool),
    evolver,
    scorer,
    beamSearch,
    traceBuilder: new CausalTraceBuilder(),
    proposalStore: new ProposalStore(pool),
  };

  await fastify.register(cors);
  await fastify.register(placesPlugin, { prefix: '/api/places' });
  await fastify.register(tripsPlugin, { prefix: '/api/trips' });
  await fastify.register(internalEventsPlugin, { prefix: '/api/internal/events' });
  await fastify.register(authPlugin, { prefix: '/api/auth' });
  await fastify.register(replanPlugin, { prefix: '/api', deps: replanDeps });
  await fastify.register(tripRoutes, { prefix: '/api/plan' });

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

start();