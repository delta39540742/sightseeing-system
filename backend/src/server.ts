import 'dotenv/config';
import Fastify, {FastifyError} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { placesPlugin } from './routes/places';
import { tripsPlugin } from './routes/trips';
import { internalEventsPlugin } from './routes/internalEvents';
import { authPlugin } from './routes/auth';
import { nluPlugin } from './routes/nlu';
import { landmarkPlugin } from './routes/landmark';
import { notificationsPlugin } from './routes/notifications';
import tripRoutes from './api/plan/routes';

import { replanPlugin } from './api/replan/routes';
import { monitorPlugin } from './routes/monitor';
import { demoSimulatePlugin } from './api/demo/simulate';
import { demoHistoryPlugin } from './api/demo/history';
import {
  PlanLoader,
  StateEvolver,
  MutationOperators,
  ObjectiveScorer,
  BeamSearch,
  CausalTraceBuilder,
  ProposalStore,
} from './replanner/index';
import { pool } from './lib/prisma';
import { warmUpEmbedding } from './services/embeddingService';

// Fix BigInt JSON serialization globally
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const isDev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const fastify = Fastify({
  logger: isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,reqId,responseTime,req,res',
            messageFormat: '{msg}',
          },
        },
        level: 'info',
      }
    : true,
});

// Re-export prisma giữ nguyên để các route đang import từ '../server' không vỡ
// (sẽ chuyển dần sang import từ '../lib/prisma' cho rõ ràng).
export { prisma } from './lib/prisma';

// ANSI color helpers (chỉ dùng khi isDev)
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
};

function methodColor(method: string): string {
  if (!isDev) return method;
  const map: Record<string, string> = {
    GET: c.green, POST: c.cyan, PATCH: c.yellow, PUT: c.yellow, DELETE: c.red,
  };
  return `${map[method] ?? c.gray}${method.padEnd(6)}${c.reset}`;
}

function statusColor(code: number): string {
  if (!isDev) return String(code);
  if (code >= 500) return `${c.red}${c.bold}${code}${c.reset}`;
  if (code >= 400) return `${c.yellow}${code}${c.reset}`;
  if (code >= 200) return `${c.green}${code}${c.reset}`;
  return String(code);
}

async function start() {
  const evolver = new StateEvolver();
  const operators = new MutationOperators(evolver);
  const scorer = new ObjectiveScorer(evolver);
  const beamSearch = new BeamSearch(evolver, operators, scorer);
  // CausalTraceBuilder có state mutable (steps/tripId/startTime) — phải tạo
  // mới mỗi request để tránh race condition giữa các replan đồng thời.
  const replanDeps = {
    pool,
    planLoader: new PlanLoader(pool),
    evolver,
    scorer,
    beamSearch,
    traceBuilder: { create: () => new CausalTraceBuilder() },
    proposalStore: new ProposalStore(pool),
  };

  // Hook: log mỗi request vào
  fastify.addHook('onRequest', (req, _reply, done) => {
    (req as any)._startMs = Date.now();
    const time = new Date().toTimeString().slice(0, 8);
    if (isDev) {
      process.stdout.write(
        `${c.gray}[${time}]${c.reset} ${methodColor(req.method)} ${c.bold}${req.url}${c.reset}\n`
      );
    }
    done();
  });

  // Hook: log response với status + thời gian xử lý
  fastify.addHook('onSend', (req, reply, _payload, done) => {
    const ms = Date.now() - ((req as any)._startMs ?? Date.now());
    const time = new Date().toTimeString().slice(0, 8);
    if (isDev) {
      process.stdout.write(
        `${c.gray}[${time}]${c.reset} ${methodColor(req.method)} ${req.url} → ${statusColor(reply.statusCode)} ${c.gray}(${ms}ms)${c.reset}\n`
      );
    }
    done();
  });

  await fastify.register(cors);
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health',
  });
  await fastify.register(placesPlugin, { prefix: '/api/places' });
  await fastify.register(tripsPlugin, { prefix: '/api/trips' });
  await fastify.register(internalEventsPlugin, { prefix: '/api/internal/events' });
  await fastify.register(authPlugin, { prefix: '/api/auth' });
  await fastify.register(nluPlugin, { prefix: '/api/nlu' });
  await fastify.register(landmarkPlugin, { prefix: '/api/landmark' });
  await fastify.register(replanPlugin, { prefix: '/api', deps: replanDeps });
  await fastify.register(tripRoutes, { prefix: '/api/plan' });
  await fastify.register(monitorPlugin, { prefix: '/api/monitor' });
  await fastify.register(notificationsPlugin, { prefix: '/api/notifications' });
  await fastify.register(demoSimulatePlugin, { prefix: '/api/demo', pool });
  await fastify.register(demoHistoryPlugin, { prefix: '/api/demo', pool });

  fastify.get('/health', { logLevel: 'silent' }, async () => ({ status: 'ok', message: 'TDTT Backend is running' }));

  // Hook: log lỗi uncaught trong handler
  fastify.setErrorHandler<FastifyError>((error, req, reply) => {
    const time = new Date().toTimeString().slice(0, 8);
    console.error(
      `${c.red}[${time}] ERROR${c.reset} ${req.method} ${req.url}\n` +
      `  ${c.red}${error.message}${c.reset}\n` +
      (error.stack ? `  ${c.gray}${error.stack.split('\n').slice(1, 3).join('\n  ')}${c.reset}\n` : '')
    );
    reply.status(error.statusCode ?? 500).send({ error: error.message });
  });

  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    if (isDev) {
      console.log(
        `\n${c.bold}${c.cyan}▶  TDTT Backend${c.reset}  http://localhost:${port}\n` +
        `${c.gray}   /health  /api/trips  /api/plan/generate  ...${c.reset}\n`
      );
    }
    // Tải model embedding ở background để request đầu không bị lag ~30s.
    void warmUpEmbedding();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();