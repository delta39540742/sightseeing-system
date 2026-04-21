import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { addFavorite, removeFavorite } from '../services/interaction.service';

export const favoriteRouter = Router();

favoriteRouter.use(requireAuth);

// ─── C1: POST /api/preferences/favorite ──────────────────────────────────────
favoriteRouter.post('/', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const { placeId, tripId } = req.body;

    if (!placeId || typeof placeId !== 'number') {
      res.status(400).json({ error: 'Bad Request', message: 'placeId (number) là bắt buộc' });
      return;
    }

    const result = await addFavorite(userId, placeId, tripId);
    res.status(201).json(result);
  } catch (err) {
    console.error('[POST /favorite]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── C2: DELETE /api/preferences/favorite/:placeId ───────────────────────────
favoriteRouter.delete('/:placeId', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const placeId = parseInt(req.params.placeId);

    if (isNaN(placeId)) {
      res.status(400).json({ error: 'Bad Request', message: 'placeId không hợp lệ' });
      return;
    }

    await removeFavorite(userId, placeId);
    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /favorite]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
