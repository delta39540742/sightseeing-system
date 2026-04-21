import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getWeights } from '../services/weights.service';
import { getSimilarUsers } from '../services/interaction.service';

export const preferencesRouter = Router();

preferencesRouter.use(requireAuth);

// ─── B1: GET /api/preferences/weights ────────────────────────────────────────
preferencesRouter.get('/weights', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    // ?context=plan | replan (logged nhưng logic giống nhau ở MVP)
    const context = (req.query.context as string) ?? 'plan';

    const result = await getWeights(userId);
    res.json({ ...result, context });
  } catch (err) {
    console.error('[GET /weights]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── B2: GET /api/preferences/similar-users ──────────────────────────────────
preferencesRouter.get('/similar-users', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const result = await getSimilarUsers(userId, limit);
    res.json(result);
  } catch (err) {
    console.error('[GET /similar-users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
