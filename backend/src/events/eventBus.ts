import { EventEmitter } from 'events';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

const PERSIST_RETRY_DELAYS_MS = [100, 500, 2000]; // 3 lần retry với backoff
const FAILURE_LOG_THROTTLE_MS = 60_000;

class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;
  private failureCount = 0;
  private lastFailureLogAt = 0;
  
  // WeakMap dùng để lưu mapping giữa listener gốc và listener đã được bọc try/catch.
  // WeakMap giúp tự động giải phóng bộ nhớ (GC) khi listener gốc không còn được sử dụng ở đâu khác.
  private listenerMap = new WeakMap<Function, (...args: any[]) => void>();

  private constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.init();
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  private init(): void {
    // 3. Ngăn crash tiến trình khi sự kiện 'error' vô tình được emit mà không có listener
    this.emitter.on('error', (error: Error) => {
      console.error('[EventBus] Unhandled error event emitted:', error);
    });

    this.emitter.on('publish', (eventName: string, payload: any, correlationId?: string) => {
      // fire-and-forget — caller không await; persist trong background
      void this.persistWithRetry(eventName, payload, correlationId);
    });
  }

  private async persistWithRetry(
    eventName: string,
    payload: any,
    correlationId?: string,
  ): Promise<void> {
    for (let attempt = 0; attempt <= PERSIST_RETRY_DELAYS_MS.length; attempt++) {
      try {
        await prisma.event_log.create({
          data: {
            event_name:     eventName,
            payload:        payload ?? {},
            correlation_id: correlationId ?? null,
          },
        });
        return;
      } catch (error) {
        // 5. Ngừng retry đối với các lỗi vĩnh viễn (lỗi logic, schema, validation, unique constraint...)
        if (
          error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientValidationError
        ) {
          console.error(`[EventBus] Unrecoverable Prisma error for ${eventName}, aborting retry.`, error);
          return;
        }

        if (attempt < PERSIST_RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, PERSIST_RETRY_DELAYS_MS[attempt]));
          continue;
        }
        
        // Hết retry → log throttled để không spam console khi DB down dài
        this.failureCount++;
        const now = Date.now();
        if (now - this.lastFailureLogAt > FAILURE_LOG_THROTTLE_MS) {
          console.error(
            `[EventBus] persist failed for ${eventName} (total failures: ${this.failureCount})`,
            error,
          );
          this.lastFailureLogAt = now;
        }
      }
    }
  }

  /**
   * Publish an internal event and log it to the database (background, retried).
   */
  public publish(eventName: string, payload: any, correlationId?: string): void {
    this.emitter.emit('publish', eventName, payload, correlationId);
    
    // 1. Dùng process.nextTick để tách biệt luồng xử lý của listener khỏi caller.
    // Lỗi (nếu bị rò rỉ qua lớp bọc) cũng sẽ không làm gãy luồng request hiện tại.
    process.nextTick(() => {
      this.emitter.emit(eventName, payload, correlationId);
    });
  }

  public subscribe(eventName: string, listener: (...args: any[]) => any): void {
    // 1 & 4. Bọc listener bằng async và try/catch để bắt cả lỗi đồng bộ và Unhandled Promise Rejection.
    const safeListener = async (...args: any[]) => {
      try {
        await listener(...args);
      } catch (error) {
        console.error(`[EventBus] Error caught in listener for event "${eventName}":`, error);
      }
    };

    // Lưu trữ tham chiếu để hỗ trợ việc unsubscribe
    this.listenerMap.set(listener, safeListener);
    this.emitter.on(eventName, safeListener);
  }

  // 2. Cung cấp cơ chế unsubscribe để ngăn rò rỉ bộ nhớ
  public unsubscribe(eventName: string, listener: (...args: any[]) => any): void {
    const safeListener = this.listenerMap.get(listener);
    if (safeListener) {
      this.emitter.off(eventName, safeListener);
    } else {
      // Fallback trong trường hợp hàm chưa từng được bọc
      this.emitter.off(eventName, listener);
    }
  }

  /** Lấy số lần persist thất bại — phục vụ healthcheck/metric. */
  public getFailureCount(): number {
    return this.failureCount;
  }
}

export const InternalEventBus = EventBus.getInstance();