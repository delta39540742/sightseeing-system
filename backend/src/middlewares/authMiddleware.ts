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
  } catch (error: any) {
    console.error('Error verifying Firebase token:', error);
    return reply.status(401).send({ success: false, error: 'Unauthorized: Invalid token' });
  }
};
