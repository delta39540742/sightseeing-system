import type { FastifyInstance } from 'fastify';
import { prisma } from '../server';
import { verifyToken } from '../middlewares/authMiddleware';

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  fastify.post('/login', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const { uid, email, name } = request.user!;

      let user = await prisma.app_user.findUnique({
        where: { firebase_uid: uid },
      });

      if (!user) {
        user = await prisma.app_user.create({
          data: {
            firebase_uid: uid,
            email: email || `${uid}@unknown.com`,
            display_name: name || 'Người dùng mới',
          },
        });
        console.log(`[Auth] Created new DB user for UID: ${uid}`);
      } else {
        console.log(`[Auth] Existing user logged in UID: ${uid}`);
      }

      return reply.status(200).send({
        success: true,
        message: 'Login successful',
        data: user,
      });
    } catch (error) {
      console.error('Error during login mapping:', error);
      return reply.status(500).send({ success: false, error: 'Internal server error while linking account' });
    }
  });
}
