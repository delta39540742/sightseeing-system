import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendReward, sendPoiAcceptedBatch, getCurrentArmId } from '../src/lib/preferenceClient';

// Mock prisma trước khi import client
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user_objective_weights: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../src/lib/prisma';

describe('preferenceClient.sendReward', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('POST đúng URL với payload chuẩn', async () => {
    sendReward({
      userId: 'u-1',
      tripId: 't-1',
      armId: 2,
      interactionType: 'poi_accepted',
      placeId: 42,
    });

    // fire-and-forget → đợi tick
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/preferences/internal/reward');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      userId: 'u-1',
      tripId: 't-1',
      armId: 2,
      interactionType: 'poi_accepted',
      placeId: 42,
    });
  });

  it('không throw khi preference-service down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(() =>
      sendReward({
        userId: 'u-1',
        tripId: 't-1',
        armId: 1,
        interactionType: 'slot_completed',
        placeId: 1,
      }),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

describe('preferenceClient.sendPoiAcceptedBatch', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('gửi 1 reward cho mỗi placeId duy nhất', async () => {
    sendPoiAcceptedBatch({
      userId: 'u-1',
      tripId: 't-1',
      armId: 1,
      placeIds: [10, 20, 30],
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const types = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body).interactionType);
    expect(types).toEqual(['poi_accepted', 'poi_accepted', 'poi_accepted']);

    const placeIds = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body).placeId);
    expect(placeIds).toEqual([10, 20, 30]);
  });

  it('dedupe placeIds trùng', async () => {
    sendPoiAcceptedBatch({
      userId: 'u-1',
      tripId: 't-1',
      armId: 1,
      placeIds: [10, 20, 10, 30, 20],
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const placeIds = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as any).body).placeId).sort();
    expect(placeIds).toEqual([10, 20, 30]);
  });

  it('placeIds rỗng → không gửi gì', async () => {
    sendPoiAcceptedBatch({
      userId: 'u-1',
      tripId: 't-1',
      armId: 1,
      placeIds: [],
    });

    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('preferenceClient.getCurrentArmId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trả arm_id của user', async () => {
    (prisma.user_objective_weights.findUnique as any).mockResolvedValue({ current_arm_id: 5 });
    const armId = await getCurrentArmId('u-1');
    expect(armId).toBe(5);
  });

  it('trả default 1 khi chưa có row', async () => {
    (prisma.user_objective_weights.findUnique as any).mockResolvedValue(null);
    const armId = await getCurrentArmId('u-1');
    expect(armId).toBe(1);
  });

  it('trả default 1 khi prisma throw', async () => {
    (prisma.user_objective_weights.findUnique as any).mockRejectedValue(new Error('DB down'));
    const armId = await getCurrentArmId('u-1');
    expect(armId).toBe(1);
  });
});
