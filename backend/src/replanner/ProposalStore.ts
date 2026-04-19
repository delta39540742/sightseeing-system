import type { ReplanProposal, TripState } from '@app/types';
import type { CausalTrace } from './CausalTraceBuilder.js';

/**
 * Trạng thái vòng đời của một ReplanProposal.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/**
 * Bộ lọc khi truy vấn proposals từ store.
 */
export interface ProposalFilter {
  tripId?: string;
  status?: ProposalStatus;
  /** Chỉ lấy proposals được tạo sau mốc thời gian này */
  createdAfter?: Date;
  limit?: number;
  offset?: number;
}

/**
 * ProposalStore
 *
 * Lớp persistence cho ReplanProposal và CausalTrace — giao tiếp với Postgres
 * để lưu, truy vấn, và cập nhật vòng đời của các proposals.
 *
 * Nhiệm vụ chính:
 *  - Persist ReplanProposal (bao gồm proposed TripState dạng JSONB) vào DB
 *  - Lưu CausalTrace liên kết với proposal tương ứng
 *  - Truy vấn proposals theo tripId / status / thời gian
 *  - Cập nhật status khi người dùng accept/reject
 *  - Tự động đánh dấu expired cho proposals quá hạn (TTL-based)
 *  - Cung cấp transaction wrapper để đảm bảo atomicity khi save proposal + trace
 */
export class ProposalStore {
  /**
   * Lưu một ReplanProposal mới cùng CausalTrace của nó (trong một transaction).
   * @param proposal Proposal cần lưu
   * @param trace CausalTrace giải thích quá trình tạo proposal
   * @returns UUID được gán cho proposal sau khi insert
   */
  async save(proposal: ReplanProposal, trace: CausalTrace): Promise<string> {
    throw new Error('Not implemented');
  }

  /**
   * Truy vấn danh sách proposals theo bộ lọc.
   * @param filter Điều kiện lọc
   * @returns Danh sách ReplanProposal thỏa điều kiện
   */
  async findMany(filter: ProposalFilter): Promise<ReplanProposal[]> {
    throw new Error('Not implemented');
  }

  /**
   * Lấy một proposal theo ID.
   * @param proposalId UUID của proposal
   * @returns ReplanProposal hoặc null nếu không tìm thấy
   */
  async findById(proposalId: string): Promise<ReplanProposal | null> {
    throw new Error('Not implemented');
  }

  /**
   * Cập nhật status của proposal (accept / reject).
   * @param proposalId UUID của proposal
   * @param status Trạng thái mới
   * @param actorId UUID của người thực hiện hành động
   */
  async updateStatus(
    proposalId: string,
    status: ProposalStatus,
    actorId: string,
  ): Promise<void> {
    throw new Error('Not implemented');
  }

  /**
   * Đánh dấu expired tất cả proposals của một trip đã quá TTL.
   * @param tripId UUID chuyến đi
   * @param ttlMs Thời gian sống tính bằng millisecond
   * @returns Số proposals bị expire
   */
  async expireOld(tripId: string, ttlMs: number): Promise<number> {
    throw new Error('Not implemented');
  }
}
