/**
 * replanner — Part 2 của TravelSystem
 *
 * Pipeline tổng thể:
 *   TripEvent (trigger)
 *     → PlanLoader      : tải TripState hiện tại từ DB
 *     → StateEvolver    : apply event lên state (event-sourcing)
 *     → MutationOperators + BeamSearch : tìm kiếm TripState tối ưu hơn
 *     → CausalTraceBuilder : ghi lại quá trình suy luận
 *     → ProposalStore   : persist ReplanProposal + CausalTrace vào DB
 *
 * Public API của module:
 *  - ReplannerService  : orchestrator chạy toàn bộ pipeline
 *  - Các class/type con được re-export để route handler và test sử dụng trực tiếp
 */

export { PlanLoader } from './PlanLoader';
export { StateEvolver } from './StateEvolver';
export { MutationOperators } from './MutationOperators';
export type { MutationResult, OperatorName } from './MutationOperators';
export { BeamSearch, ObjectiveScorer } from './BeamSearch';
export type {
  BeamSearchConfig,
  BeamNode,
  BeamSearchContext,
} from './BeamSearch';
export { CausalTraceBuilder } from './CausalTraceBuilder';
export type { CausalTrace } from './CausalTraceBuilder';
export { ProposalStore } from './ProposalStore';
export type { ProposalStatus, ProposalFilter } from './ProposalStore';

/**
 * ReplannerService
 *
 * Orchestrator chính của module replanner. Nhận TripEvent từ Fastify route
 * (hoặc message queue), chạy toàn bộ pipeline, và trả về danh sách
 * ReplanProposal đã được persist sẵn sàng để gửi về client.
 *
 * Inject qua Fastify plugin (fastify.decorate) để dùng chung Pool connection.
 */
export class ReplannerService {
  /**
   * Xử lý một TripEvent: load state → evolve → beam search → persist proposals.
   * @param eventId UUID của TripEvent cần xử lý
   * @returns Danh sách proposal IDs vừa được tạo
   */
  async handleEvent(eventId: string): Promise<string[]> {
    throw new Error('Not implemented');
  }
}
