/**
 * places.extended.test.ts
 *
 * Kiểm thử các endpoint chưa được bao phủ trong placesPlugin:
 *   - POST /api/places              — tạo địa điểm tùy chỉnh ($queryRaw)
 *   - GET  /api/places/nearby       — tìm địa điểm lân cận (ST_DWithin)
 *   - GET  /api/places/resolve-url  — follow redirect Google Maps URL
 *
 * Lưu ý: GET /api/places và GET /api/places/:id đã được bao phủ trong places.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    place: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../src/events/eventBus', () => ({
  InternalEventBus: { publish: vi.fn() },
}));

import { placesPlugin } from '../src/routes/places';
import { prisma } from '../src/lib/prisma';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(placesPlugin, { prefix: '/api/places' });
  await app.ready();
  return app;
}

function makePlaceRow(overrides: Record<string, any> = {}) {
  return {
    place_id: 1n,
    name: 'Test Place',
    description: null,
    lat: 16.0614,
    lng: 108.2273,
    avg_visit_duration_min: 60,
    indoor_outdoor: 'indoor',
    is_landmark: false,
    min_price: 0,
    max_price: null,
    price_type: 'free',
    address: null,
    popularity_score: null,
    ...overrides,
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

// ---------------------------------------------------------------------------
// POST /api/places — tạo địa điểm tùy chỉnh
// ---------------------------------------------------------------------------

describe('POST /api/places — tạo địa điểm tùy chỉnh', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.$queryRaw as any).mockResolvedValue([makePlaceRow()]);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 201 với place object khi name, lat, lng hợp lệ', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Bãi biển Mỹ Khê', lat: 16.0614, lng: 108.2273 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it('place_id BigInt được serialize thành number', async () => {
    (prisma.$queryRaw as any).mockResolvedValue([makePlaceRow({ place_id: 999n })]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Test', lat: 16.0, lng: 108.0 },
    });
    expect(res.statusCode).toBe(201);
    expect(typeof res.json().data.place_id).toBe('number');
    expect(res.json().data.place_id).toBe(999);
  });

  it('trả về 400 khi thiếu name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { lat: 16.0614, lng: 108.2273 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi thiếu lat', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Test', lng: 108.2273 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi thiếu lng', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Test', lat: 16.0614 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 500 khi $queryRaw ném lỗi', async () => {
    (prisma.$queryRaw as any).mockRejectedValue(new Error('DB error'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Test', lat: 16.0, lng: 108.0 },
    });
    expect(res.statusCode).toBe(500);
  });

  it('description là optional — thành công khi không có description', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/places',
      headers: JSON_HEADERS,
      payload: { name: 'Test Place', lat: 16.0, lng: 108.0 },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// GET /api/places/nearby
// ---------------------------------------------------------------------------

describe('GET /api/places/nearby — tìm địa điểm lân cận', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    (prisma.$queryRaw as any).mockResolvedValue([
      { ...makePlaceRow(), distance_m: 150 },
    ]);
  });
  afterEach(async () => { await app.close(); vi.clearAllMocks(); });

  it('trả về 200 với danh sách places và distanceM', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614&lng=108.2273',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].distanceM).toBe(150);
  });

  it('trả về 400 khi thiếu lat', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lng=108.2273',
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi thiếu lng', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614',
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi lat là chuỗi không hợp lệ', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=invalid&lng=108.2273',
    });
    expect(res.statusCode).toBe(400);
  });

  it('radius mặc định = 500 khi không truyền (không throw)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614&lng=108.2273',
    });
    expect(res.statusCode).toBe(200);
  });

  it('place_id BigInt được serialize thành number', async () => {
    (prisma.$queryRaw as any).mockResolvedValue([
      { ...makePlaceRow({ place_id: 42n }), distance_m: 100 },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614&lng=108.2273',
    });
    expect(typeof res.json().data[0].place_id).toBe('number');
    expect(res.json().data[0].place_id).toBe(42);
  });

  it('trả về mảng rỗng khi không có địa điểm nào trong phạm vi', async () => {
    (prisma.$queryRaw as any).mockResolvedValue([]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614&lng=108.2273',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('trả về 500 khi $queryRaw ném lỗi', async () => {
    (prisma.$queryRaw as any).mockRejectedValue(new Error('DB error'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/nearby?lat=16.0614&lng=108.2273',
    });
    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/places/resolve-url
// ---------------------------------------------------------------------------

describe('GET /api/places/resolve-url — follow redirect Google Maps URL', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    app = await buildApp();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('trả về 200 với finalUrl khi Google Maps URL hợp lệ', async () => {
    fetchMock.mockResolvedValue({ url: 'https://www.google.com/maps/place/Ba+Na+Hills' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url?url=https://maps.app.goo.gl/abc123',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.finalUrl).toBe('https://www.google.com/maps/place/Ba+Na+Hills');
  });

  it('finalUrl là URL cuối cùng sau redirect (response.url)', async () => {
    const redirectedUrl = 'https://www.google.com/maps/place/Hoi+An/@15.8794,108.3346,17z';
    fetchMock.mockResolvedValue({ url: redirectedUrl });
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url?url=https://goo.gl/maps/short',
    });
    expect(res.json().finalUrl).toBe(redirectedUrl);
  });

  it('trả về 400 khi url không phải Google Maps link', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url?url=https://example.com/page',
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 400 khi không có url query parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url',
    });
    expect(res.statusCode).toBe(400);
  });

  it('trả về 502 khi fetch ném lỗi (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url?url=https://maps.app.goo.gl/abc123',
    });
    expect(res.statusCode).toBe(502);
  });

  it('url dạng maps.app.goo.gl được chấp nhận', async () => {
    fetchMock.mockResolvedValue({ url: 'https://www.google.com/maps?q=test' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/places/resolve-url?url=https://maps.app.goo.gl/xyz',
    });
    expect(res.statusCode).toBe(200);
  });

  it('url dạng google.com/maps được chấp nhận', async () => {
    fetchMock.mockResolvedValue({ url: 'https://www.google.com/maps/place/Test' });
    const res = await app.inject({
      method: 'GET',
      url: encodeURI('/api/places/resolve-url?url=https://google.com/maps/place/Test'),
    });
    expect(res.statusCode).toBe(200);
  });
});
