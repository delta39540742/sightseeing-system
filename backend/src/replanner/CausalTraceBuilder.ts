import type { TripState, TripEvent, CausalTraceStep } from '@app/types';

/**
 * Toàn bộ causal trace cho một lần replan: chuỗi bước giải thích
 * từ trạng thái bị vi phạm đến proposal tối ưu.
 */
export interface CausalTrace {
  tripId: string;
  triggeredByEventId: string;
  steps: CausalTraceStep[];
  /** Tổng thời gian tính toán (ms) */
  computationMs: number;
  createdAt: Date;
}

/**
 * CausalTraceBuilder
 *
 * Xây dựng chuỗi giải thích nhân-quả (causal trace) cho quá trình replanning,
 * giúp người dùng hiểu TẠI SAO hệ thống đề xuất thay đổi cụ thể.
 *
 * Nhiệm vụ chính:
 *  - Bắt đầu trace từ TripEvent gây ra replan (constraint violation, user edit, ...)
 *  - Ghi lại mỗi bước: state_before → mutation_applied → state_after + delta_score
 *  - Annotate lý do của từng mutation bằng ngôn ngữ tự nhiên
 *  - Tổng hợp thành CausalTrace để lưu DB và hiển thị frontend
 *  - Đảm bảo trace có thể reproduce: deterministic từ seed + inputs
 */
export class CausalTraceBuilder {
  private steps: CausalTraceStep[] = [];
  private startTime: number = 0;

  /**
   * Bắt đầu ghi trace mới cho một replan session.
   * @param tripId UUID chuyến đi
   * @param triggerEvent Event đã kích hoạt replan
   */
  begin(tripId: string, triggerEvent: TripEvent): void {
    throw new Error('Not implemented');
  }

  /**
   * Ghi lại một bước trong quá trình tìm kiếm.
   * @param step Thông tin bước: state trước/sau, mutation, score delta
   */
  record(step: CausalTraceStep): void {
    throw new Error('Not implemented');
  }

  /**
   * Kết thúc trace và trả về CausalTrace hoàn chỉnh.
   * @returns CausalTrace sẵn sàng để persist vào DB
   */
  finalize(): CausalTrace {
    throw new Error('Not implemented');
  }

  /**
   * Reset builder về trạng thái ban đầu (để tái sử dụng).
   */
  reset(): void {
    throw new Error('Not implemented');
  }
}
