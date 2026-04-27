import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { verifyToken } from '../middlewares/authMiddleware';
import { auth } from '../config/firebase';

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  // upsert + idempotent: client có thể bắn nhiều request login đồng thời (useLoginActions + onAuthStateChanged)
  // → findUnique-then-create sẽ race trên user mới, gây P2002.
  fastify.post('/login', { preHandler: verifyToken }, async (request, reply) => {
    try {
      const { uid, email, name } = request.user!;
      const user = await prisma.app_user.upsert({
        where: { firebase_uid: uid },
        update: { last_login_at: new Date() },
        create: {
          firebase_uid: uid,
          email: email || `${uid}@unknown.com`,
          display_name: name || 'Người dùng mới',
        },
      });

      request.log.info({ uid }, '[Auth] login upsert ok');
      return reply.status(200).send({
        success: true,
        message: 'Login successful',
        data: user,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Error during login mapping');
      return reply.status(500).send({ success: false, error: 'Internal server error while linking account' });
    }
  });

  // DELETE /api/auth/account — Hard delete account
  // FK schema cascades trips/slots/preferences/proposals/similarities to app_user.user_id
  // DB delete first; Firebase second. If Firebase fails the next login re-creates a fresh app_user.
  fastify.delete('/account', { preHandler: verifyToken }, async (request, reply) => {
    const { uid } = request.user!;
    try {
      const dbUser = await prisma.app_user.findUnique({ where: { firebase_uid: uid } });
      if (dbUser) {
        await prisma.app_user.delete({ where: { user_id: dbUser.user_id } });
        request.log.info({ uid, user_id: dbUser.user_id }, '[Auth] deleted DB user (cascade)');
      }

      if (auth) {
        try {
          await auth.deleteUser(uid);
          request.log.info({ uid }, '[Auth] deleted Firebase user');
        } catch (fbErr) {
          // DB row đã đi — Firebase fail không chặn flow, log để xử lý sau.
          request.log.error({ err: fbErr, uid }, '[Auth] Firebase deleteUser failed (DB already cleared)');
        }
      }

      return reply.status(200).send({ success: true, message: 'Account deleted' });
    } catch (error) {
      request.log.error({ err: error, uid }, '[Auth] deleteAccount failed');
      return reply.status(500).send({ success: false, error: 'Internal server error while deleting account' });
    }
  });
}
