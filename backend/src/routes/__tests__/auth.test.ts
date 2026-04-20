import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import Fastify, { FastifyInstance } from 'fastify';
  import { authPlugin } from '../auth';

  // Mock Firebase
  vi.mock('../../config/firebase', () => ({
    auth: {
      verifyIdToken: vi.fn(),
    },
  }));

  // Mock Prisma
  vi.mock('../../server', () => ({
    prisma: {
      app_user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    },
  }));

  import { auth } from '../../config/firebase';
  import { prisma } from '../../server';

  async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    await app.register(authPlugin, { prefix: '/api/auth' });
    await app.ready();
    return app;
  }

  describe('POST /api/auth/login', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildApp();
    });

    afterEach(async () => {
      await app.close();
      vi.clearAllMocks();
    });

    it('returns 401 when no Authorization header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when token is invalid', async () => {
      (auth!.verifyIdToken as any).mockRejectedValue(new Error('Invalid token'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { authorization: 'Bearer bad-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('creates new user and returns 200', async () => {
      (auth!.verifyIdToken as any).mockResolvedValue({
        uid: 'uid-123',
        email: 'test@example.com',
        name: 'Test User',
      });
      (prisma.app_user.findUnique as any).mockResolvedValue(null);
      (prisma.app_user.create as any).mockResolvedValue({
        firebase_uid: 'uid-123',
        email: 'test@example.com',
        display_name: 'Test User',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true });
      expect(prisma.app_user.create).toHaveBeenCalled();
    });

    it('returns existing user without creating', async () => {
      const existing = { firebase_uid: 'uid-123', email: 'test@example.com', display_name: 'Test' };
      (auth!.verifyIdToken as any).mockResolvedValue({ uid: 'uid-123', email: 'test@example.com' });
      (prisma.app_user.findUnique as any).mockResolvedValue(existing);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.app_user.create).not.toHaveBeenCalled();
    });
  });