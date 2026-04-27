import type { FastifyRequest, FastifyReply } from 'fastify';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * preHandler auth — Người 1 đã verify token ở API Gateway.
 * Request đến đây đã có header x-user-id chứa UUID của user.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = request.headers['x-user-id'] as string | undefined;

  if (!userId) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Missing x-user-id header' });
    return;
  }

  if (!uuidRegex.test(userId)) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Invalid user id format' });
    return;
  }
}
