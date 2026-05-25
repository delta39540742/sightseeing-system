import { randomUUID } from 'crypto';
import type { TripSlot, Place, TripState } from '@app/types';
import type { StateEvolver, ReplanContext } from './StateEvolver';
import { dot, tagVectorOf } from './StateEvolver';
import type { BeamSearchContext } from './BeamSearch';
import { isSetFeasible } from './FeasibilityFilter';
import type { ProposedMutation } from './CandidatePruner';
// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------


/** The six neighborhood operators available to the replanner. */
export type OperatorName =
  | 'TIME_SHIFT'             // OP-1: shift slot time ±30 / ±60 min
  | 'SWAP_ORDER'             // OP-2: swap two adjacent slots within the same day
  | 'REPLACE_PLACE'          // OP-3: replace a POI with a tag-compatible alternative
  | 'DROP_SLOT'              // OP-4: remove a non-meal slot entirely
  | 'INSERT_ALT'             // OP-5: insert a new POI from the candidate pool
  | 'TSP_REORDER';           // OP-6: reorder slots within each day to minimize travel distance

/**
 * The result of applying one mutation operator to a plan.
 *
 * Scoring is NOT performed here — that is the responsibility of
 * {@link BeamSearch}, which scores each candidate after expansion.
 */
export interface MutationResult {
  /** New plan (deep-cloned array; original plan is never mutated). */
  newPlan: TripSlot[];
  /** Which operator produced this result. */
  operator: OperatorName;
  /** slotIds affected by the mutation (for causal trace annotation). */
  affectedSlotIds: string[];
  /** Human-readable description in Vietnamese (for CausalTraceBuilder). */
  description: string;
  /**
   * Index from which the suffix has been globally rebuilt.
   * This is helpful for trace generation and downstream explanations.
   */
  repairedFromIndex?: number;
  /**
   * First index in newPlan where state MAY differ from the parent plan.
   * Plan[0..resumeIndex-1] is identical to the parent, so the parent's
   * cached trajectory states and per-slot scores are valid for that prefix.
   * Absent or 0 means "recompute everything" (safe fallback).
   *
   * Mapping per operator:
   *   TIME_SHIFT    → index of the shifted slot
   *   SWAP_ORDER    → min(indexA, indexB)
   *   REPLACE_PLACE → index of the replaced slot
   *   DROP_SLOT     → index of the dropped slot (in new shorter plan)
   *   INSERT_ALT    → insertion position
   *   TSP_REORDER   → 0 (full reorder, no safe prefix)
   */
  resumeIndex?: number;
  /**
   * Full state trajectory produced by computeTrajectory() during feasibility check.
   * Cached here so BeamSearch.search() can reuse it instead of re-simulating (Bug 1 fix).
   * states[i+1] = state after visiting newPlan[i]; length = newPlan.length + 1.
   */
  stateTrajectory?: TripState[];
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Minute offsets tried by TIME_SHIFT. */
const TIME_SHIFT_DELTAS_MIN = [-60, -30, 30, 60] as const;

/** Max replacement candidates evaluated per slot in REPLACE_PLACE. */
const MAX_REPLACE_CANDIDATES = 3;

/** Max new places considered by INSERT_ALT when no forceIncludePlaceId. */
const MAX_INSERT_CANDIDATES = 5;

/** Hard cap on total results returned by generateAll (latency control). */
export const GENERATE_ALL_CAP = 30;

/**
 * Vietnam standard offset in milliseconds (GMT+7).
 * Used to convert UTC timestamps to local time when checking opening hours.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const MIN_SLOT_DURATION_MIN = 15;
const DAY_START_HOUR = 8; // 08:00 AM
const DAY_END_HOUR = 22;  // 10:00 PM

// ---------------------------------------------------------------------------
// MutationOperators
// ---------------------------------------------------------------------------

/**
 * Five neighborhood-mutation operators for beam-search replanning.
 *
 * ### Invariants
 * - Every operator returns **copies** of the input plan (no in-place mutation).
 * - Every result satisfies the hard constraints visible at generation time.
 *   Infeasible candidates (budget, time, fatigue) are filtered via
 *   {@link allFeasible}, which runs a full state trajectory simulation.
 *   Scheduling violations are filtered via {@link withinOpeningHours}.
 * - {@link generateAll} caps the combined output at {@link GENERATE_ALL_CAP}
 *   entries to bound latency.
 */
export class MutationOperators {
  constructor(private readonly evolver: StateEvolver) { }

  // -------------------------------------------------------------------------
  // OP-1 TIME_SHIFT
  // -------------------------------------------------------------------------

