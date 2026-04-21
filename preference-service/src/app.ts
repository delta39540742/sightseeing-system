import express from 'express';
import cron from 'node-cron';

import { surveyRouter } from './routes/survey.routes';
import { preferencesRouter } from './routes/preferences.routes';
import { favoriteRouter } from './routes/favorite.routes';
import { runSimilarityJob } from './jobs/similarity.job';

// Import để đăng ký event listeners (D1-D5)
import './lib/eventBus';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// Health check — Render/Railway ping endpoint này
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'preference' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/preferences/survey', surveyRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/preferences/favorite', favoriteRouter);

// ─── E1: Nightly cron — 03:00 mỗi đêm ───────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  console.log('[Cron] Running nightly similarity job...');
  try {
    await runSimilarityJob();
  } catch (err) {
    console.error('[Cron] Similarity job failed:', err);
  }
}, {
  timezone: 'Asia/Ho_Chi_Minh',
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`[Preference Service] Running on port ${PORT}`);
});

export default app;
