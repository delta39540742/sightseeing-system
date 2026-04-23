import type { FastifyInstance } from 'fastify';
import { parseNlu, NluUnavailableError } from '../services/nluService';

export async function nluPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.post('/parse', async (request, reply) => {
    const body = request.body as { prompt?: unknown };
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return reply.status(400).send({ error: 'PROMPT_IS_EMPTY' });
    }

    try {
      const result = await parseNlu(prompt.trim());
      return result;
    } catch (err) {
      if (err instanceof NluUnavailableError) {
        return reply.status(503).send({ error: 'AI đang bảo trì, hãy điền tay' });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'INTERNAL_SERVER_ERROR' });
    }
  });
}
