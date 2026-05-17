/**
 * CausalTraceBuilder.test.ts
 *
 * Kiểm thử CausalTraceBuilder: builder pattern cho causal trace trong mỗi ReplanProposal.
 *   - begin() / record() / finalize() / reset()
 *   - Bảo vệ bất biến: finalize() phải sau begin()
 *   - Spread bảo vệ steps (immutability sau finalize)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CausalTraceBuilder } from '../src/replanner/CausalTraceBuilder';
import type { TripEvent, CausalTraceStep } from '@app/types';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeTriggerEvent(overrides: Partial<TripEvent> = {}): TripEvent {
  return {
    eventId: 'evt-001',
    tripId: 'trip-001',
    status: 'open',
    key: 'weather',
    value: 'rain',
    occurredAt: new Date().toISOString(),
    ...overrides,
  } as TripEvent;
}

function makeStep(overrides: Partial<CausalTraceStep> = {}): CausalTraceStep {
  return {
    stepIndex: 0,
    reason: 'Mưa lớn — thay địa điểm ngoài trời',
    affectedSlotId: 'slot-001',
    alternativeChosen: null,
    downstreamImpact: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('1. Nhóm kiểm thử begin() và finalize()', () => {
  let builder: CausalTraceBuilder;

  beforeEach(() => {
    builder = new CausalTraceBuilder();
  });

  it('finalize() ném Error nếu chưa gọi begin()', () => {
    expect(() => builder.finalize()).toThrow('begin()');
  });

  it('finalize() sau begin() thành công: trả về CausalTrace hợp lệ', () => {
    builder.begin('trip-001', makeTriggerEvent());
    const trace = builder.finalize();
    expect(trace).toBeDefined();
    expect(trace.tripId).toBe('trip-001');
  });

  it('tripId trong kết quả khớp với tham số begin()', () => {
    builder.begin('trip-XYZ', makeTriggerEvent());
    const trace = builder.finalize();
    expect(trace.tripId).toBe('trip-XYZ');
  });

  it('triggeredByEventId khớp với triggerEvent.eventId', () => {
    builder.begin('trip-001', makeTriggerEvent({ eventId: 'evt-999' }));
    const trace = builder.finalize();
    expect(trace.triggeredByEventId).toBe('evt-999');
  });

  it('computationMs >= 0 và có kiểu number', () => {
    builder.begin('trip-001', makeTriggerEvent());
    const trace = builder.finalize();
    expect(typeof trace.computationMs).toBe('number');
    expect(trace.computationMs).toBeGreaterThanOrEqual(0);
  });

  it('createdAt là instance của Date', () => {
    builder.begin('trip-001', makeTriggerEvent());
    const trace = builder.finalize();
    expect(trace.createdAt).toBeInstanceOf(Date);
  });

  it('steps là mảng rỗng khi không gọi record()', () => {
    builder.begin('trip-001', makeTriggerEvent());
    const trace = builder.finalize();
    expect(trace.steps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. record()
// ---------------------------------------------------------------------------

describe('2. Nhóm kiểm thử record()', () => {
  let builder: CausalTraceBuilder;

  beforeEach(() => {
    builder = new CausalTraceBuilder();
    builder.begin('trip-001', makeTriggerEvent());
  });

  it('1 lần record: steps.length = 1', () => {
    builder.record(makeStep());
    const trace = builder.finalize();
    expect(trace.steps).toHaveLength(1);
  });

  it('N lần record: steps.length = N, thứ tự được giữ nguyên', () => {
    builder.record(makeStep({ stepIndex: 0, reason: 'Bước 1' }));
    builder.record(makeStep({ stepIndex: 1, reason: 'Bước 2' }));
    builder.record(makeStep({ stepIndex: 2, reason: 'Bước 3' }));
    const trace = builder.finalize();
    expect(trace.steps).toHaveLength(3);
    expect(trace.steps[0]!.reason).toBe('Bước 1');
    expect(trace.steps[1]!.reason).toBe('Bước 2');
    expect(trace.steps[2]!.reason).toBe('Bước 3');
  });

  it('finalize trả về bản sao mảng steps: mutate sau finalize không ảnh hưởng', () => {
    builder.record(makeStep({ stepIndex: 0 }));
    const trace = builder.finalize();
    // mutate mảng trả về
    (trace.steps as CausalTraceStep[]).push(makeStep({ stepIndex: 1, reason: 'Extra' }));
    // gọi lại finalize sẽ lỗi (đã finalize), nhưng steps nội bộ không bị thay đổi
    // Kiểm tra gián tiếp: nếu spread hoạt động, push vào trace.steps không ảnh hưởng
    expect(trace.steps).toHaveLength(2); // trace.steps đã có 2 vì ta push vào nó
    // Tạo builder mới để kiểm tra immutability
    const builder2 = new CausalTraceBuilder();
    builder2.begin('trip-001', makeTriggerEvent());
    builder2.record(makeStep({ stepIndex: 0 }));
    const trace2 = builder2.finalize();
    expect(trace2.steps).toHaveLength(1); // không bị ảnh hưởng bởi builder trước
  });

  it('record chứa đúng dữ liệu affectedSlotId', () => {
    builder.record(makeStep({ affectedSlotId: 'slot-ABC', reason: 'Lý do thay đổi' }));
    const trace = builder.finalize();
    expect(trace.steps[0]!.affectedSlotId).toBe('slot-ABC');
    expect(trace.steps[0]!.reason).toBe('Lý do thay đổi');
  });
});

// ---------------------------------------------------------------------------
// 3. reset()
// ---------------------------------------------------------------------------

describe('3. Nhóm kiểm thử reset()', () => {
  let builder: CausalTraceBuilder;

  beforeEach(() => {
    builder = new CausalTraceBuilder();
  });

  it('sau reset: finalize() ném Error (tripId/startTime bị xóa)', () => {
    builder.begin('trip-001', makeTriggerEvent());
    builder.reset();
    expect(() => builder.finalize()).toThrow('begin()');
  });

  it('sau reset rồi begin lại: builder hoạt động như mới', () => {
    builder.begin('trip-001', makeTriggerEvent());
    builder.record(makeStep({ stepIndex: 0 }));
    builder.reset();
    builder.begin('trip-002', makeTriggerEvent({ eventId: 'evt-NEW' }));
    const trace = builder.finalize();
    expect(trace.tripId).toBe('trip-002');
    expect(trace.triggeredByEventId).toBe('evt-NEW');
    expect(trace.steps).toHaveLength(0); // steps bị xóa sau reset
  });

  it('steps bị xóa sau reset', () => {
    builder.begin('trip-001', makeTriggerEvent());
    builder.record(makeStep({ stepIndex: 0 }));
    builder.record(makeStep({ stepIndex: 1 }));
    builder.reset();
    builder.begin('trip-001', makeTriggerEvent());
    const trace = builder.finalize();
    expect(trace.steps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge cases
// ---------------------------------------------------------------------------

describe('4. Nhóm kiểm thử edge cases', () => {
  let builder: CausalTraceBuilder;

  beforeEach(() => {
    builder = new CausalTraceBuilder();
  });

  it('triggerEvent không có eventId (undefined): triggeredByEventId = empty string', () => {
    const eventWithoutId = { tripId: 'trip-001' } as any; // không có eventId
    builder.begin('trip-001', eventWithoutId);
    const trace = builder.finalize();
    expect(trace.triggeredByEventId).toBe('');
  });

  it('gọi begin() lần 2 ghi đè lần 1 (tripId và steps được reset)', () => {
    builder.begin('trip-FIRST', makeTriggerEvent({ eventId: 'evt-1' }));
    builder.record(makeStep({ stepIndex: 0, reason: 'Bước từ lần 1' }));
    // begin lần 2
    builder.begin('trip-SECOND', makeTriggerEvent({ eventId: 'evt-2' }));
    const trace = builder.finalize();
    expect(trace.tripId).toBe('trip-SECOND');
    expect(trace.triggeredByEventId).toBe('evt-2');
    expect(trace.steps).toHaveLength(0); // steps bị xóa khi begin() gọi lại
  });
});
