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
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ success: false, error: 'Unauthorized: Missing or invalid token' });
  }

  const idToken = authHeader.split('Bearer ')[1]!;

  try {
    if (!auth) {
      throw new Error('Firebase Auth is not initialized');
    }

    const decodedToken = await auth.verifyIdToken(idToken);

    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
    return;
  } catch (error: any) {
    request.log.error({ err: error }, 'verifyToken failed');
    return reply.status(401).send({ success: false, error: 'Unauthorized: Invalid token' });
  }
};

/**
 * Best-effort auth: nếu có Bearer token hợp lệ → set request.user.
 * Nếu thiếu/sai token → bỏ qua, request vẫn đi tiếp như guest.
 *
 * Dùng cho các endpoint vừa cho guest browse vừa cá nhân hoá khi có user
 * (ví dụ /api/plan/candidates). Tránh để guest fake `x-user-id` header lấy
 * preference data của user khác.
 */
export const optionalVerifyToken = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Guest mode: xoá x-user-id header để handler không tin vào input từ client.
    delete request.headers['x-user-id'];
    return;
  }

  const idToken = authHeader.split('Bearer ')[1]!;
  try {
    if (!auth) return; // Firebase chưa init → treat as guest
    const decodedToken = await auth.verifyIdToken(idToken);
    request.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
    // Override header để handler luôn dùng UID đã verify, không phải input
    request.headers['x-user-id'] = decodedToken.uid;
  } catch {
    // Token hỏng → guest mode
    delete request.headers['x-user-id'];
  }
};
