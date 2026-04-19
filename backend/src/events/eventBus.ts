import { EventEmitter } from 'events';
import { prisma } from '../server';

class EventBus {
  private static instance: EventBus;
  private emitter: EventEmitter;

  private constructor() {
    this.emitter = new EventEmitter();
    this.init();
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  private init() {
    // Listen to all events published globally
    this.emitter.on('publish', async (eventName: string, payload: any, correlationId?: string) => {
      try {
        await prisma.event_log.create({
          data: {
            event_name: eventName,
            payload: payload || {},
            correlation_id: correlationId || null,
          }
        });
        console.log(`[EventBus] Recorded event: ${eventName}`);
      } catch (error) {
        console.error(`[EventBus] Failed to log event ${eventName}`, error);
      }
    });
  }

  /**
   * Publish an internal event and log it to the database
   */
  public publish(eventName: string, payload: any, correlationId?: string) {
    this.emitter.emit('publish', eventName, payload, correlationId);
    // You can also emit it normally so other listeners can react
    this.emitter.emit(eventName, payload, correlationId);
  }

  /**
   * Subscribe to specific events triggered internally
   */
  public subscribe(eventName: string, listener: (...args: any[]) => void) {
    this.emitter.on(eventName, listener);
  }
}

export const InternalEventBus = EventBus.getInstance();
