import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    place: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/events/eventBus', () => ({
  InternalEventBus: { publish: vi.fn() },
}));

import { placesPlugin } from '../src/routes/places';
import { prisma } from '../src/lib/prisma';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(placesPlugin, { prefix: '/api/places' });
  await app.ready();
  return app;
}

describe('GET /api/places', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns paginated places', async () => {
    (prisma.place.findMany as any).mockResolvedValue([
      { place_id: 1n, name: 'A', popularity_score: 0.9 },
      { place_id: 2n, name: 'B', popularity_score: 0.8 },
    ]);
    (prisma.place.count as any).mockResolvedValue(2);

    const res = await app.inject({ method: 'GET', url: '/api/places?page=1&limit=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
  });

  it('serializes BigInt place_id to number', async () => {
    (prisma.place.findMany as any).mockResolvedValue([{ place_id: 999n, name: 'X' }]);
    (prisma.place.count as any).mockResolvedValue(1);

    const res = await app.inject({ method: 'GET', url: '/api/places' });
    expect(res.json().data[0].place_id).toBe(999);
  });

  it('filters by indoor_outdoor query', async () => {
    (prisma.place.findMany as any).mockResolvedValue([]);
    (prisma.place.count as any).mockResolvedValue(0);

    await app.inject({ method: 'GET', url: '/api/places?indoor_outdoor=indoor' });
    const callArgs = (prisma.place.findMany as any).mock.calls[0][0];
    expect(callArgs.where.indoor_outdoor).toBe('indoor');
  });

  it('returns 500 on DB error', async () => {
    (prisma.place.findMany as any).mockRejectedValue(new Error('DB down'));
    const res = await app.inject({ method: 'GET', url: '/api/places' });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /api/places/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns place by id', async () => {
    (prisma.place.findUnique as any).mockResolvedValue({ place_id: 42n, name: 'Foo' });
    const res = await app.inject({ method: 'GET', url: '/api/places/42' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.place_id).toBe(42);
  });

  it('returns 400 on invalid id format', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/places/not-a-number' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when not found', async () => {
    (prisma.place.findUnique as any).mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/places/9999' });
    expect(res.statusCode).toBe(404);
  });
});
