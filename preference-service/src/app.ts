import Fastify from 'fastify';
import cors from '@fastify/cors';
import cron from 'node-cron';

import { surveyPlugin } from './routes/survey.routes';
import { preferencesPlugin } from './routes/preferences.routes';
import { favoritePlugin } from './routes/favorite.routes';
import { internalPlugin } from './routes/internal.routes';
import { runSimilarityJob } from './jobs/similarity.job';

// Import để đăng ký event listeners (D1-D5)
import './lib/eventBus';

const isDev = process.env.NODE_ENV !== 'production';

const app = Fastify({
  logger: isDev
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
    : true,
});

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async () => ({ status: 'ok', service: 'preference' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.register(surveyPlugin,     { prefix: '/api/preferences/survey' });
app.register(preferencesPlugin, { prefix: '/api/preferences' });
app.register(favoritePlugin,   { prefix: '/api/preferences/favorite' });
app.register(internalPlugin,   { prefix: '/api/preferences/internal' });

// ─── E1: Nightly cron — 03:00 mỗi đêm ───────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  app.log.info('[Cron] Running nightly similarity job...');
  try {
    await runSimilarityJob();
  } catch (err) {
    app.log.error(err, '[Cron] Similarity job failed');
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

export default app;
