import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../config/firebase';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      uid: string;
      email?: string;
      name?: string;
    };
  }
}

export const verifyToken = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (!auth) {
    request.log.error('Firebase Auth is not initialized');
    return reply.status(500).send({ success: false, error: 'Internal Server Error: Auth service unavailable' });
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Unauthorized: Missing or invalid token' });
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) {
    return reply.status(401).send({ success: false, error: 'Unauthorized: Empty token' });
  }

  try {
    const decodedToken = await auth.verifyIdToken(idToken);

    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
    
    // TODO (Post-release): Refactor để ngừng mutate headers. Hiện tại giữ lại để backward compatible.
    request.headers['x-user-id'] = decodedToken.uid;
    return;
  } catch (error: any) {
    request.log.error({ err: error }, 'verifyToken failed');
    return reply.status(401).send({ success: false, error: 'Unauthorized: Invalid token' });
  }
};

export const optionalVerifyToken = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  if (!auth) {
    request.log.warn('Firebase Auth is not initialized in optionalVerifyToken, treating as guest');
    delete request.headers['x-user-id']; // Xóa để chặn fake header từ guest
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    delete request.headers['x-user-id'];
    return;
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) {
    delete request.headers['x-user-id'];
    return;
  }

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
    
    // Ghi đè header bằng UID thật từ token, không tin tưởng input của client
    request.headers['x-user-id'] = decodedToken.uid;
  } catch (error: any) {
    request.log.warn({ err: error }, 'optionalVerifyToken failed, falling back to guest mode');
    delete request.headers['x-user-id']; // Token hỏng -> ép về guest -> xóa header
  }
};