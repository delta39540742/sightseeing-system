import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getSurveyStatus, createSurvey, updateSurvey } from '../services/survey.service';

export const surveyRouter = Router();

// Tất cả routes đều cần auth
surveyRouter.use(requireAuth);

// ─── A1: GET /api/preferences/survey/status ───────────────────────────────────
surveyRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const result = await getSurveyStatus(userId);
    res.json(result);
  } catch (err) {
    console.error('[GET /survey/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── A2: POST /api/preferences/survey ────────────────────────────────────────
surveyRouter.post('/', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const payload = req.body;

    // Validate required fields
    const required = [
      'primaryPurpose', 'preferredTagIds', 'pace',
      'dailyScheduleType', 'foodPreferences',
      'budgetPerDayMin', 'budgetPerDayMax',
      'groupType', 'mobilityRestrictions',
    ];
    const missing = required.filter((f) => payload[f] === undefined);
    if (missing.length > 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Thiếu fields: ${missing.join(', ')}`,
      });
      return;
    }

    await createSurvey(userId, payload);
    res.status(201).json({ message: 'Survey saved successfully' });
  } catch (err: any) {
    if (err.message?.includes('tối đa') || err.message?.includes('phải')) {
      res.status(400).json({ error: 'Bad Request', message: err.message });
      return;
    }
    console.error('[POST /survey]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── A3: PATCH /api/preferences/survey ───────────────────────────────────────
surveyRouter.patch('/', async (req: Request, res: Response) => {
  try {
    const userId = res.locals.userId as string;
    const payload = req.body;

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'Body không được rỗng' });
      return;
    }

    await updateSurvey(userId, payload);
    res.json({ message: 'Survey updated successfully' });
  } catch (err: any) {
    if (err.message?.includes('chưa làm survey')) {
      res.status(404).json({ error: 'Not Found', message: err.message });
      return;
    }
    if (err.message?.includes('tối đa') || err.message?.includes('phải')) {
      res.status(400).json({ error: 'Bad Request', message: err.message });
      return;
    }
    console.error('[PATCH /survey]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
