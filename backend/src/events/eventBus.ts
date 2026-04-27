import { EventEmitter } from 'events';
import { prisma } from '../lib/prisma';

const PERSIST_RETRY_DELAYS_MS = [100, 500, 2000]; // 3 lần retry với backoff
const FAILURE_LOG_THROTTLE_MS = 60_000;

class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;
  private failureCount = 0;
  private lastFailureLogAt = 0;

  private constructor() {
    this.emitter = new EventEmitter();
    // EventEmitter cảnh báo khi >10 listener; replanner + routes sub khá nhiều.
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
    this.emitter.emit(eventName, payload, correlationId);
  }

  public subscribe(eventName: string, listener: (...args: any[]) => void): void {
    this.emitter.on(eventName, listener);
  }

  /** Lấy số lần persist thất bại — phục vụ healthcheck/metric. */
  public getFailureCount(): number {
    return this.failureCount;
  }
}

export const InternalEventBus = EventBus.getInstance();