  /**
   * Dịch chuyển thời gian của từng slot chỉ định (sớm/muộn hơn) và tái lập lịch trình (packing) 
   * cho toàn bộ phần lịch trình phía sau.
   * 
   * Quy trình thực hiện cho mỗi slot:
   * 1. **Bảo vệ quá khứ**: Chỉ thực hiện dịch chuyển (anchor) cho các slot đang ở trạng thái `planned`.
   * 2. **Dịch chuyển thô (Raw Shift)**: Sử dụng `shiftSlot` để tịnh tiến mốc thời gian của slot i.
   * 3. **Kiểm tra ràng buộc tại chỗ**: 
   *    - Kiểm tra Giờ mở cửa (`withinOpeningHours`) cho slot vừa dịch chuyển.
   *    - Kiểm tra Giới hạn nghỉ đêm (`exceedsNightConstraint`) để đảm bảo slot không kết thúc quá muộn.
   * 4. **Tái lập lịch (Repair)**: Gọi `repairSuffix` để dồn lịch (pack) các slot từ i+1 trở đi, 
   *    giúp tối ưu hóa các khoảng trống thời gian phát sinh do dịch chuyển.
   * 5. **Mô phỏng khả thi (All Feasible)**: Sử dụng bộ mô phỏng đã được cập nhật để kiểm tra 
   *    tổng thể. Lưu ý: Bộ mô phỏng này sẽ thông minh bỏ qua các slot `completed`/`skipped` 
   *    trong quá trình tính toán để đảm bảo độ chính xác cho các kế hoạch đang diễn ra.
   *
   * @param plan Danh sách {@link TripSlot} hiện tại.
   * @param ctx  {@link ReplanContext} cung cấp dữ liệu dự báo thời tiết và trạng thái người dùng.
   * @returns    Danh sách các phương án tịnh tiến thời gian khả thi.
   */
  timeShift(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length; i++) {
      const anchor = plan[i]!;
      if (anchor.isLocked) continue;
      if (anchor.status === 'completed' || anchor.status === 'skipped') continue;

      for (const shiftMin of TIME_SHIFT_DELTAS_MIN) {
        const mutated = plan.map((slot, idx) =>
          idx === i ? this.shiftSlot(slot, shiftMin) : { ...slot }
        );

        const shiftedAnchor = mutated[i]!;

        // 1. Kiểm tra Opening Hours cho slot i
        if (!this.withinOpeningHours(shiftedAnchor, ctx)) continue;

        // 2. Kiểm tra Night Constraint cho riêng slot i
        if (this.exceedsNightConstraint(shiftedAnchor.plannedEnd, ctx)) {
          continue;
        }

        // 2b. Underflow guard: anchor không được bắt đầu trước DAY_START_HOUR (08:00 VN)
        // repairSuffix chỉ áp dụng guard cho suffix (i+1 trở đi), không cho anchor (i).
        const anchorStartLocal = new Date(new Date(shiftedAnchor.plannedStart).getTime() + VN_OFFSET_MS);
        if (anchorStartLocal.getUTCHours() < DAY_START_HOUR) continue;

        // 2c. Past guard: anchor không được dịch chuyển về trước capturedAt.
        // Shift âm có thể đẩy plannedStart về quá khứ mà 08:00 VN guard không bắt được
        // (ví dụ: capturedAt = 13:00 VN, slot gốc = 13:30 VN, shift -60 → 12:30 VN).
        const capturedAtMs = new Date(ctx.initialState.capturedAt).getTime();
        if (new Date(shiftedAnchor.plannedStart).getTime() < capturedAtMs) continue;

        // 3. Kiểm tra overlap với slot TRƯỚC (i-1) khi shift về trước (shiftMin < 0).
        // repairSuffix chỉ sửa từ i+1 trở đi; không kiểm tra ngược lên i-1 → phải check thủ công.
        if (shiftMin < 0 && i > 0) {
          const prevSlot = mutated[i - 1]!;
          const prevEndMs     = new Date(prevSlot.plannedEnd).getTime();
          const shiftedStartMs = new Date(shiftedAnchor.plannedStart).getTime();
          if (shiftedStartMs < prevEndMs) continue; // reject: overlap với slot trước
        }

        // Xử lý nếu i là slot cuối cùng
        if (i + 1 >= plan.length) {
          if (shiftMin < 0 && i > 0) {
            const prevSlot = mutated[i - 1]!;
            const prevEndMs      = new Date(prevSlot.plannedEnd).getTime();
            const shiftedStartMs = new Date(shiftedAnchor.plannedStart).getTime();
            if (shiftedStartMs < prevEndMs) continue;
          }
          const trajectory = this.simulateIfFeasible(mutated, ctx);
          if (!trajectory) continue;

          results.push({
            newPlan: mutated,
            operator: 'TIME_SHIFT',
            affectedSlotIds: [anchor.slotId],
            repairedFromIndex: i,
            resumeIndex: i,
            stateTrajectory: trajectory,
            description: `Dời slot cuối ${i} đi ${shiftMin > 0 ? '+' : ''}${shiftMin} phút`
          });
          continue;
        }

        // 3. Tái tối ưu suffix từ i + 1 trở đi (đã bao gồm Night Constraint cho suffix)
        const repaired = this.repairSuffix(mutated, i + 1, ctx);
        if (!repaired) continue;

        // 4. Kiểm tra toàn vẹn vĩ mô + cache trajectory (Bug 1 fix)
        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) continue;

        // 5. Trích xuất metadata affectedSlotIds
        const changedSlotIds: string[] = [];
        for (let j = i; j < plan.length; j++) {
          const originalSlot = plan[j]!;
          const newSlot = repaired[j]!;

          if (originalSlot.plannedStart !== newSlot.plannedStart ||
            originalSlot.plannedEnd !== newSlot.plannedEnd) {
            changedSlotIds.push(newSlot.slotId);
          }
        }

        results.push({
          newPlan: repaired,
          operator: 'TIME_SHIFT',
          affectedSlotIds: [anchor.slotId],
          repairedFromIndex: i,
          resumeIndex: i,
          stateTrajectory: trajectory,
          description: `Dời slot ${i} ${shiftMin > 0 ? '+' : ''}${shiftMin} phút và tái tối ưu suffix`,
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // OP-2 SWAP_ORDER
  // -------------------------------------------------------------------------

  /**
   * Đổi chỗ hai slot tham quan kề nhau trong cùng một ngày và tái lập lịch trình (packing).
   * 
   * Quy trình thực hiện:
   * 1. **Chuẩn hóa đầu vào**: Sắp xếp lại kế hoạch theo thời gian (`dayIndex` và `slotOrder`) 
   *    để đảm bảo tính kề nhau của các slot là chính xác.
   * 2. **Xác định ranh giới tương lai**: Tìm vị trí cuối cùng của các slot đã diễn ra 
   *    (status khác `planned`). Hàm chỉ thực hiện đổi chỗ cho các cặp slot nằm hoàn toàn 
   *    sau ranh giới này để bảo vệ tính toàn vẹn của lịch sử hành trình.
   * 3. **Hoán đổi & Tăng phiên bản**: Đổi chỗ hai slot kề nhau (nếu cùng `dayIndex`), 
   *    đồng thời tăng `version` của chúng để đánh dấu sự thay đổi thực thể.
   * 4. **Tái tối ưu (Repair)**: Gọi `repairSuffix` từ vị trí hoán đổi để tính toán lại 
   *    toàn bộ mốc thời gian phía sau (bao gồm cả việc xử lý Travel Time mới giữa hai điểm vừa đổi).
   * 5. **Mô phỏng khả thi**: Sử dụng `allFeasible` (với cơ chế bỏ qua dữ liệu cũ) để đảm bảo 
   *    thao tác đổi chỗ không vi phạm các ràng buộc cứng về thời gian, ngân sách hay sức khỏe.
   * 6. **Thu thập Metadata**: Trích xuất tất cả các `slotId` bị ảnh hưởng bởi việc dồn lịch 
   *    để báo cáo chính xác cho phía Frontend.
   * 
   * @param plan Danh sách các {@link TripSlot} hiện tại.
   * @param ctx  Ngữ cảnh {@link ReplanContext} chứa dữ liệu dự báo và trạng thái xuất phát.
   * @returns    Danh sách các phương án hoán đổi thứ tự khả thi.
   */
  swapOrder(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    // 1. Phòng vệ: Đảm bảo mảng đầu vào luôn được sắp xếp chuẩn
    // theo ngày và thứ tự slot trước khi thực hiện logic liền kề (adjacent).
    const sortedPlan = [...plan].sort((x, y) => {
      if (x.dayIndex !== y.dayIndex) return x.dayIndex - y.dayIndex;
      return x.slotOrder - y.slotOrder;
    });

    // 2. Chốt vị trí cuối cùng không ở trạng thái 'planned'
    let lastNonPlannedIndex = -1;
    for (let k = sortedPlan.length - 1; k >= 0; k--) {
      if (sortedPlan[k]!.status !== 'planned') {
        lastNonPlannedIndex = k;
        break;
      }
    }

    for (let i = 0; i < sortedPlan.length - 1; i++) {
      if (i <= lastNonPlannedIndex) continue;

      const a = sortedPlan[i]!;
      const b = sortedPlan[i + 1]!;

      if (a.isLocked || b.isLocked) continue;
      if (a.dayIndex !== b.dayIndex) continue;

      const mutated = sortedPlan.map((slot) => ({ ...slot }));

      // 3. Xử lý Version: Chủ động tăng version cho hai slot bị thao tác trực tiếp.
      mutated[i] = { ...b, slotOrder: a.slotOrder, version: b.version + 1 };
      mutated[i + 1] = { ...a, slotOrder: b.slotOrder, version: a.version + 1 };

      const repaired = this.repairSuffix(mutated, i, ctx);
      if (!repaired) continue;

      const trajectory = this.simulateIfFeasible(repaired, ctx);
      if (!trajectory) continue;

      const originalSuffixIds = sortedPlan.slice(i).map(s => s.slotId);
      const newSuffixIds = repaired.slice(i).map(s => s.slotId);
      const affectedSlotIds = Array.from(new Set([...originalSuffixIds, ...newSuffixIds]));

      results.push({
        newPlan: repaired,
        operator: 'SWAP_ORDER',
        affectedSlotIds: affectedSlotIds,
        repairedFromIndex: i,
        resumeIndex: i,
        stateTrajectory: trajectory,
        description: `Đổi chỗ hai slot kề nhau ở vị trí ${i} và ${i + 1}, rồi repair toàn suffix`,
      });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // OP-3 REPLACE_PLACE
  // -------------------------------------------------------------------------

  /**
   * Thử thay thế từng địa điểm tham quan hiện có bằng các phương án tốt nhất từ danh sách ứng viên.
   * 
   * Đây là toán tử quan trọng nhất cho việc xử lý các tình huống thay đổi lộ trình đột xuất 
   * (ví dụ: đổi từ điểm ngoài trời sang điểm trong nhà khi thời tiết xấu).
   * 
   * Quy trình thực hiện cho mỗi slot:
   * 1. **Bảo vệ lịch sử**: Chỉ xem xét thay thế các slot có loại hoạt động là `sightseeing`/`activity` 
   *    và đang ở trạng thái `planned` hoặc `replaced`. Các slot đã diễn ra (`completed`) hoặc 
   *    bị bỏ qua (`skipped`) sẽ được giữ nguyên tuyệt đối để bảo toàn tính toàn vẹn dữ liệu.
   * 2. **Lọc & Xếp hạng ứng viên**: Tìm các địa điểm chưa có trong kế hoạch hiện tại, tính điểm 
   *    ưu tiên dựa trên độ tương đồng (tags), thời lượng tham quan và các yêu cầu từ ngữ cảnh. 
   *    Chỉ lấy tối đa `MAX_REPLACE_CANDIDATES` ứng viên có điểm cao nhất.
   * 3. **Thay thế an toàn**: Sử dụng `replaceSlotPlace` để tạo ra slot mới. Mọi lỗi dữ liệu phát sinh 
   *    (như sai định dạng ngày tháng) sẽ được bắt giữ (`try-catch`) để bỏ qua ứng viên lỗi 
   *    thay vì dừng toàn bộ tiến trình.
   * 4. **Tái tối ưu (Repair)**: Gọi `repairSuffix` từ vị trí vừa thay thế để dồn lịch (pack) 
   *    và tính toán lại toàn bộ mốc thời gian dựa trên thời gian di chuyển (Travel Time) mới.
   * 5. **Thẩm định khả thi**: Chạy mô phỏng qua `allFeasible` (đã bỏ qua dữ liệu cũ) để đảm bảo 
   *    phương án mới tuân thủ các ràng buộc về ngân sách, thời gian và sức khoẻ người dùng.
   * 6. **Metadata**: Ghi nhận danh sách `affectedSlotIds` để hệ thống Frontend có thể nhận diện 
   *    và hiển thị chính xác những slot bị thay đổi mốc thời gian do việc dồn lịch.
   * 
   * @param plan Danh sách các {@link TripSlot} hiện tại.
   * @param ctx  Ngữ cảnh {@link ReplanContext} chứa dữ liệu ứng viên và trạng thái mô phỏng.
   * @returns    Danh sách các phương án thay thế địa điểm khả thi.
   */
  replacePlace(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    // Tối ưu 1: Tính toán tập hợp các địa điểm đã chiếm dụng một lần duy nhất
    const occupied = new Set(plan.map((s) => s.placeId));

    for (let i = 0; i < plan.length; i++) {
      const currentSlot = plan[i]!;

      if (currentSlot.isLocked) continue;

      // Ràng buộc trạng thái
      if (currentSlot.status !== 'planned' && currentSlot.status !== 'replaced') {
        continue;
      }

      // Tối ưu 2: Cho phép currentPlace là undefined để tránh kẹt lịch trình
      const currentPlace = ctx.placeMap?.get(currentSlot.placeId) ?? ctx.candidatePool.find((p) => p.placeId === currentSlot.placeId);

      // Skip meal/transport/rest slots — trừ khi slot là outdoor và đang mưa nặng
      const isRaining = (ctx as BeamSearchContext).weatherForecast?.some(w => (w?.rainMmPerH ?? 0) >= 5) ?? false;
      const isOutdoor = currentPlace?.indoorOutdoor === 'outdoor';
      const isReplaceable = currentSlot.activityType === 'sightseeing' || currentSlot.activityType === 'activity';
      if (!isReplaceable && !(isRaining && isOutdoor)) {
        continue;
      }

      const candidates = ctx.candidatePool
        .filter((p) => !occupied.has(p.placeId))
        .map((p) => ({
          place: p,
          // Truyền currentPlace (có thể undefined), hàm candidatePriority đã hỗ trợ
          score: MutationOperators.candidatePriority(p, currentPlace, ctx),
        }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_REPLACE_CANDIDATES);

      for (const { place: alt } of candidates) {
        const mutated = plan.map((slot) => ({ ...slot }));

        try {
          mutated[i] = this.replaceSlotPlace(mutated[i]!, alt);
        } catch (e) {
          continue;
        }

        // LB feasibility: skip if no ordering of the new place set can fit in budget/time.
        // Uses MST(Haversine)/v_max lower bound; cache hit rate is high when many orderings
        // share the same set S. Avoids the expensive repairSuffix + computeTrajectory path.
        const newPlaces = mutated.map((s) => ctx.placeMap?.get(s.placeId)).filter((p): p is Place => p !== undefined);
        if (!isSetFeasible(newPlaces, ctx)) continue;

        const repaired = this.repairSuffix(mutated, i, ctx);
        if (!repaired) continue;

        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) continue;

        const affectedIds = new Set<string>();
        affectedIds.add(currentSlot.slotId);

        for (let j = i + 1; j < repaired.length; j++) {
          const oldSlot = plan[j];
          const newSlot = repaired[j];

          if (
            oldSlot &&
            newSlot &&
            (oldSlot.plannedStart !== newSlot.plannedStart ||
              oldSlot.plannedEnd !== newSlot.plannedEnd ||
              oldSlot.dayIndex !== newSlot.dayIndex)
          ) {
            affectedIds.add(newSlot.slotId);
          }
        }

        const currentPlaceName = currentPlace?.name || `Địa điểm cũ (ID: ${currentSlot.placeId})`;

        results.push({
          newPlan: repaired,
          operator: 'REPLACE_PLACE',
          affectedSlotIds: Array.from(affectedIds),
          repairedFromIndex: i,
          resumeIndex: i,
          stateTrajectory: trajectory,
          description: `Thay ${currentPlaceName} bằng ${alt.name} và tái lập lịch phần còn lại`,
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // OP-4 DROP_SLOT
  // -------------------------------------------------------------------------

  /**
   * Loại bỏ một slot (ngoại trừ bữa ăn) khỏi kế hoạch và tự động dồn lại lịch trình cho phần còn lại.
   * 
   * Mặc dù việc xoá slot thường làm lỏng các ràng buộc về thời gian và ngân sách, 
   * nhưng việc "nén" lịch (re-packing) qua repairSuffix có thể khiến các slot phía sau 
   * rơi vào khung giờ không hợp lệ (ví dụ: trước giờ mở cửa), nên vẫn cần kiểm tra 
   * tính khả thi toàn diện qua allFeasible.
   *
   * @param plan Danh sách các {@link TripSlot} hiện tại.
   * @param ctx  Ngữ cảnh replan để thực hiện tính toán lại lịch trình và kiểm tra ràng buộc.
   * @returns    Danh sách các {@link MutationResult} tiềm năng.
   */
  dropSlot(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;

      if (slot.isLocked) continue;
      // không cho phép xoá bữa ăn và các slot đã diễn ra, đã bị skip
      if (slot.activityType === 'meal') continue;
      if (slot.status === 'completed' || slot.status === 'skipped') continue;

      // 1. Chỉ lọc bỏ slot hiện tại, chưa vội đánh lại slotOrder
      const mutated = plan.filter((_, idx) => idx !== i).map((s) => ({ ...s }));

      let repaired: TripSlot[] | null = mutated;
      let isSuffixRepaired = false;

      // 2. Gọi repairSuffix nếu không phải là xoá slot cuối cùng
      if (i < mutated.length) {
        repaired = this.repairSuffix(mutated, i, ctx);
        isSuffixRepaired = true;
      }

      if (!repaired) continue;

      // 3. Cập nhật lại slotOrder cục bộ theo từng ngày (dayIndex)
      // Giả định: mảng repaired vẫn đang giữ đúng thứ tự thời gian tuyến tính
      const dayCounters = new Map<number, number>();
      for (const s of repaired) {
        const currentOrder = dayCounters.get(s.dayIndex) ?? 0;
        s.slotOrder = currentOrder;
        dayCounters.set(s.dayIndex, currentOrder + 1);
      }

      const trajectory = this.simulateIfFeasible(repaired, ctx);
      if (!trajectory) continue;

      results.push({
        newPlan: repaired,
        operator: 'DROP_SLOT',
        affectedSlotIds: [slot.slotId],
        ...(isSuffixRepaired && { repairedFromIndex: i }),
        resumeIndex: i,
        stateTrajectory: trajectory,
        description: isSuffixRepaired
          ? `Bỏ slot ${i} (${slot.activityType}) rồi dồn lại toàn bộ suffix`
          : `Bỏ slot ${i} (${slot.activityType}) ở cuối kế hoạch`,
      });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // OP-5 INSERT_ALT
  // -------------------------------------------------------------------------

  /**
   * Thử nghiệm chèn thêm một địa điểm mới (POI) vào kế hoạch tại các vị trí khả thi trong tương lai.
   * 
   * Đây là toán tử biến đổi (mutation operator) mạnh nhất, cho phép linh hoạt bổ sung địa điểm 
   * vào lộ trình mà vẫn đảm bảo tính đúng đắn về mặt thời gian và thứ tự.
   * 
   * Các cải tiến và cơ chế kiểm soát chính:
   * 1. **Lọc địa điểm ứng viên**: 
   *    - Loại bỏ các địa điểm đã tồn tại trong kế hoạch (bao gồm cả các slot đã hoàn thành hoặc đã skip).
   *    - Nếu địa điểm bắt buộc (`forceIncludePlaceId`) đã có trong kế hoạch, thao tác sẽ bị hủy để tránh trùng lặp.
   * 2. **Xác định ranh giới an toàn (`startPos`)**: 
   *    - Thuật toán tự động tìm kiếm vị trí an toàn đầu tiên để chèn (bỏ qua các slot đã diễn ra 
   *      hoặc đang thực hiện) để không làm xáo trộn dữ liệu lịch sử.
   * 3. **Quản lý thứ tự (`slotOrder`)**: 
   *    - Sau khi chèn, hệ thống tự động đánh lại số thứ tự `slotOrder` cho toàn bộ các slot phía sau.
   *    - Logic này tôn trọng ranh giới ngày (`dayIndex`), reset `slotOrder` về 0 khi bắt đầu ngày mới.
   * 4. **Ràng buộc thời gian thực**: 
   *    - Kiểm tra mốc `plannedStart` của slot mới so với `capturedAt` (thời điểm replan).
   *    - Loại bỏ các phương án mà thời gian di chuyển khiến hoạt động bị đẩy về quá khứ.
   * 5. **Kiểm soát hiệu năng**: 
   *    - Giới hạn tối đa `MAX_RESULTS_LIMIT` (20) kết quả để tránh bùng nổ tổ hợp trong Beam Search.
   * 
   * @param plan Danh sách các {@link TripSlot} hiện tại.
   * @param ctx Ngữ cảnh {@link ReplanContext} để thực hiện tính toán và kiểm tra ràng buộc.
   * @returns Danh sách các {@link MutationResult} đại diện cho các phương án chèn khả thi và tối ưu.
   */
  insertAlt(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const results: MutationResult[] = [];
    const MAX_RESULTS_LIMIT = 20;

    const occupied = new Set(
      plan.filter(s => s.status === 'planned' || s.status === 'completed' || s.status === 'skipped' || s.status === 'replaced')
        .map(s => s.placeId)
    );

    let insertable: Place[];
    if (ctx.forceIncludePlaceId !== undefined) {
      if (occupied.has(ctx.forceIncludePlaceId)) {
        insertable = [];
      } else {
        const forced = ctx.candidatePool.find((p) => p.placeId === ctx.forceIncludePlaceId);
        insertable = forced ? [forced] : [];
      }
    } else {
      insertable = ctx.candidatePool
        .filter((p) => !occupied.has(p.placeId))
        .map((p) => ({
          place: p,
          score: MutationOperators.candidatePriority(p, undefined, ctx),
        }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_INSERT_CANDIDATES)
        .map((x) => x.place);
    }

    if (insertable.length === 0) return results;

    // [FIX 2] Tìm ranh giới: Slot cuối cùng không phải 'planned', HOẶC 'planned' nhưng đã bắt đầu
    let startPos = 0;
    for (let i = plan.length - 1; i >= 0; i--) {
      const slot = plan[i];
      if (slot.status !== 'planned' || (slot.status === 'planned' && slot.actualStart !== null)) {
        startPos = i + 1;
        break;
      }
    }

    const capturedAtTime = new Date(ctx.initialState.capturedAt).getTime();

    for (const place of insertable) {
      for (let pos = startPos; pos <= plan.length; pos++) {
        if (results.length >= MAX_RESULTS_LIMIT) return results;

        const newSlot = this.synthesizeSlot(place, plan, pos, ctx);

        const mutated = [
          ...plan.slice(0, pos).map((s) => ({ ...s })),
          newSlot,
          ...plan.slice(pos).map((s) => ({ ...s })),
        ];

        // LB feasibility: new set includes the inserted place.
        const newPlaces = mutated.map((s) => ctx.placeMap?.get(s.placeId)).filter((p): p is Place => p !== undefined);
        if (!isSetFeasible(newPlaces, ctx)) continue;

        const repaired = this.repairSuffix(mutated, pos, ctx);
        if (!repaired) continue;

        let currentDay = pos > 0 ? repaired[pos - 1]!.dayIndex : (repaired[0]?.dayIndex ?? 0);
        let currentOrder = pos > 0 ? repaired[pos - 1]!.slotOrder + 1 : 0;

        for (let i = pos; i < repaired.length; i++) {
          if (repaired[i]!.dayIndex !== currentDay) {
            currentDay = repaired[i]!.dayIndex;
            currentOrder = 0;
          }
          repaired[i]!.slotOrder = currentOrder++;
        }

        const slotStartTime = new Date(repaired[pos]!.plannedStart).getTime();
        if (slotStartTime < capturedAtTime) continue;

        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) continue;

        const affectedIds: string[] = [repaired[pos]!.slotId];
        for (let j = pos; j < plan.length; j++) {
          const origSlot = plan[j]!;
          const repairedSlot = repaired[j + 1];
          if (
            repairedSlot &&
            (origSlot.plannedStart !== repairedSlot.plannedStart ||
              origSlot.plannedEnd !== repairedSlot.plannedEnd)
          ) {
            affectedIds.push(repairedSlot.slotId);
          }
        }

        results.push({
          newPlan: repaired,
          operator: 'INSERT_ALT',
          affectedSlotIds: affectedIds,
          repairedFromIndex: pos,
          resumeIndex: pos,
          stateTrajectory: trajectory,
          description: `Chèn ${place.name} ở vị trí ${pos} và tái tối ưu suffix`,
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // OP-6 TSP_REORDER
  // -------------------------------------------------------------------------

  /**
   * Reorders slots within each day to minimize total travel time using 2-opt.
   *
   * Models an open-path TSP (fixed start, no return): the day begins from the
   * user's current position (or end of the previous day's last slot) and visits
   * all slots in the cheapest order without looping back.
   *
   * Only applied when a day has ≥ 3 slots — swapOrder already covers the 2-slot case.
   * Returns at most one MutationResult (the globally reordered plan).
   */
  tspReorder(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();

    const sorted = [...plan].sort((a, b) =>
      a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : a.slotOrder - b.slotOrder,
    );

    const dayGroups = new Map<number, TripSlot[]>();
    for (const slot of sorted) {
      if (!dayGroups.has(slot.dayIndex)) dayGroups.set(slot.dayIndex, []);
      dayGroups.get(slot.dayIndex)!.push(slot);
    }

    let changed = false;
    const newByDay = new Map<number, TripSlot[]>();

    let startLat = ctx.initialState.currentLat ?? 0;
    let startLng = ctx.initialState.currentLng ?? 0;

    for (const [dayIdx, daySlots] of [...dayGroups.entries()].sort(([a], [b]) => a - b)) {
      // Skip reorder if any slot in the day is locked (locked slots must stay at their fixed time)
      // or if any slot is completed/skipped (must preserve historical timestamps).
      if (daySlots.some(s => s.isLocked) || daySlots.some(s => s.status === 'completed' || s.status === 'skipped')) {
        newByDay.set(dayIdx, daySlots.map((s, i) => ({ ...s, slotOrder: i })));
        const lp = daySlots[daySlots.length - 1] ? placeMap.get(daySlots[daySlots.length - 1]!.placeId) : null;
        if (lp) { startLat = lp.lat; startLng = lp.lng; }
        continue;
      }
      if (daySlots.length < 2) {
        newByDay.set(dayIdx, daySlots.map((s, i) => ({ ...s, slotOrder: i })));
        const lp = daySlots[0] ? placeMap.get(daySlots[0].placeId) : null;
        if (lp) { startLat = lp.lat; startLng = lp.lng; }
        continue;
      }

      // 2-slot day: compare both orderings directly (2-opt handles ≥3 below)
      if (daySlots.length === 2) {
        const [s0, s1] = [daySlots[0]!, daySlots[1]!];
        const p0 = placeMap.get(s0.placeId);
        const p1 = placeMap.get(s1.placeId);
        if (!p0 || !p1) {
          newByDay.set(dayIdx, [{ ...s0, slotOrder: 0 }, { ...s1, slotOrder: 1 }]);
          if (p1) { startLat = p1.lat; startLng = p1.lng; }
          continue;
        }
        const costOriginal = this.evolver.estimateTravelTime(startLat, startLng, p0.lat, p0.lng)
          + this.evolver.estimateTravelTime(p0.lat, p0.lng, p1.lat, p1.lng);
        const costSwapped  = this.evolver.estimateTravelTime(startLat, startLng, p1.lat, p1.lng)
          + this.evolver.estimateTravelTime(p1.lat, p1.lng, p0.lat, p0.lng);
        if (costSwapped < costOriginal - 0.01) {
          newByDay.set(dayIdx, [{ ...s1, slotOrder: 0 }, { ...s0, slotOrder: 1 }]);
          changed = true;
          startLat = p0.lat;
          startLng = p0.lng;
        } else {
          newByDay.set(dayIdx, [{ ...s0, slotOrder: 0 }, { ...s1, slotOrder: 1 }]);
          startLat = p1.lat;
          startLng = p1.lng;
        }
        continue;
      }

      const places = daySlots.map(s => placeMap.get(s.placeId));
      if (places.some(p => !p)) {
        // Unknown place → keep original order for this day
        newByDay.set(dayIdx, daySlots.map((s, i) => ({ ...s, slotOrder: i })));
        continue;
      }

      const validPlaces = places as Place[];
      const optOrder = this.twoOpt(startLat, startLng, validPlaces);

      if (!optOrder.every((v, i) => v === i)) changed = true;

      newByDay.set(dayIdx, optOrder.map((placeIdx, slotOrder) => ({
        ...daySlots[placeIdx]!,
        slotOrder,
      })));

      const lastPlace = validPlaces[optOrder[optOrder.length - 1]!]!;
      startLat = lastPlace.lat;
      startLng = lastPlace.lng;
    }

    if (!changed) return [];

    // repairSuffix uses Math.max(cursor + travel, originalStartMs) to anchor each slot to its
    // original time. When TSP moves a late-starting slot (e.g. originally 10:30) to first
    // position, repairSuffix would anchor the whole day at 10:30 instead of 8:00, wasting
    // the morning. Fix: pin the first slot of each day to the EARLIEST original start on that
    // day so repairSuffix packs from the correct morning anchor.
    const dayEarliestMs = new Map<number, number>();
    for (const slot of plan) {
      const ms = new Date(slot.plannedStart).getTime();
      const cur = dayEarliestMs.get(slot.dayIndex) ?? Infinity;
      if (ms < cur) dayEarliestMs.set(slot.dayIndex, ms);
    }

    const reordered: TripSlot[] = [];
    for (const [dayIdx, slots] of [...newByDay.entries()].sort(([a], [b]) => a - b)) {
      const earliestMs = dayEarliestMs.get(dayIdx) ?? new Date(slots[0]!.plannedStart).getTime();
      reordered.push(...slots.map((s, i) => {
        if (i !== 0) return s;
        const place = placeMap.get(s.placeId);
        const durationMs = Math.max(
          MIN_SLOT_DURATION_MIN * 60_000,
          (place?.avgVisitDurationMin ?? 0) * 60_000,
        );
        return {
          ...s,
          plannedStart: new Date(earliestMs).toISOString(),
          plannedEnd: new Date(earliestMs + durationMs).toISOString(),
        };
      }));
    }

    const repaired = this.repairSuffix(reordered, 0, ctx);
    if (!repaired) return [];

    const trajectory = this.simulateIfFeasible(repaired, ctx);
    if (!trajectory) return [];

    const origById = new Map(plan.map(s => [s.slotId, s]));
    const affectedSlotIds = repaired
      .filter(s => {
        const orig = origById.get(s.slotId);
        return orig && orig.slotOrder !== s.slotOrder;
      })
      .map(s => s.slotId);

    return [{
      newPlan: repaired,
      operator: 'TSP_REORDER',
      affectedSlotIds: affectedSlotIds.length > 0 ? affectedSlotIds : plan.map(s => s.slotId),
      repairedFromIndex: 0,
      resumeIndex: 0,
      stateTrajectory: trajectory,
      description: 'Tối ưu thứ tự tham quan để giảm tổng quãng đường di chuyển trong ngày',
    }];
  }

  /**
   * 2-opt for open TSP (fixed start, no return to origin).
   * Returns a permutation `order` where `places[order[i]]` is visited at step i.
   * Applies iterative edge-swap improvements until no gain > 0.01 min remains.
   */
  private twoOpt(startLat: number, startLng: number, places: Place[]): number[] {
    const n = places.length;
    const order = Array.from({ length: n }, (_, i) => i);

    // from < 0 means "start position"
    const d = (from: number, to: number): number =>
      this.evolver.estimateTravelTime(
        from < 0 ? startLat : places[from]!.lat,
        from < 0 ? startLng : places[from]!.lng,
        places[to]!.lat,
        places[to]!.lng,
      );

    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const prevI = i === 0 ? -1 : order[i - 1]!;
          const hasAfter = j < n - 1;
          // gain = (edges removed) - (edges added) after reversing order[i..j]
          const gain =
            d(prevI, order[i]!) + (hasAfter ? d(order[j]!, order[j + 1]!) : 0)
            - d(prevI, order[j]!) - (hasAfter ? d(order[i]!, order[j + 1]!) : 0);
          if (gain > 0.01) {
            let lo = i, hi = j;
            while (lo < hi) {
              [order[lo], order[hi]] = [order[hi]!, order[lo]!];
              lo++; hi--;
            }
            improved = true;
          }
        }
      }
    }

    return order;
  }

  // -------------------------------------------------------------------------
  // generateAll
  // -------------------------------------------------------------------------

  /**
   * Tổng hợp và thực thi tất cả các toán tử biến đổi (mutation operators) để tạo ra các phương án thay đổi lộ trình.
   * 
   * Hàm này đóng vai trò là "trạm điều phối" trung tâm, kết hợp kết quả từ 5 loại toán tử khác nhau
   * để tìm ra các biến thể khả thi nhất cho kế hoạch hiện tại.
   * 
   * Thứ tự ưu tiên và các toán tử được thực hiện:
   * 1. **TIME_SHIFT (OP-1)**: Dịch chuyển mốc thời gian của các slot hiện có.
   * 2. **SWAP_ORDER (OP-2)**: Hoán đổi thứ tự giữa các địa điểm kề nhau trong cùng một ngày.
   * 3. **REPLACE_PLACE (OP-3)**: Thay thế một địa điểm hiện tại bằng một địa điểm ứng viên tốt hơn.
   * 4. **DROP_SLOT (OP-4)**: Loại bỏ một địa điểm khỏi kế hoạch để giảm tải lịch trình.
   * 5. **INSERT_ALT (OP-5)**: Chèn thêm một địa điểm mới từ danh sách ứng viên vào lộ trình.
   * 
   * Quy trình xử lý kết quả (Chống Starvation):
   * - **Trộn luân phiên (Round-Robin)**: Thu thập và xen kẽ kết quả từ các toán tử để đảm bảo tính đa dạng.
   * - **Lọc trùng (Deduplication)**: Sử dụng {@link dedupeResults} để loại bỏ các phương án có cấu trúc giống nhau.
   * - **Giới hạn (Cap)**: Cắt kết quả theo {@link GENERATE_ALL_CAP} để tối ưu hiệu năng cho Beam Search.
   * 
   * @param plan Danh sách các {@link TripSlot} hiện tại đã được sắp xếp theo thứ tự thời gian.
   * @param ctx Ngữ cảnh {@link ReplanContext} chứa toàn bộ dữ liệu ứng viên, dự báo và trạng thái mô phỏng.
   * @returns Danh sách tối đa các {@link MutationResult} đại diện cho các hướng đi mới của lộ trình.
   */
  generateAll(plan: TripSlot[], ctx: ReplanContext): MutationResult[] {
    // Empty plan: no slots to mutate or anchor insertions off.
    if (plan.length === 0) return [];

    // 1. Thực thi độc lập và thu thập kết quả từ tất cả các toán tử
    const timeShifts = this.timeShift(plan, ctx);
    const swaps = this.swapOrder(plan, ctx);
    const replaces = this.replacePlace(plan, ctx);
    const drops = this.dropSlot(plan, ctx);
    const inserts = this.insertAlt(plan, ctx);
    const tspReorders = this.tspReorder(plan, ctx);

    // 2. Trộn kết quả theo chiến lược Round-Robin để chống "Operator Starvation"
    const operatorOutputs = [timeShifts, swaps, replaces, drops, inserts, tspReorders];
    const allMerged: MutationResult[] = [];

    let hasMore = true;
    let index = 0;

    while (hasMore) {
      hasMore = false;
      for (const output of operatorOutputs) {
        if (index < output.length) {
          allMerged.push(output[index]);
          hasMore = true; // Vẫn còn ít nhất 1 toán tử có kết quả ở vị trí này
        }
      }
      index++;
    }

    // 3. Lọc các phương án trùng lặp về cấu trúc
    const deduped = this.dedupeResults(allMerged);

    // 4. Cắt mảng theo giới hạn hằng số (Đảm bảo GENERATE_ALL_CAP đã được khai báo)
    return deduped.slice(0, GENERATE_ALL_CAP);
  }

  /**
   * UCB1-bandit variant of generateAll.
   *
   * Instead of round-robin interleaving, each operator receives an explicit
   * slot budget from the caller (typically from UCB1Bandit.allocate()).
   * Returns the actual count taken from each operator so the bandit can
   * compute rewards after beam selection.
   */
  generateAllAdaptive(
    plan: TripSlot[],
    ctx: ReplanContext,
    allocation: Map<OperatorName, number>,
  ): { candidates: MutationResult[]; generatedCounts: Map<OperatorName, number> } {
    const operatorFns: [OperatorName, () => MutationResult[]][] = [
      ['TIME_SHIFT',    () => this.timeShift(plan, ctx)],
      ['SWAP_ORDER',    () => this.swapOrder(plan, ctx)],
      ['REPLACE_PLACE', () => this.replacePlace(plan, ctx)],
      ['DROP_SLOT',     () => this.dropSlot(plan, ctx)],
      ['INSERT_ALT',    () => this.insertAlt(plan, ctx)],
      ['TSP_REORDER',   () => this.tspReorder(plan, ctx)],
    ];

    const allCandidates: MutationResult[] = [];
    const generatedCounts = new Map<OperatorName, number>();

    for (const [op, fn] of operatorFns) {
      const budget = allocation.get(op) ?? 0;
      if (budget <= 0) {
        generatedCounts.set(op, 0);
        continue;
      }
      const taken = fn().slice(0, budget);
      allCandidates.push(...taken);
      generatedCounts.set(op, taken.length);
    }

    return {
      candidates: allCandidates.slice(0, GENERATE_ALL_CAP),
      generatedCounts,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Tạo ra một bản sao của {@link TripSlot} với thời gian bắt đầu và kết thúc 
   * được dịch chuyển một khoảng thời gian nhất định.
   * 
   * Hàm này thực hiện dịch chuyển mốc thời gian (time shift) mà không làm thay đổi 
   * độ dài (duration) của slot hoặc các thuộc tính khác.
   * 
   * Các đặc điểm chính:
   * 1. **An toàn dữ liệu**: Kiểm tra tính hợp lệ của chuỗi ngày tháng đầu vào để tránh crash ứng dụng.
   * 2. **Dịch chuyển linh hoạt**: Hỗ trợ cả số dương (lùi giờ lại sau) và số âm (đẩy giờ lên sớm hơn).
   * 3. **Bảo toàn cấu trúc**: Các trường dữ liệu khác của slot được giữ nguyên thông qua spread operator.
   * 
   * @param slot Đối tượng {@link TripSlot} gốc cần dịch chuyển.
   * @param minutes Số phút cần dịch chuyển (dương = muộn hơn, âm = sớm hơn).
   * @returns Một {@link TripSlot} mới đã được cập nhật mốc thời gian.
   */
  private shiftSlot(slot: TripSlot, minutes: number): TripSlot {
    const shiftMs = Math.round(minutes * 60_000);

    // Hàm helper để parse và tính toán an toàn
    const shiftDateString = (dateStr: string): string => {
      // Nếu không có dữ liệu, trả về nguyên bản để không làm sai lệch format gốc
      if (!dateStr) return dateStr;

      const dateObj = new Date(dateStr);

      // 2. Kiểm tra tính hợp lệ của ngày tháng trước khi gọi toISOString()
      if (isNaN(dateObj.getTime())) {
        console.warn(`[shiftSlot] Invalid date string: ${dateStr}`);
        return dateStr; // Trả về chuỗi gốc thay vì crash app
      }

      return new Date(dateObj.getTime() + shiftMs).toISOString();
    };

    return {
      ...slot,
      plannedStart: shiftDateString(slot.plannedStart),
      plannedEnd: shiftDateString(slot.plannedEnd),
    };
  }

  /**
   * Kiểm tra xem khung giờ tham quan của một slot có nằm trong giờ mở cửa của địa điểm hay không.
   * 
   * Hàm này thực hiện các tính toán phức tạp liên quan đến thời gian và múi giờ để đảm bảo 
   * tính thực tế của kế hoạch du lịch.
   * 
   * Các quy tắc kiểm tra chính:
   * 1. **Múi giờ**: Toàn bộ việc so sánh được quy đổi về giờ địa phương Việt Nam (UTC+7).
   * 2. **Thứ trong tuần**: Sử dụng quy ước 0 = Thứ Hai, 6 = Chủ Nhật để khớp với dữ liệu DB.
   * 3. **Xử lý Midnight (Vắt qua nửa đêm)**: 
   *    - Nếu slot kết thúc sau 24:00 của ngày bắt đầu, hệ thống yêu cầu ngày hôm nay phải mở cửa 
   *      đến sát nửa đêm (23:59/24:00) và ngày mai phải mở cửa ngay từ 00:00.
   *    - Thời gian dư ra của slot phải nằm trong khung giờ mở cửa của ngày kế tiếp.
   * 4. **Chuẩn hóa dữ liệu**: Tự động chuyển đổi các mốc "23:59" hoặc "24:00" thành phút thứ 1440 
   *    để thực hiện các phép toán so sánh liên tục.
   * 5. **Trường hợp ngoại lệ**: Nếu địa điểm không có thông tin giờ mở cửa, hàm mặc định trả về `true`.
   * 
   * @param slot Đối tượng {@link TripSlot} cần kiểm tra.
   * @param ctx Ngữ cảnh {@link ReplanContext} cung cấp dữ liệu địa điểm từ candidatePool.
   * @returns `true` nếu khung giờ hợp lệ hoặc không có dữ liệu ràng buộc, ngược lại là `false`.
   */
  /**
   * Core opening-hours check against an already-resolved Place.
   * Called directly from repairSuffix (which already holds the place from its placeMap)
   * to avoid a redundant O(P) candidatePool.find() per slot.
   */
  private checkOpeningHours(slot: TripSlot, place: Place): boolean {
    if (place.openingHours.length === 0) return true;

    const startLocalMs = new Date(slot.plannedStart).getTime() + VN_OFFSET_MS;
    const endLocalMs = new Date(slot.plannedEnd).getTime() + VN_OFFSET_MS;
    const startLocal = new Date(startLocalMs);

    const jsDay = startLocal.getUTCDay();
    const dayOfWeek = (jsDay + 6) % 7;

    const slotStartMin = startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes();
    const durationMs = endLocalMs - startLocalMs;
    const slotEndMin = slotStartMin + Math.floor(durationMs / 60000);

    const getHoursForDay = (day: number) => {
      const hours = place.openingHours.find((h) => h.dayOfWeek === day);
      if (!hours) return null;

      const [openH, openM] = hours.openTime.split(':').map(Number);
      const [closeH, closeM] = hours.closeTime.split(':').map(Number);

      const openMin = openH! * 60 + (openM ?? 0);
      let closeMin = closeH! * 60 + (closeM ?? 0);

      if (closeMin <= openMin) closeMin += 1440;
      if ((closeH === 23 && closeM === 59) || (closeH === 24 && closeM === 0)) closeMin = 1440;

      return { openMin, closeMin };
    };

    const todayHours = getHoursForDay(dayOfWeek);
    if (!todayHours) return false;

    return slotStartMin >= todayHours.openMin && slotEndMin <= todayHours.closeMin;
  }

  /** Delegates to checkOpeningHours after resolving the place from candidatePool. */
  private withinOpeningHours(slot: TripSlot, ctx: ReplanContext): boolean {
    const place = ctx.placeMap?.get(slot.placeId) ?? ctx.candidatePool.find((p) => p.placeId === slot.placeId);
    if (!place) return true;
    return this.checkOpeningHours(slot, place);
  }

  /**
   * Simulates the full trajectory for a plan and returns the states if every
   * intermediate state passes isFeasible(), or null if any constraint is violated.
   *
   * Replaces the old allFeasible() wrapper: instead of discarding the computed
   * states, we cache them in MutationResult.stateTrajectory so BeamSearch.search()
   * can reuse them without a second computeTrajectory() call (Bug 1 fix).
   *
   * Plans reaching this method contain only future `planned` slots (remainingSlots),
   * so computeTrajectory() and the old isPlanFeasible() are equivalent here.
   */
  private simulateIfFeasible(plan: TripSlot[], ctx: ReplanContext): TripState[] | null {
    // Guard: reject plans where a prefix slot can't reach a following LOCKED slot in time.
    // repairSuffix enforces this via line 1491 (cursorMs + travelMs > lockedStartMs → null),
    // but INSERT_ALT at pos > 0 calls repairSuffix only for the suffix (pos onwards), leaving
    // the prefix gap to a locked slot unchecked.  Only locked slots matter here — non-locked
    // suffix slots are always repacked by repairSuffix with the correct travel-time gap.
    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();
    for (let i = 0; i < plan.length - 1; i++) {
      const b = plan[i + 1]!;
      if (!b.isLocked) continue; // only care about gaps where the destination is immovable
      const a = plan[i]!;
      if (a.status === 'completed' || a.status === 'skipped') continue;
      const pA = placeMap.get(a.placeId);
      const pB = placeMap.get(b.placeId);
      if (!pA || !pB) continue;
      const travelMin = this.evolver.estimateTravelTime(pA.lat, pA.lng, pB.lat, pB.lng);
      const gapMs = new Date(b.plannedStart).getTime() - new Date(a.plannedEnd).getTime();
      // Allow 1 ms slack for floating-point truncation in toISOString() round-trips.
      if (gapMs + 1 < travelMin * 60_000) return null;
    }

    try {
      const states = this.evolver.computeTrajectory(plan, ctx.initialState, ctx);
      if (!states.slice(1).every((s) => this.evolver.isFeasible(s))) return null;
      return states;
    } catch {
      return null;
    }
  }

  /**
   * Counts the number of tag IDs shared between two places.
   * Returns 0 when either place has no tags.
   */
  private static tagOverlap(a: Place, b?: Place): number {
    if (!b) return 0;

    // Trích xuất tập hợp các ID duy nhất từ cả 'tagIds' và 'tags'
    const getUniqueTagIds = (place: Place): Set<number> => {
      const ids = new Set<number>(place.tagIds || []);
      if (place.tags?.length) {
        place.tags.forEach(t => ids.add(t.tagId));
      }
      return ids;
    };

    const aIds = getUniqueTagIds(a);
    const bIds = getUniqueTagIds(b);

    if (aIds.size === 0 || bIds.size === 0) return 0;

    // Đếm số lượng ID giao nhau
    let overlapCount = 0;
    aIds.forEach(id => {
      if (bIds.has(id)) overlapCount++;
    });

    return overlapCount;
  }

  /**
   * Khởi tạo (tổng hợp) một {@link TripSlot} mới cho một địa điểm tại một vị trí chỉ định trong kế hoạch.
   * 
   * Đây là hàm helper cốt lõi cho các thao tác INSERT_ALT, giúp dự đoán mốc thời gian 
   * và chi phí cho một địa điểm mới trước khi thực hiện các bước tối ưu hóa chuyên sâu.
   * 
   * Các chiến lược tính toán thời gian (Timing Strategies):
   * 1. **Chèn vào giữa hoặc cuối (`pos > 0`)**: Slot mới bắt đầu ngay sau khi slot phía trước (`prev`) 
   *    kết thúc cộng thêm thời gian di chuyển (Travel Time) từ `prev` đến `place`.
   * 2. **Chèn vào đầu (`pos = 0`)**: Slot mới được tính toán sao cho kết thúc vừa kịp để di chuyển 
   *    đến slot kế tiếp (`next`). Nếu thời gian bắt đầu bị đẩy về trước thời điểm hiện tại (`capturedAt`), 
   *    hệ thống sẽ tự động điều chỉnh mốc bắt đầu về `capturedAt`.
   * 3. **Kế hoạch rỗng**: Slot bắt đầu sau khi di chuyển từ vị trí hiện tại của người dùng 
   *    (từ `initialState`) đến địa điểm mới.
   * 
   * Các thuộc tính mặc định của Slot tổng hợp:
   * - **Thời lượng**: Lấy giá trị lớn nhất giữa `MIN_SLOT_DURATION_MIN` và thời gian tham quan trung bình của địa điểm.
   * - **Định danh**: Sinh `slotId` mới (UUID) để tránh xung đột dữ liệu.
   * - **Chi phí**: Ưu tiên sử dụng `estimatedCost`, sau đó là `minPrice` của địa điểm.
   * - **Trạng thái**: Luôn đặt là `'planned'` với `version: 1`.
   * 
   * @param place Địa điểm {@link Place} cần tạo slot.
   * @param plan Danh sách các {@link TripSlot} hiện tại.
   * @param pos Vị trí dự kiến chèn slot vào (0-indexed).
   * @param ctx Ngữ cảnh {@link ReplanContext} để truy cập trạng thái ban đầu và pool địa điểm.
   * @returns Một đối tượng {@link TripSlot} hoàn chỉnh đã được tính toán sơ bộ.
   */
  private synthesizeSlot(
    place: Place,
    plan: TripSlot[],
    pos: number,
    ctx: ReplanContext,
  ): TripSlot {
    const prev = pos > 0 ? plan[pos - 1] : undefined;
    const next = pos < plan.length ? plan[pos] : undefined;
    const getCoords = (placeId: number) => {
      const p = ctx.placeMap?.get(placeId) ?? ctx.candidatePool.find((c) => c.placeId === placeId);
      return p ? { lat: p.lat, lng: p.lng } : null;
    };
    const durationMs = Math.max(
      MIN_SLOT_DURATION_MIN * 60_000,
      place.avgVisitDurationMin * 60_000,
    );
    let travelTimeMin = 0;
    let plannedStartMs: number;
    let plannedEndMs: number;
    if (prev) {
      // Trường hợp 1: Chèn sau prev -> Đi từ prev đến place mới
      const prevCoords = getCoords(prev.placeId);
      if (prevCoords) {
        travelTimeMin = this.evolver.estimateTravelTime(
          prevCoords.lat, prevCoords.lng,
          place.lat, place.lng
        );
      }
      plannedStartMs = new Date(prev.plannedEnd).getTime() + (travelTimeMin * 60_000);
      plannedEndMs = plannedStartMs + durationMs;
    } else if (next) {
      // Trường hợp 2: Chèn vào đầu mảng (pos = 0) -> Đi từ place mới đến next
      const nextCoords = getCoords(next.placeId);
      if (nextCoords) {
        travelTimeMin = this.evolver.estimateTravelTime(
          place.lat, place.lng,
          nextCoords.lat, nextCoords.lng
        );
      }
      // Slot này phải kết thúc đủ sớm để kịp đi tới next
      plannedEndMs = new Date(next.plannedStart).getTime() - (travelTimeMin * 60_000);
      plannedStartMs = plannedEndMs - durationMs;

      // Đảm bảo không bị lùi về trước thời điểm hiện tại
      const minStart = new Date(ctx.initialState.capturedAt).getTime();
      if (plannedStartMs < minStart) {
        plannedStartMs = minStart;
        plannedEndMs = plannedStartMs + durationMs;
      }
    } else {
      // Trường hợp 3: Mảng rỗng -> Đi từ vị trí hiện tại của user đến place mới
      travelTimeMin = this.evolver.estimateTravelTime(
        ctx.initialState.currentLat ?? place.lat,
        ctx.initialState.currentLng ?? place.lng,
        place.lat, place.lng
      );
      plannedStartMs = new Date(ctx.initialState.capturedAt).getTime() + (travelTimeMin * 60_000);
      plannedEndMs = plannedStartMs + durationMs;
    }
    const dayIndex = prev?.dayIndex ?? next?.dayIndex ?? ctx.initialState.dayIndex;
    return {
      slotId: randomUUID(),
      tripId: ctx.initialState.tripId,
      dayIndex,
      slotOrder: pos,
      version: 1,
      placeId: place.placeId,
      plannedStart: new Date(plannedStartMs).toISOString(),
      plannedEnd: new Date(plannedEndMs).toISOString(),
      actualStart: null,
      actualEnd: null,
      estimatedCost: place.estimatedCost ?? place.minPrice ?? 0,
      activityType: 'sightseeing',
      rationale: null,
      status: 'planned',
    };
  }

  /**
   * Tính toán điểm ưu tiên (priority score) cho một địa điểm ứng viên.
   * Điểm này được dùng để xếp hạng và lựa chọn các địa điểm tốt nhất khi thực hiện 
   * các thao tác mutation như REPLACE_PLACE hoặc INSERT_ALT.
   * 
   * Các yếu tố cấu thành điểm số (tính tích lũy):
   * 1. Độ tương đồng (Tag Overlap): Mỗi tag chung với địa điểm tham chiếu (nếu có) được +10 điểm.
   * 2. Thời lượng tham quan: Tính theo công thức `duration / 10`, ưu tiên các địa điểm có 
   *    thời gian tham quan dài hơn, tối đa +12 điểm (tương đương mốc 120 phút).
   * 3. Trạng thái ưu tiên trong context:
   *    - Thuộc potentialPlaceIds (Địa điểm tiềm năng): +60 điểm.
   *    - Thuộc requiredPlaceIds (Địa điểm bắt buộc): +80 điểm.
   *    - Là forceIncludePlaceId (Địa điểm được chỉ định đích danh): +100 điểm.
   * 
   * @param candidate Địa điểm đang được xem xét (trả về 0 nếu undefined).
   * @param reference Địa điểm tham chiếu để so sánh tag (thường là địa điểm bị thay thế).
   * @param ctx Ngữ cảnh replan chứa các danh sách ưu tiên và cấu hình.
   * @returns Điểm số ưu tiên (số dương).
   */
  private static candidatePriority(
    candidate: Place,
    reference: Place | undefined,
    ctx: ReplanContext,
  ): number {
    if (!candidate) return 0;
    let score = 0;

    // When rain is active and the reference slot is outdoor (or absent), tag overlap
    // with the replaced place is meaningless (beach tags ≠ museum/restaurant tags).
    // Use user preference alignment instead so the best-fit indoor place wins.
    const isRaining = (ctx as BeamSearchContext)?.weatherForecast?.some(
      (w) => (w?.rainMmPerH ?? 0) >= 5,
    ) ?? false;
    const referenceIsOutdoorOrMissing =
      !reference || reference.indoorOutdoor === 'outdoor';

    if (isRaining && referenceIsOutdoorOrMissing && candidate.indoorOutdoor === 'indoor') {
      const prefVec = (ctx as BeamSearchContext)?.user?.preferenceVector;
      if (prefVec?.length) {
        // Scale to same order of magnitude as tagOverlap * 10 (overlap of 1 tag = 10 pts).
        // dot product ∈ [0, 1] → * 100 gives up to 100 pts.
        score += dot(prefVec, tagVectorOf(candidate)) * 100;
      }
    } else {
      score += MutationOperators.tagOverlap(candidate, reference) * 10;
    }

    score += Math.min((candidate.avgVisitDurationMin || 0) / 10, 12);

    if (ctx?.potentialPlaceIds?.includes(candidate.placeId)) score += 60;
    if (ctx?.requiredPlaceIds?.includes(candidate.placeId)) score += 80;
    if (ctx?.forceIncludePlaceId === candidate.placeId) score += 100;

    return score;
  }

  /**
   * Loại bỏ các kết quả bị trùng lặp trong danh sách các MutationResult.
   * 
   * Hàm này sử dụng `planSignature` để xác định các kế hoạch (itinerary) giống hệt nhau về cấu trúc.
   * Nếu có nhiều thao tác mutation dẫn đến cùng một kế hoạch cuối cùng, hàm sẽ giữ lại 
   * kết quả có số lượng slot bị ảnh hưởng (affected slots) nhiều hơn (tie-breaker).
   * 
   * @param results Danh sách các kết quả mutation cần lọc trùng.
   * @returns Danh sách các kết quả mutation duy nhất.
   */
  private dedupeResults(results: MutationResult[]): MutationResult[] {
    // Lưu thêm số lượng affected slots đã đếm để tránh tính lại
    const seen = new Map<string, { result: MutationResult; count: number }>();

    for (const result of results) {
      const key = this.planSignature(result.newPlan);
      const existingObj = seen.get(key);
      const resultCount = this.countDistinctAffectedSlots(result);

      if (!existingObj) {
        seen.set(key, { result, count: resultCount });
        continue;
      }
      // ưu tiên giữ lại thao tác có số lượng slot bị ảnh hưởng 
      // user cảm thấy ít ngợp khi thay đổi nhiều
      if (resultCount < existingObj.count) {
        seen.set(key, { result, count: resultCount });
      }
    }

    return [...seen.values()].map(item => item.result);
  }

  /**
   * Tạo *identity signature* cho một plan: khoá trên slotId + version + timing.
   * Hai plan chứa cùng placeId/giờ nhưng slotId khác nhau (ví dụ: INSERT_ALT tạo UUID mới)
   * sẽ cho ra signature khác nhau ở đây.
   *
   * NOTE [Design 1 — Dual planSignature]
   * BeamSearch.planSignature() dùng placeId + timing (structural — không quan tâm slotId).
   * Hàm này dùng slotId + version (identity — phân biệt được hai lần thăm cùng địa điểm).
   * Hai lớp dedup này có ngữ nghĩa khác nhau và có thể để lọt/trùng lặp lẫn nhau.
   *
   * TODO [Design 1]: Thống nhất bằng một hàm dùng chung `structuralSignature(plan)` khoá
   * trên placeId + times, rồi dùng nó cho cả hai nơi. Xem TODO tương ứng trong BeamSearch.ts.
   */
  private planSignature(plan: TripSlot[]): string {
    // 1. Clone mảng để không làm thay đổi mảng gốc, sau đó sort
    const sortedPlan = [...plan].sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      return a.slotOrder - b.slotOrder;
    });

    return sortedPlan
      .map((slot) => {
        // 2. Thêm các trường quan trọng để detect thay đổi (tùy nhu cầu thực tế của bạn)
        return [
          slot.slotId, // Dùng slotId thay vì chỉ placeId nếu 1 place có thể đến nhiều lần
          slot.dayIndex,
          slot.slotOrder,
          slot.status,
          slot.version, // version thường là cách tốt nhất để biết entity có đổi hay không
          slot.plannedStart,
          slot.plannedEnd,
        ].join('##'); // 3. Dùng một ký tự phân cách an toàn hơn, không trùng với format thời gian
      })
      .join('|');
  }

  /**
   * có tác dụng đếm số lượng các slot khác nhau 
   * đã bị tác động bởi một phép biến đổi (mutation).
   * 
   * Mục đích sử dụng: Hàm này được dùng làm tiêu chí ưu tiên 
   * (tie-breaker) trong quá trình loại bỏ các kết quả trùng 
   * lặp tại hàm dedupeResults
   */
  private countDistinctAffectedSlots(result: MutationResult): number {
    return new Set(result?.affectedSlotIds || []).size;
  }

  /**
   * Hàm phụ trợ thay thế địa điểm của một slot hiện có bằng một địa điểm mới.
   * 
   * Các logic xử lý chính:
   * 1. **Tính lại thời gian**: Thời lượng của slot cũ bị loại bỏ hoàn toàn. Thời lượng mới được 
   *    tính bằng giá trị lớn nhất giữa `MIN_SLOT_DURATION_MIN` và `avgVisitDurationMin` của địa điểm mới.
   * 2. **Cập nhật chi phí**: Ưu tiên lấy `estimatedCost` của địa điểm mới, nếu không có sẽ 
   *    dùng `minPrice`, và cuối cùng là giữ nguyên chi phí của slot cũ nếu cả hai đều null.
   * 3. **Quản lý trạng thái**: Tăng số `version` lên 1 và chuyển trạng thái slot về `'planned'`.
   * 4. **Làm sạch dữ liệu**: Reset các trường thực thi (`actualStart`, `actualEnd`, `rationale`) 
   *    về `null` vì đây là một lượt tham quan mới tại địa điểm mới.
   * 5. **An toàn dữ liệu**: Ném lỗi (Error) nếu mốc `plannedStart` của slot không thể parse thành ngày hợp lệ.
   * 
   * @param slot Đối tượng {@link TripSlot} cần thay thế địa điểm.
   * @param place Địa điểm {@link Place} mới sẽ được gán vào slot.
   * @returns Một bản sao của {@link TripSlot} đã được cập nhật địa điểm và các thông số liên quan.
   * @throws {Error} Nếu `plannedStart` của slot không hợp lệ.
   */
  private replaceSlotPlace(slot: TripSlot, place: Place): TripSlot {
    const startDate = new Date(slot.plannedStart);
    const currentStart = startDate.getTime();

    // Kiểm tra thời gian hợp lệ để tránh crash RangeError
    if (isNaN(currentStart)) {
      throw new Error(`Invalid plannedStart value in slot: ${slot.slotId}`);
    }

    // Loại bỏ việc phụ thuộc vào thời lượng của slot cũ
    // Chỉ lấy max giữa thời gian quy định tối thiểu và thời gian trung bình của địa điểm mới
    const currentDuration = Math.max(
      MIN_SLOT_DURATION_MIN * 60_000,
      (place.avgVisitDurationMin || 0) * 60_000
    );

    return {
      ...slot,
      placeId: place.placeId,
      plannedEnd: new Date(currentStart + currentDuration).toISOString(),
      estimatedCost: place.estimatedCost ?? place.minPrice ?? slot.estimatedCost,

      // Đảm bảo slot mới luôn sạch dữ liệu thực thi
      actualStart: null,
      actualEnd: null,
      rationale: null,

      version: slot.version + 1,
      status: 'planned'
    };
  }

  /**
   * Tái lập lịch trình cho phần còn lại của kế hoạch (suffix) bắt đầu từ một vị trí chỉ định.
   * Đây là bước "sửa lỗi" toàn cục, giúp một thay đổi nhỏ ở giữa kế hoạch (như chèn, xoá, 
   * hoặc đổi chỗ) được lan truyền và cập nhật chính xác cho toàn bộ phần phía sau.
   * 
   * Các cơ chế cốt lõi:
   * 1. **Tính toán Travel Time**: Tự động tính thời gian di chuyển từ vị trí trước đó 
   *    (hoặc vị trí hiện tại của người dùng) đến địa điểm của slot hiện tại.
   * 2. **Dồn lịch (Packing)**: Các slot được đẩy lên sớm nhất có thể ngay sau khi kết thúc 
   *    thời gian di chuyển, giúp tối ưu hoá thời gian trống.
   * 3. **Xử lý Opening Hours**: Kiểm tra xem khung giờ dự kiến có khớp với lịch mở cửa 
   *    của địa điểm hay không (sử dụng `withinOpeningHours`).
   * 4. **Quản lý giới hạn ngày (Night Constraint)**: Nếu một slot kết thúc quá muộn 
   *    (vượt quá `DAY_END_HOUR` + `maxOverflow`), nó sẽ tự động được dời sang 8:00 sáng 
   *    ngày hôm sau.
   * 5. **Chống lặp vô hạn**: Hệ thống thử dời lịch tối đa 4 ngày liên tiếp. Nếu vẫn không tìm được
   *    khung giờ khả thi (ví dụ: địa điểm đóng cửa dài hạn), toàn bộ kế hoạch sẽ bị coi là không khả thi.
   *    Giới hạn 4 ngày là cố ý — nếu ngày hợp lệ tiếp theo cách xa hơn, địa điểm không phù hợp
   *    với cửa sổ lập lịch hiện tại.
   * 
   * @param plan Danh sách các {@link TripSlot} cần được sửa lại.
   * @param fromIndex Vị trí bắt đầu thực hiện sửa lỗi (0-indexed).
   * @param ctx Ngữ cảnh replan chứa các tham số giới hạn và dữ liệu ứng viên.
   * @returns Danh sách TripSlot đã được cập nhật mốc thời gian, hoặc `null` nếu không thể sửa lỗi.
   */
  public repairSuffix(
    plan: TripSlot[],
    fromIndex: number,
    ctx: ReplanContext,
  ): TripSlot[] | null {
    if (plan.length === 0) return [];
    if (fromIndex >= plan.length) return plan.map((s) => ({ ...s }));

    const repaired = plan.map((slot) => ({ ...slot }));
    const maxOverflow = ctx.maxOverflowMinutes ?? 30;

    // Trip boundary: no slot may be scheduled beyond the last day present in the input plan.
    const maxAllowedDayIndex = Math.max(...plan.map((s) => s.dayIndex));

    const placeMap = ctx.placeMap ?? (() => {
      const m = new Map<number, Place>();
      for (const p of ctx.candidatePool) m.set(p.placeId, p);
      return m;
    })();

    // [Bug 5 fix] Counter per-day cho slotOrder.
    // Dùng MAX(slotOrder) + 1 của prefix để tránh collision với locked slot giữ nguyên slotOrder gốc.
    // COUNT-based sẽ gây trùng khi prefix có slotOrder 1-based (e.g. 1,2) → count=2 trùng với slotOrder=2.
    const dayOrderCounters = new Map<number, number>();
    for (let j = 0; j < fromIndex; j++) {
      const s = repaired[j]!;
      const current = dayOrderCounters.get(s.dayIndex) ?? -1;
      dayOrderCounters.set(s.dayIndex, Math.max(current, s.slotOrder) + 1);
    }

    const capturedAtMs = new Date(ctx.initialState.capturedAt).getTime();
    let cursorMs =
      fromIndex > 0
        ? Math.max(new Date(repaired[fromIndex - 1]!.plannedEnd).getTime(), capturedAtMs)
        : capturedAtMs;

    let currentDayIndex =
      fromIndex > 0
        ? repaired[fromIndex - 1]!.dayIndex
        : (repaired[fromIndex]?.dayIndex ?? ctx.initialState.dayIndex);

    // When capturedAt is before the first slot's scheduled day (pre-trip cursor) AND there
    // is no prefix to anchor the calendar day, clamp the cursor's VN calendar day to the
    // first processed slot's day so the pre-trip gap does not inflate dayJump.
    // Only apply when fromIndex === 0: with a prefix, the prefix already establishes the
    // correct calendar day, and clamping would suppress legitimate cross-day jumps (e.g.,
    // a suffix slot originally scheduled on day N+1 while the prefix is on day N).
    const tripStartVNDay =
      fromIndex === 0
        ? Math.floor(
            (new Date(repaired[0]?.plannedStart ?? ctx.initialState.capturedAt).getTime() +
              VN_OFFSET_MS) /
              86_400_000,
          )
        : -Infinity;

    for (let i = fromIndex; i < repaired.length; i++) {
      const slot = repaired[i]!;
      const rawCursorVNDay = Math.floor((cursorMs + VN_OFFSET_MS) / 86_400_000);
      const cursorVNDay = Math.max(rawCursorVNDay, tripStartVNDay);

      // Historical slots (completed / skipped) are immutable: their plannedStart/End reflect
      // what actually happened (or was acknowledged as skipped) and must never be re-timed
      // by repair. Treat them like locked anchors that advance the cursor only.
      if (slot.status === 'completed' || slot.status === 'skipped') {
        cursorMs = Math.max(cursorMs, new Date(slot.plannedEnd).getTime());
        currentDayIndex = slot.dayIndex;
        repaired[i] = { ...slot };
        const prevMax = dayOrderCounters.get(slot.dayIndex) ?? -1;
        dayOrderCounters.set(slot.dayIndex, Math.max(prevMax, slot.slotOrder) + 1);
        continue;
      }

      // Locked slots are immovable anchors: cursor must not overflow into their window,
      // and travel time from the previous position to the locked venue must also fit.
      if (slot.isLocked) {
        const lockedStartMs = new Date(slot.plannedStart).getTime();
        const lockedPlace = placeMap.get(slot.placeId);
        let travelToLockedMin = 0;
        if (lockedPlace) {
          let prevLat = ctx.initialState.currentLat;
          let prevLng = ctx.initialState.currentLng;
          if (i > 0) {
            const prevPlace = placeMap.get(repaired[i - 1]!.placeId);
            if (prevPlace) { prevLat = prevPlace.lat; prevLng = prevPlace.lng; }
          }
          travelToLockedMin = this.evolver.estimateTravelTime(
            prevLat ?? lockedPlace.lat, prevLng ?? lockedPlace.lng,
            lockedPlace.lat, lockedPlace.lng,
          );
        }
        if (cursorMs + travelToLockedMin * 60_000 > lockedStartMs) return null;
        cursorMs = new Date(slot.plannedEnd).getTime();
        currentDayIndex = slot.dayIndex;
        repaired[i] = { ...slot };
        const prevMax = dayOrderCounters.get(slot.dayIndex) ?? -1;
        dayOrderCounters.set(slot.dayIndex, Math.max(prevMax, slot.slotOrder) + 1);
        continue;
      }

      const place = placeMap.get(slot.placeId);
      if (!place) return null;

      let prevLat = ctx.initialState.currentLat;
      let prevLng = ctx.initialState.currentLng;
      if (i > 0) {
        const prevPlace = placeMap.get(repaired[i - 1]!.placeId);
        if (prevPlace) { prevLat = prevPlace.lat; prevLng = prevPlace.lng; }
      }

      const travelTimeMin = this.evolver.estimateTravelTime(
        prevLat ?? place.lat, prevLng ?? place.lng, place.lat, place.lng,
      );

      const originalStartMs = new Date(slot.plannedStart).getTime();
      // Always derive visit duration from the place's canonical avgVisitDurationMin so that
      // plannedEnd − plannedStart equals only the visit duration (no travel time folded in).
      const targetDurationMs = Math.max(
        MIN_SLOT_DURATION_MIN * 60_000,
        place.avgVisitDurationMin * 60_000,
      );

      // Preserve original schedule when cursor is earlier (no aggressive forward-packing).
      let plannedStartMs = Math.max(cursorMs + travelTimeMin * 60_000, originalStartMs);

      // NaN guard: invalid date strings produce NaN
      if (isNaN(plannedStartMs)) return null;

      // Underflow: push to DAY_START_HOUR if slot would start before 08:00 VN
      const startLocalForUnderflow = new Date(plannedStartMs + VN_OFFSET_MS);
      if (startLocalForUnderflow.getUTCHours() < DAY_START_HOUR) {
        startLocalForUnderflow.setUTCHours(DAY_START_HOUR, 0, 0, 0);
        plannedStartMs = startLocalForUnderflow.getTime() - VN_OFFSET_MS;
      }
      let plannedEndMs = plannedStartMs + targetDurationMs;

      const shiftToNextDayMorning = () => {
        // Note: currentDayIndex is derived from plannedStartMs after all shifts.
        const next = new Date(plannedStartMs + VN_OFFSET_MS);
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(DAY_START_HOUR, 0, 0, 0);
        plannedStartMs = next.getTime() - VN_OFFSET_MS;
        plannedEndMs = plannedStartMs + targetDurationMs;
      };

      // Opening-hours: check BEFORE overflow so cross-midnight places (e.g. 22:00–04:00)
      // that already encompass the slot are not needlessly shifted to next-day morning.
      // Use checkOpeningHours(slot, place) directly — place is already in hand from placeMap.
      let tempSlot: TripSlot = {
        ...slot,
        plannedStart: new Date(plannedStartMs).toISOString(),
        plannedEnd: new Date(plannedEndMs).toISOString(),
      };
      const alreadyWithinHours =
        place.openingHours.length > 0 && this.checkOpeningHours(tempSlot, place);

      // Night-overflow: shift at most once (mega-slots accepted on the next day).
      // Skip when the place's explicit hours already accommodate this time window.
      if (!alreadyWithinHours) {
        const startLocal = new Date(plannedStartMs + VN_OFFSET_MS);
        const startMidnightMs = Date.UTC(
          startLocal.getUTCFullYear(), startLocal.getUTCMonth(), startLocal.getUTCDate(),
        );
        const endMsFromStartDay = (plannedEndMs + VN_OFFSET_MS) - startMidnightMs;
        const limitMs = (DAY_END_HOUR * 60 + maxOverflow) * 60_000;
        if (endMsFromStartDay > limitMs) shiftToNextDayMorning();

        // Rebuild after potential overflow shift
        tempSlot = {
          ...slot,
          plannedStart: new Date(plannedStartMs).toISOString(),
          plannedEnd: new Date(plannedEndMs).toISOString(),
        };

        // Opening-hours: hard constraint — try up to 4 consecutive days.
        let hoursAttempts = 0;
        while (!this.checkOpeningHours(tempSlot, place) && hoursAttempts < 4) {
          shiftToNextDayMorning();
          hoursAttempts++;
          tempSlot = {
            ...slot,
            plannedStart: new Date(plannedStartMs).toISOString(),
            plannedEnd: new Date(plannedEndMs).toISOString(),
          };
        }
        if (!this.checkOpeningHours(tempSlot, place)) return null;
      }

      // Advance currentDayIndex by the total VN calendar days that plannedStartMs moved
      // ahead of the cursor. This handles both overflow (shiftToNextDayMorning) and natural
      // multi-day gaps where originalStart is already on a future calendar day.
      const finalStartVNDay = Math.floor((plannedStartMs + VN_OFFSET_MS) / 86_400_000);
      const dayJump = finalStartVNDay - cursorVNDay;
      if (dayJump > 0) {
        currentDayIndex += dayJump;
        // Trip boundary: reject any plan where a slot must spill beyond the last trip day.
        if (currentDayIndex > maxAllowedDayIndex) return null;
      }

      const slotOrder = dayOrderCounters.get(currentDayIndex) ?? 0;
      dayOrderCounters.set(currentDayIndex, slotOrder + 1);

      repaired[i] = {
        ...slot,
        slotOrder,
        dayIndex: currentDayIndex,
        plannedStart: new Date(plannedStartMs).toISOString(),
        plannedEnd: new Date(plannedEndMs).toISOString(),
        estimatedCost: slot.estimatedCost > 0 ? slot.estimatedCost : (place.minPrice ?? 0),
      };

      cursorMs = plannedEndMs;
    }

    return repaired;
  }


  /**
   * Tiền xử lý ngữ cảnh và tạo ra một gốc kế hoạch (root node) khả thi về mặt thời gian 
   * cho thuật toán Beam Search.
   * 
   * Hàm này quét qua lịch trình, phát hiện các ngày bị quá tải (vượt quá giới hạn
   * DAY_END_HOUR + maxOverflowMinutes) và lặp lại việc cắt tỉa các slot ưu tiên thấp 
   * cho đến khi toàn bộ kế hoạch nằm trong khung giờ hợp lệ.
   * 
   * Các cơ chế & Edge-cases đã xử lý:
   * - Midnight Wrap-around: Nhận diện chính xác thời gian lố sang ngày hôm sau 
   *   bằng cách quy chiếu về hệ 24h+.
   * - Chiến lược cắt tỉa: Tính toán priority score để xoá slot ít quan trọng nhất. 
   *   Mặc định bảo vệ các slot bữa ăn ('meal').
   * - Deadlock Prevention (Graceful Degradation): Nếu ngày quá tải chỉ toàn meal, 
   *   hệ thống buộc phải nới lỏng ràng buộc và xoá meal để đảm bảo gốc khả thi.
   * - Tái cấu trúc lịch (Re-packing): Tự động nén lại lịch (`repairSuffix`) ngay 
   *   sau mỗi lần xoá slot để cập nhật lại thời gian thật. Dừng an toàn nếu nén lỗi.
   * - Tái chế dữ liệu: Những địa điểm bị ép văng khỏi lịch trình sẽ được gom 
   *   (không trùng lặp) vào `potentialPlaceIds` để Beam Search có thể cân nhắc lại.
   * 
   * @param ctx Ngữ cảnh Beam Search đầu vào chứa `remainingSlots` có nguy cơ quá tải.
   * @returns BeamSearchContext mới với kế hoạch đã được "nén" an toàn và danh sách 
   *          ứng viên tiềm năng được cập nhật.
   */
  public prepareContext(ctx: BeamSearchContext): BeamSearchContext {
    const maxOverflow = ctx.maxOverflowMinutes ?? 30;
    let currentPlan = [...ctx.remainingSlots];
    const overflowedPlaceIds: number[] = [];

    let safetyCounter = 0;

    // Vòng lặp dừng khi: kế hoạch hoàn hảo, không thể nén thêm (!hasModifications), hoặc chạm ngưỡng an toàn.
    while (safetyCounter < 100) {
      safetyCounter++;
      let isFullyRepaired = true;
      let hasModifications = false;

      const dayGroups = new Map<number, TripSlot[]>();
      for (const s of currentPlan) {
        const arr = dayGroups.get(s.dayIndex) ?? [];
        arr.push(s);
        dayGroups.set(s.dayIndex, arr);
      }

      for (const [day, unsortedSlots] of dayGroups.entries()) {
        if (unsortedSlots.length === 0) continue;

        const slots = [...unsortedSlots].sort(
          (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
        );

        const firstSlot = slots[0];
        const lastSlot = slots[slots.length - 1];

        const startLocal = new Date(new Date(firstSlot.plannedStart).getTime() + VN_OFFSET_MS);
        const endLocal = new Date(new Date(lastSlot.plannedEnd).getTime() + VN_OFFSET_MS);

        let endHour = endLocal.getUTCHours() + endLocal.getUTCMinutes() / 60;

        if (startLocal.getUTCDate() !== endLocal.getUTCDate()) {
          endHour += 24;
        }

        // Phát hiện ngày quá tải
        if (endHour > DAY_END_HOUR + (maxOverflow / 60)) {
          isFullyRepaired = false;

          // Ưu tiên xoá các slot không phải meal
          let candidateSlots = slots.filter((s) => s.activityType !== 'meal');

          // Fallback: Nếu ngày chỉ chứa toàn meal, buộc phải nới lỏng ràng buộc
          if (candidateSlots.length === 0) {
            console.warn(`[prepareContext] Day ${day} is overloaded and only contains meals. Forcing meal removal to maintain time feasibility.`);
            candidateSlots = [...slots];
          }

          // Lúc này candidateSlots chắc chắn có phần tử (vì slots.length > 0)
          const prepareMap = ctx.placeMap ?? new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
          const sorted = [...candidateSlots].sort((a, b) => {
            const placeA = prepareMap.get(a.placeId);
            const placeB = prepareMap.get(b.placeId);
            const scoreA = placeA ? MutationOperators.candidatePriority(placeA, undefined, ctx) : 0;
            const scoreB = placeB ? MutationOperators.candidatePriority(placeB, undefined, ctx) : 0;
            return scoreA - scoreB;
          });

          const toRemove = sorted[0]!;
          overflowedPlaceIds.push(toRemove.placeId);

          currentPlan = currentPlan.filter((s) => s.slotId !== toRemove.slotId);

          const repaired = this.repairSuffix(currentPlan, 0, ctx);
          if (repaired) {
            currentPlan = repaired;
            hasModifications = true;
          } else {
            console.error(`[prepareContext] repairSuffix failed after removing slot ${toRemove.slotId}. Stopping further repairs.`);
            hasModifications = false;
          }

          break; // Thoát để map lại dayGroups với currentPlan mới
        }
      }

      if (isFullyRepaired || !hasModifications) {
        break;
      }
    }

    // Tuỳ chọn (Phương án 2): Trả về lỗi rõ ràng nếu sau nỗ lực nới lỏng vẫn bế tắc
    // Điều này hiếm khi xảy ra trừ khi có 1 slot duy nhất nhưng dài hơn toàn bộ thời gian 1 ngày.
    /*
    if (!isFullyRepaired && safetyCounter >= 100) {
       console.error("[prepareContext] Critical failure: Unable to resolve schedule overflow.");
       // Trả về null hoặc quăng exception tuỳ vào thiết kế architecture của bạn
       // throw new Error("Infeasible plan root"); 
    }
    */

    if (overflowedPlaceIds.length === 0) return ctx;

    return {
      ...ctx,
      remainingSlots: currentPlan,
      potentialPlaceIds: [...new Set([...(ctx.potentialPlaceIds ?? []), ...overflowedPlaceIds])],
    };
  }

  /**
   * Kiểm tra xem thời gian kết thúc của một slot có vượt quá giới hạn ngày cho phép không.
   * 
   * Hàm này chuyển đổi thời gian kết thúc sang hệ 24h+ (ví dụ: 1:00 AM hôm sau = 25:00)
   * dựa trên mốc DAY_START_HOUR để xác định xem slot có bị vắt qua nửa đêm hay không.
   * Sau đó, so sánh với DAY_END_HOUR cộng với khoảng thời gian lố cho phép (maxOverflowMinutes).
   * 
   * @param plannedEnd Chuỗi ISO thời gian kết thúc.
   * @param ctx Ngữ cảnh replan chứa cấu hình maxOverflowMinutes.
   * @returns true nếu vượt quá giới hạn, ngược lại là false.
   */
  private exceedsNightConstraint(plannedEnd: string, ctx: ReplanContext): boolean {
    if (!plannedEnd) return false;
    const endMs = new Date(plannedEnd).getTime();
    if (isNaN(endMs)) return false;

    const endLocal = new Date(endMs + VN_OFFSET_MS);
    let endHour = endLocal.getUTCHours() + endLocal.getUTCMinutes() / 60;

    // Nếu giờ kết thúc nhỏ hơn giờ bắt đầu ngày (ví dụ 8h sáng), 
    // ta coi như đây là slot vắt qua nửa đêm của ngày hôm trước (hệ 24h+).
    if (endHour < DAY_START_HOUR) {
      endHour += 24;
    }

    const maxOverflow = ctx.maxOverflowMinutes ?? 30;
    return endHour > DAY_END_HOUR + (maxOverflow / 60);
  }

  public rescheduleSlotTimes(plan: TripSlot[], ctx: ReplanContext): TripSlot[] | null {
    return this.repairSuffix(plan, 0, ctx);
  }

  // =========================================================================
  // SPEC-02: Phase-1 proposal generators + Phase-2 materializer
  // =========================================================================

  // -------------------------------------------------------------------------
  // Phase-1 helpers: one propose* method per operator
  // These are CHEAP — no repairSuffix, no simulateIfFeasible, no plan cloning.
  // -------------------------------------------------------------------------

  private proposeTimeShifts(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    const proposals: ProposedMutation[] = [];
    for (let i = 0; i < plan.length; i++) {
      const anchor = plan[i]!;
      if (anchor.isLocked) continue;
      if (anchor.status !== 'planned') continue;
      for (const deltaMin of TIME_SHIFT_DELTAS_MIN) {
        const shifted = this.shiftSlot(anchor, deltaMin);
        if (!this.withinOpeningHours(shifted, ctx)) continue;
        if (this.exceedsNightConstraint(shifted.plannedEnd, ctx)) continue;
        proposals.push({ operator: 'TIME_SHIFT', slotIndex: i, deltaMin });
      }
    }
    return proposals;
  }

  private proposeSwaps(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    const proposals: ProposedMutation[] = [];
    const sorted = [...plan].sort((a, b) =>
      a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : a.slotOrder - b.slotOrder,
    );
    let lastNonPlanned = -1;
    for (let k = sorted.length - 1; k >= 0; k--) {
      if (sorted[k]!.status !== 'planned') { lastNonPlanned = k; break; }
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      if (i <= lastNonPlanned) continue;
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (a.isLocked || b.isLocked) continue;
      if (a.dayIndex !== b.dayIndex) continue;
      proposals.push({ operator: 'SWAP_ORDER', indexA: i, indexB: i + 1 });
    }
    return proposals;
  }

  private proposeReplaces(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    const proposals: ProposedMutation[] = [];
    const occupied = new Set(plan.map((s) => s.placeId));
    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      if (slot.isLocked) continue;
      if (slot.status !== 'planned' && slot.status !== 'replaced') continue;
      const currentPlace = ctx.placeMap?.get(slot.placeId) ??
        ctx.candidatePool.find((p) => p.placeId === slot.placeId);
      const isRaining = (ctx as BeamSearchContext).weatherForecast?.some(
        (w) => (w?.rainMmPerH ?? 0) >= 5) ?? false;
      const isOutdoor = currentPlace?.indoorOutdoor === 'outdoor';
      const isReplaceable = slot.activityType === 'sightseeing' || slot.activityType === 'activity';
      if (!isReplaceable && !(isRaining && isOutdoor)) continue;

      const candidates = ctx.candidatePool
        .filter((p) => !occupied.has(p.placeId))
        .map((p) => ({ place: p, score: MutationOperators.candidatePriority(p, currentPlace, ctx) }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_REPLACE_CANDIDATES);

      for (const { place } of candidates) {
        // LB feasibility — same cheap check as the materializer does.
        const newPlaces = plan.map((s) => ctx.placeMap?.get(s.placeId) ??
          ctx.candidatePool.find((p) => p.placeId === s.placeId))
          .filter((p): p is Place => p !== undefined && p.placeId !== slot.placeId)
          .concat(place);
        if (!isSetFeasible(newPlaces, ctx)) continue;
        proposals.push({
          operator: 'REPLACE_PLACE',
          slotIndex: i,
          newPlaceId: place.placeId,
          newSlotDuration: Math.max(MIN_SLOT_DURATION_MIN, place.avgVisitDurationMin),
          newSlotCost: place.estimatedCost ?? place.minPrice ?? 0,
        });
      }
    }
    return proposals;
  }

  private proposeDrops(plan: TripSlot[]): ProposedMutation[] {
    const proposals: ProposedMutation[] = [];
    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      if (slot.isLocked) continue;
      if (slot.activityType === 'meal') continue;
      if (slot.status === 'completed' || slot.status === 'skipped') continue;
      proposals.push({ operator: 'DROP_SLOT', slotIndex: i });
    }
    return proposals;
  }

  private proposeInserts(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    const proposals: ProposedMutation[] = [];
    const occupied = new Set(
      plan.filter(s => s.status === 'planned' || s.status === 'completed' ||
        s.status === 'skipped' || s.status === 'replaced').map(s => s.placeId),
    );

    let insertable: Place[];
    if (ctx.forceIncludePlaceId !== undefined) {
      if (occupied.has(ctx.forceIncludePlaceId)) {
        insertable = [];
      } else {
        const forced = ctx.candidatePool.find((p) => p.placeId === ctx.forceIncludePlaceId);
        insertable = forced ? [forced] : [];
      }
    } else {
      insertable = ctx.candidatePool
        .filter((p) => !occupied.has(p.placeId))
        .map((p) => ({ place: p, score: MutationOperators.candidatePriority(p, undefined, ctx) }))
        .filter((c) => c.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_INSERT_CANDIDATES)
        .map((x) => x.place);
    }

    let startPos = 0;
    for (let i = plan.length - 1; i >= 0; i--) {
      const slot = plan[i];
      if (slot.status !== 'planned' || (slot.status === 'planned' && slot.actualStart !== null)) {
        startPos = i + 1;
        break;
      }
    }

    for (const place of insertable) {
      for (let pos = startPos; pos <= plan.length; pos++) {
        if (proposals.length >= 20) return proposals;
        // LB check — same as materializer.
        const tentativePlaces = [
          ...plan.slice(0, pos).map((s) => ctx.placeMap?.get(s.placeId) ??
            ctx.candidatePool.find((p) => p.placeId === s.placeId)),
          place,
          ...plan.slice(pos).map((s) => ctx.placeMap?.get(s.placeId) ??
            ctx.candidatePool.find((p) => p.placeId === s.placeId)),
        ].filter((p): p is Place => p !== undefined);
        if (!isSetFeasible(tentativePlaces, ctx)) continue;
        proposals.push({
          operator: 'INSERT_ALT',
          insertIndex: pos,
          newPlaceId: place.placeId,
          newSlotDuration: Math.max(MIN_SLOT_DURATION_MIN, place.avgVisitDurationMin),
          newSlotCost: place.estimatedCost ?? place.minPrice ?? 0,
        });
      }
    }
    return proposals;
  }

  private proposeTSP(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    // [Decision 4]: TSP_REORDER cannot be proposed cheaply — 2-opt IS the computation.
    // Run it eagerly here and store the result as a pre-computed opaque proposal.
    // canPrune() always returns false for TSP, so the cost is the same as before.
    const results = this.tspReorder(plan, ctx);
    return results.map((r) => ({ operator: 'TSP_REORDER' as const, _materialized: r }));
  }

  // -------------------------------------------------------------------------
  // generateAllProposed — Phase 1 (lightweight, no repairSuffix/simulate)
  // -------------------------------------------------------------------------

  /**
   * Generates lightweight ProposedMutation[] using cheap per-operator logic.
   * Applies the same round-robin merge and GENERATE_ALL_CAP=30 cap as generateAll().
   *
   * [Decision 11]: Cap of 30 applies BEFORE pruning. After canPrune() filters proposals,
   * fewer than 30 may reach materializeMutation() — that is the desired behavior.
   *
   * [Decision 5]: generateAll() is kept unchanged for backward compatibility with tests.
   */
  public generateAllProposed(plan: TripSlot[], ctx: ReplanContext): ProposedMutation[] {
    const timeShiftProps = this.proposeTimeShifts(plan, ctx);
    const swapProps = this.proposeSwaps(plan, ctx);
    const replaceProps = this.proposeReplaces(plan, ctx);
    const dropProps = this.proposeDrops(plan);
    const insertProps = this.proposeInserts(plan, ctx);
    const tspProps = this.proposeTSP(plan, ctx);

    // Round-robin merge (anti-starvation) — mirrors generateAll().
    const operatorOutputs = [timeShiftProps, swapProps, replaceProps, dropProps, insertProps, tspProps];
    const allMerged: ProposedMutation[] = [];
    let hasMore = true;
    let index = 0;
    while (hasMore) {
      hasMore = false;
      for (const output of operatorOutputs) {
        if (index < output.length) {
          allMerged.push(output[index]!);
          hasMore = true;
        }
      }
      index++;
    }

    // [Decision 6]: Parameter-based dedup (coarser than plan-signature dedup in generateAll).
    const seen = new Set<string>();
    const deduped: ProposedMutation[] = [];
    for (const p of allMerged) {
      const key = [
        p.operator,
        p.slotIndex ?? '',
        p.indexA ?? '',
        p.indexB ?? '',
        p.deltaMin ?? '',
        p.newPlaceId ?? '',
        p.insertIndex ?? '',
      ].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(p);
      }
    }

    return deduped.slice(0, GENERATE_ALL_CAP);
  }

  // -------------------------------------------------------------------------
  // materializeMutation — Phase 2 (expensive: clones plan, repairSuffix, simulate)
  // -------------------------------------------------------------------------

  /**
   * Materializes a ProposedMutation into a full MutationResult (with stateTrajectory),
   * or returns null if the candidate is infeasible after repairSuffix + simulation.
   *
   * Called only for proposals that survived canPrune() — so most infeasible candidates
   * are already excluded before reaching this path.
   */
  public materializeMutation(
    proposed: ProposedMutation,
    plan: TripSlot[],
    ctx: ReplanContext,
  ): MutationResult | null {
    switch (proposed.operator) {
      case 'TSP_REORDER':
        // [Decision 4]: Pre-computed in proposeTSP().
        return proposed._materialized ?? null;

      case 'TIME_SHIFT': {
        const { slotIndex, deltaMin } = proposed;
        if (slotIndex == null || deltaMin == null) return null;
        const anchor = plan[slotIndex];
        if (!anchor) return null;

        const mutated = plan.map((slot, idx) =>
          idx === slotIndex ? this.shiftSlot(slot, deltaMin) : { ...slot },
        );
        const shiftedAnchor = mutated[slotIndex]!;

        if (!this.withinOpeningHours(shiftedAnchor, ctx)) return null;
        if (this.exceedsNightConstraint(shiftedAnchor.plannedEnd, ctx)) return null;

        if (slotIndex + 1 >= plan.length) {
          const trajectory = this.simulateIfFeasible(mutated, ctx);
          if (!trajectory) return null;
          return {
            newPlan: mutated,
            operator: 'TIME_SHIFT',
            affectedSlotIds: [anchor.slotId],
            repairedFromIndex: slotIndex,
            resumeIndex: slotIndex,
            stateTrajectory: trajectory,
            description: `Dời slot cuối ${slotIndex} đi ${deltaMin > 0 ? '+' : ''}${deltaMin} phút`,
          };
        }

        const repaired = this.repairSuffix(mutated, slotIndex + 1, ctx);
        if (!repaired) return null;
        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) return null;

        const changedSlotIds: string[] = [];
        for (let j = slotIndex; j < plan.length; j++) {
          if (plan[j]!.plannedStart !== repaired[j]!.plannedStart ||
            plan[j]!.plannedEnd !== repaired[j]!.plannedEnd) {
            changedSlotIds.push(repaired[j]!.slotId);
          }
        }
        return {
          newPlan: repaired,
          operator: 'TIME_SHIFT',
          affectedSlotIds: [anchor.slotId],
          repairedFromIndex: slotIndex,
          resumeIndex: slotIndex,
          stateTrajectory: trajectory,
          description: `Dời slot ${slotIndex} ${deltaMin > 0 ? '+' : ''}${deltaMin} phút và tái tối ưu suffix`,
        };
      }

      case 'SWAP_ORDER': {
        const { indexA, indexB } = proposed;
        if (indexA == null || indexB == null) return null;
        const sorted = [...plan].sort((a, b) =>
          a.dayIndex !== b.dayIndex ? a.dayIndex - b.dayIndex : a.slotOrder - b.slotOrder,
        );
        const a = sorted[indexA];
        const b = sorted[indexB];
        if (!a || !b) return null;

        const mutated = sorted.map((slot) => ({ ...slot }));
        mutated[indexA] = { ...b, slotOrder: a.slotOrder, version: b.version + 1 };
        mutated[indexB] = { ...a, slotOrder: b.slotOrder, version: a.version + 1 };

        const repaired = this.repairSuffix(mutated, indexA, ctx);
        if (!repaired) return null;
        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) return null;

        const affectedSlotIds = Array.from(new Set([
          ...sorted.slice(indexA).map(s => s.slotId),
          ...repaired.slice(indexA).map(s => s.slotId),
        ]));
        return {
          newPlan: repaired,
          operator: 'SWAP_ORDER',
          affectedSlotIds,
          repairedFromIndex: indexA,
          resumeIndex: indexA,
          stateTrajectory: trajectory,
          description: `Đổi chỗ hai slot kề nhau ở vị trí ${indexA} và ${indexB}, rồi repair toàn suffix`,
        };
      }

      case 'REPLACE_PLACE': {
        const { slotIndex, newPlaceId } = proposed;
        if (slotIndex == null || newPlaceId == null) return null;
        const currentSlot = plan[slotIndex];
        if (!currentSlot) return null;
        const alt = ctx.placeMap?.get(newPlaceId) ??
          ctx.candidatePool.find((p) => p.placeId === newPlaceId);
        if (!alt) return null;

        const mutated = plan.map((slot) => ({ ...slot }));
        try {
          mutated[slotIndex] = this.replaceSlotPlace(mutated[slotIndex]!, alt);
        } catch {
          return null;
        }

        const newPlaces = mutated.map((s) => ctx.placeMap?.get(s.placeId))
          .filter((p): p is Place => p !== undefined);
        if (!isSetFeasible(newPlaces, ctx)) return null;

        const repaired = this.repairSuffix(mutated, slotIndex, ctx);
        if (!repaired) return null;
        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) return null;

        const affectedIds = new Set<string>([currentSlot.slotId]);
        for (let j = slotIndex + 1; j < repaired.length; j++) {
          const oldSlot = plan[j];
          const newSlot = repaired[j];
          if (oldSlot && newSlot &&
            (oldSlot.plannedStart !== newSlot.plannedStart ||
              oldSlot.plannedEnd !== newSlot.plannedEnd ||
              oldSlot.dayIndex !== newSlot.dayIndex)) {
            affectedIds.add(newSlot.slotId);
          }
        }
        const currentPlaceName = (ctx.placeMap?.get(currentSlot.placeId) ??
          ctx.candidatePool.find((p) => p.placeId === currentSlot.placeId))?.name ??
          `Địa điểm cũ (ID: ${currentSlot.placeId})`;
        return {
          newPlan: repaired,
          operator: 'REPLACE_PLACE',
          affectedSlotIds: Array.from(affectedIds),
          repairedFromIndex: slotIndex,
          resumeIndex: slotIndex,
          stateTrajectory: trajectory,
          description: `Thay ${currentPlaceName} bằng ${alt.name} và tái lập lịch phần còn lại`,
        };
      }

      case 'DROP_SLOT': {
        const { slotIndex } = proposed;
        if (slotIndex == null) return null;
        const slot = plan[slotIndex];
        if (!slot) return null;

        const mutated = plan.filter((_, idx) => idx !== slotIndex).map((s) => ({ ...s }));
        let repaired: TripSlot[] | null = mutated;
        let isSuffixRepaired = false;
        if (slotIndex < mutated.length) {
          repaired = this.repairSuffix(mutated, slotIndex, ctx);
          isSuffixRepaired = true;
        }
        if (!repaired) return null;

        const dayCounters = new Map<number, number>();
        for (const s of repaired) {
          const cur = dayCounters.get(s.dayIndex) ?? 0;
          s.slotOrder = cur;
          dayCounters.set(s.dayIndex, cur + 1);
        }

        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) return null;
        return {
          newPlan: repaired,
          operator: 'DROP_SLOT',
          affectedSlotIds: [slot.slotId],
          ...(isSuffixRepaired && { repairedFromIndex: slotIndex }),
          resumeIndex: slotIndex,
          stateTrajectory: trajectory,
          description: isSuffixRepaired
            ? `Bỏ slot ${slotIndex} (${slot.activityType}) rồi dồn lại toàn bộ suffix`
            : `Bỏ slot ${slotIndex} (${slot.activityType}) ở cuối kế hoạch`,
        };
      }

      case 'INSERT_ALT': {
        const { insertIndex, newPlaceId } = proposed;
        if (insertIndex == null || newPlaceId == null) return null;
        const place = ctx.placeMap?.get(newPlaceId) ??
          ctx.candidatePool.find((p) => p.placeId === newPlaceId);
        if (!place) return null;

        const capturedAtTime = new Date(ctx.initialState.capturedAt).getTime();
        const newSlot = this.synthesizeSlot(place, plan, insertIndex, ctx);
        const mutated = [
          ...plan.slice(0, insertIndex).map((s) => ({ ...s })),
          newSlot,
          ...plan.slice(insertIndex).map((s) => ({ ...s })),
        ];

        const newPlaces = mutated.map((s) => ctx.placeMap?.get(s.placeId))
          .filter((p): p is Place => p !== undefined);
        if (!isSetFeasible(newPlaces, ctx)) return null;

        const repaired = this.repairSuffix(mutated, insertIndex, ctx);
        if (!repaired) return null;

        let currentDay = insertIndex > 0 ? repaired[insertIndex - 1]!.dayIndex : (repaired[0]?.dayIndex ?? 0);
        let currentOrder = insertIndex > 0 ? repaired[insertIndex - 1]!.slotOrder + 1 : 0;
        for (let i = insertIndex; i < repaired.length; i++) {
          if (repaired[i]!.dayIndex !== currentDay) {
            currentDay = repaired[i]!.dayIndex;
            currentOrder = 0;
          }
          repaired[i]!.slotOrder = currentOrder++;
        }

        const slotStartTime = new Date(repaired[insertIndex]!.plannedStart).getTime();
        if (slotStartTime < capturedAtTime) return null;

        const trajectory = this.simulateIfFeasible(repaired, ctx);
        if (!trajectory) return null;

        const affectedIds: string[] = [repaired[insertIndex]!.slotId];
        for (let j = insertIndex; j < plan.length; j++) {
          const origSlot = plan[j]!;
          const repairedSlot = repaired[j + 1];
          if (repairedSlot && (origSlot.plannedStart !== repairedSlot.plannedStart ||
            origSlot.plannedEnd !== repairedSlot.plannedEnd)) {
            affectedIds.push(repairedSlot.slotId);
          }
        }
        return {
          newPlan: repaired,
          operator: 'INSERT_ALT',
          affectedSlotIds: affectedIds,
          repairedFromIndex: insertIndex,
          resumeIndex: insertIndex,
          stateTrajectory: trajectory,
          description: `Chèn ${place.name} ở vị trí ${insertIndex} và tái tối ưu suffix`,
        };
      }

      default:
        return null;
    }
  }
}
