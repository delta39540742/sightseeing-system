import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { getSurveyStatus, getSurvey, createSurvey, updateSurvey } from '../services/survey.service';

export async function surveyPlugin(app: FastifyInstance): Promise<void> {
  // ─── A1: GET /status ──────────────────────────────────────────────────────
  app.get('/status', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const result = await getSurveyStatus(userId);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, '[GET /survey/status]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── A1b: GET / — full survey để FE pre-fill wizard ───────────────────────
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const survey = await getSurvey(userId);
      return reply.send({ survey });
    } catch (err) {
      request.log.error(err, '[GET /survey]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── A2: POST / ───────────────────────────────────────────────────────────
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const payload = request.body as any;

      const required = [
        'primaryPurpose', 'preferredTagIds', 'pace',
        'dailyScheduleType', 'foodPreferences',
        'budgetPerDayMin', 'budgetPerDayMax',
        'groupType', 'mobilityRestrictions',
      ];
      const missing = required.filter((f) => payload[f] === undefined);
      if (missing.length > 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Thiếu fields: ${missing.join(', ')}`,
        });
      }

      await createSurvey(userId, payload);
      return reply.status(201).send({ message: 'Survey saved successfully' });
    } catch (err: any) {
      if (err.message?.includes('tối đa') || err.message?.includes('phải') || err.message?.includes('trùng lặp')) {
        return reply.status(400).send({ error: 'Bad Request', message: err.message });
      }
      request.log.error(err, '[POST /survey]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── A3: PATCH / ──────────────────────────────────────────────────────────
  app.patch('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const userId = request.headers['x-user-id'] as string;
      const payload = request.body as any;

      if (!payload || Object.keys(payload).length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Body không được rỗng' });
      }

      await updateSurvey(userId, payload);
      return reply.send({ message: 'Survey updated successfully' });
    } catch (err: any) {
      if (err.message?.includes('chưa làm survey')) {
        return reply.status(404).send({ error: 'Not Found', message: err.message });
      }
      if (err.message?.includes('tối đa') || err.message?.includes('phải')) {
        return reply.status(400).send({ error: 'Bad Request', message: err.message });
      }
      request.log.error(err, '[PATCH /survey]');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
