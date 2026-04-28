import type { TripEvent, CausalTraceStep } from '@app/types';

export interface CausalTrace {
  tripId: string;
  triggeredByEventId: string;
  steps: CausalTraceStep[];
  computationMs: number;
  createdAt: Date;
}

export class CausalTraceBuilder {
  private steps: CausalTraceStep[] = [];
  private startTime: number = 0;
  private tripId: string = '';
  private triggeredByEventId: string = '';

  begin(tripId: string, triggerEvent: TripEvent): void {
    this.tripId = tripId;
    this.triggeredByEventId = triggerEvent?.eventId ?? '';
    this.startTime = Date.now();
    this.steps = [];
  }

  record(step: CausalTraceStep): void {
    this.steps.push(step);
  }

  finalize(): CausalTrace {
    if (!this.tripId || this.startTime === 0) {
      throw new Error('CausalTraceBuilder: phải gọi begin() trước khi finalize()');
    }
    return {
      tripId: this.tripId,
      triggeredByEventId: this.triggeredByEventId,
      steps: [...this.steps],
      computationMs: Date.now() - this.startTime,
      createdAt: new Date(),
    };
  }

  reset(): void {
    this.steps = [];
    this.startTime = 0;
    this.tripId = '';
    this.triggeredByEventId = '';
  }
}
