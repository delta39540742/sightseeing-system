import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../src/events/eventBus', () => ({
  InternalEventBus: { publish: vi.fn() },
}));

import { internalEventsPlugin } from '../src/routes/internalEvents';
import { InternalEventBus } from '../src/events/eventBus';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(internalEventsPlugin, { prefix: '/api/internal/events' });
  await app.ready();
  return app;
}

describe('POST /api/internal/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    delete process.env.INTERNAL_EVENT_SECRET;
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
    delete process.env.INTERNAL_EVENT_SECRET;
  });

  it('publishes event when no secret set (dev mode)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/events',
      headers: { 'content-type': 'application/json' },
      payload: { event_type: 'test.event', payload: { foo: 'bar' } },
    });
    expect(res.statusCode).toBe(200);
    expect(InternalEventBus.publish).toHaveBeenCalledWith('test.event', { foo: 'bar' });
  });

  it('returns 400 on missing event_type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/events',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when secret mismatch', async () => {
    process.env.INTERNAL_EVENT_SECRET = 'super-secret';
    await app.close();
    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/events',
      headers: { 'content-type': 'application/json', 'x-internal-secret': 'wrong' },
      payload: { event_type: 'test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts when secret matches', async () => {
    process.env.INTERNAL_EVENT_SECRET = 'super-secret';
    await app.close();
    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/events',
      headers: { 'content-type': 'application/json', 'x-internal-secret': 'super-secret' },
      payload: { event_type: 'test', payload: {} },
    });
    expect(res.statusCode).toBe(200);
  });

  it('strips extra properties (additionalProperties: false → removeAdditional)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/events',
      headers: { 'content-type': 'application/json' },
      payload: { event_type: 'test', payload: { ok: true }, hacker: 'data' },
    });
    // Fastify default ajv config strip additional props khi additionalProperties: false.
    // Vẫn 200 nhưng `hacker` không tới handler.
    expect(res.statusCode).toBe(200);
    expect(InternalEventBus.publish).toHaveBeenCalledWith('test', { ok: true });
  });

  it('throws at boot in production without secret', async () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_EVENT_SECRET;
    const failApp = Fastify({ logger: false });
    await expect(
      failApp.register(internalEventsPlugin, { prefix: '/api/internal/events' }),
    ).rejects.toThrow(/INTERNAL_EVENT_SECRET/);
    process.env.NODE_ENV = orig;
  });
});
