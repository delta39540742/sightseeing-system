import type { TripSlot, TripState, ObjectiveWeights } from '@app/types';
import { type StateEvolver, type ReplanContext, type WeatherSnapshot, dot, tagVectorOf } from './StateEvolver';
import { MutationOperators, GENERATE_ALL_CAP, type MutationResult, type OperatorName } from './MutationOperators';
import { clearSetFeasibilityCache } from './FeasibilityFilter';
import { UCB1Bandit, ALL_OPERATORS, type OperatorFeedback } from './OperatorBandit';
import { propagateConstraints } from './ConstraintPropagation';
import { canPrune } from './CandidatePruner';
import {
  type TrajectoryCache,
  type SlotScoreBreakdown,
  computePlanHash,
  ZERO_SLOT_SCORE,
} from './TrajectoryCache';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BeamSearchConfig {
  beamWidth: number;
  maxIterations: number;
  improvementThreshold: number;
  latencyBudgetMs: number;
  /** UCB1 exploration constant c. Default √2. Set Infinity for uniform (A/B baseline). */
  banditExploration?: number;
  /** Minimum candidates guaranteed to each operator per iteration. Default 1. */
  banditMinAllocation?: number;
  /** Enable UCB1 adaptive allocation. Default true. */
  adaptiveOperators?: boolean;
  /** Log bandit allocation stats to console each iteration. Default false. */
  logBandit?: boolean;
}

const DEFAULT_CONFIG: BeamSearchConfig = {
  beamWidth: 6,
  maxIterations: 20,
  improvementThreshold: 0.001,
  latencyBudgetMs: 4500,
};

// ---------------------------------------------------------------------------
// BeamNode
// ---------------------------------------------------------------------------

export interface BeamNode {
  plan: TripSlot[];
  stateTrajectory: TripState[];
  score: number;
  mutationHistory: MutationResult[];
  parent: BeamNode | null;
  /** Cached prefix states and per-slot scores for incremental computation. */
  trajectoryCache?: TrajectoryCache;
}

// ---------------------------------------------------------------------------
// BeamSearchContext
// ---------------------------------------------------------------------------

export interface BeamSearchContext extends ReplanContext {
  remainingSlots: TripSlot[];
  weights: ObjectiveWeights;
  replanScope?: 'remaining_day' | 'remaining_trip';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @summary Tạo chuỗi đặc trưng (signature) cho một kế hoạch du lịch dựa trên nội dung cấu trúc slot.
 *
 * Sinh ra chuỗi định danh duy nhất cho plan bằng cách ghép nối `placeId`, `dayIndex`,
 * `slotOrder`, `plannedStart`, `plannedEnd` của từng slot theo thứ tự xuất hiện.
 * Hai plan có cùng địa điểm tại cùng thời điểm sẽ tạo ra cùng signature **bất kể `slotId`** —
 * đây là ngữ nghĩa *structural* (cấu trúc).
 *
 * **Side Effects:** Không có. Hàm thuần túy (pure function).
 *
 * **Lưu ý thiết kế [Design 1 — Dual planSignature]:**
 * Hàm này dùng khóa `placeId + timing`, khác với `MutationOperators.planSignature()` dùng
 * `slotId + version` (identity). Vì `insertAlt()` sinh UUID mới cho slot, cùng một plan vật lý
 * có thể cho signature khác nhau ở `MutationOperators` nhưng giống nhau ở đây.
 * Hậu quả: dedup trong `generateAll()` và dedup trong `search()` dùng quy tắc tương đương
 * khác nhau — một số trùng lặp có thể vượt qua lớp này nhưng bị bắt ở lớp kia.
 *
 * **TODO:** Trích xuất hàm dùng chung `structuralSignature(plan)` khóa trên `placeId + times`
 * để nhất quán hóa logic dedup tại cả hai nơi.
 *
 * @param plan {TripSlot[]} Danh sách slot cần tạo signature — không được null, có thể rỗng.
 * @returns {string} Chuỗi dạng `"placeId:dayIndex:slotOrder:start:end|..."`.
 *   Trả về chuỗi rỗng `""` khi `plan` rỗng.
 *
 * @pre `plan` là mảng hợp lệ (không null).
 * @post Mảng đầu vào không bị thay đổi. Kết quả là chuỗi bất biến.
 *
 * @example
 * ```typescript
 * const sig = planSignature([{
 *   placeId: 1, dayIndex: 0, slotOrder: 0,
 *   plannedStart: '2026-04-21T01:00:00Z', plannedEnd: '2026-04-21T03:00:00Z'
 * }]);
 * // => "1:0:0:2026-04-21T01:00:00Z:2026-04-21T03:00:00Z"
 * ```
 */
function planSignature(plan: TripSlot[]): string {
  return plan
    .map((slot) => [
      slot.placeId,
      slot.dayIndex,
      slot.slotOrder,
      slot.plannedStart,
      slot.plannedEnd,
    ].join(':'))
    .join('|');
}

/**
 * @summary Đếm tổng số slot duy nhất bị ảnh hưởng trong toàn bộ lịch sử mutation.
 *
 * Gom tất cả `affectedSlotIds` từ mọi bước mutation vào một Set để loại trùng, rồi đếm kích thước.
 * Kết quả càng lớn thì plan càng bị xáo trộn nhiều và sẽ bị `ObjectiveScorer` phạt nặng hơn
 * qua chiều `wStability`.
 *
 * **Side Effects:** Không có. Hàm thuần túy.
 *
 * @param history {MutationResult[]} Lịch sử các phép biến đổi đã áp dụng cho plan.
 *   Mảng rỗng sẽ trả về 0.
 * @returns {number} Số lượng slotId duy nhất bị thay đổi. Luôn ≥ 0.
 *
 * @pre `history` là mảng hợp lệ (không null).
 * @post Không thay đổi bất kỳ đối tượng nào trong `history`.
 *
 * @example
 * ```typescript
 * const history = [
 *   { affectedSlotIds: ['s1', 's2'], operator: 'TIME_SHIFT', ... },
 *   { affectedSlotIds: ['s2', 's3'], operator: 'SWAP_ORDER',  ... },
 * ];
 * countChanges(history); // => 3 (s1, s2, s3 — s2 chỉ tính 1 lần)
 * ```
 */
function countChanges(history: MutationResult[]): number {
  const seen = new Set<string>();
  for (const m of history) {
    for (const id of m.affectedSlotIds) seen.add(id);
  }
  return seen.size;
}

/**
 * Jaccard similarity between two plans based on their sets of placeIds.
 * Range [0, 1]: 1 = identical place sets, 0 = fully disjoint.
 */
function planSimilarity(a: BeamNode, b: BeamNode): number {
  const setA = new Set(a.plan.map((s) => s.placeId));
  const setB = new Set(b.plan.map((s) => s.placeId));
  let intersection = 0;
  for (const id of setA) {
    if (setB.has(id)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Maximum Marginal Relevance beam selection.
 *
 * Greedily picks nodes that maximise `score − λ·maxSimilarityToAlreadySelected`.
 * This keeps the beam diverse (avoiding collapse to a single local optimum) while
 * still preferring high-scoring candidates when similarity is low.
 *
 * λ=0 → pure score ranking (same as slice(0, k)).
 * λ=1 → pure diversity (maximises spread).
 * λ=0.3 is a good default: lets quality win unless two plans are nearly identical.
 */
function mmrSelect(candidates: BeamNode[], k: number, lambda = 0.3): BeamNode[] {
  if (candidates.length <= k) return candidates;
  const selected: BeamNode[] = [];
  const remaining = [...candidates];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i]!.score;
      const maxSim = selected.length === 0
        ? 0
        : Math.max(...selected.map((s) => planSimilarity(remaining[i]!, s)));
      const mmr = relevance - lambda * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]!);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// ObjectiveScorer
// ---------------------------------------------------------------------------

/**
 * @summary Tính điểm mục tiêu đa chiều (multi-objective score) cho một plan và lịch sử mutation.
 *
 * Đánh giá toàn diện một phương án kế hoạch du lịch trên 7 tiêu chí: mức độ phù hợp sở thích
 * (`interest`), nhịp độ di chuyển (`pace`), chi phí di chuyển (`distance`), ngân sách (`budget`),
 * thời tiết (`weather`), rủi ro mệt mỏi (`risk`), và độ ổn định kế hoạch (`stability`).
 * Điểm cuối cùng là tổ hợp tuyến tính có trọng số của 7 chiều đó.
 *
 * **Side Effects:** Gọi `evolver.estimateTravelTime()` để ước tính khoảng cách địa lý;
 * ngoài ra không có I/O hay side effect khác.
 */
export class ObjectiveScorer {
  constructor(private readonly evolver: StateEvolver) { }

  /**
   * @summary Tính điểm tổng hợp cho một plan dựa trên 7 tiêu chí mục tiêu.
   *
   * Duyệt qua từng slot trong plan, cộng dồn điểm theo từng chiều:
   * - **interest**: Tích vô hướng giữa vector sở thích người dùng và vector tag của địa điểm.
   * - **distance**: Âm của tổng thời gian di chuyển chia 60 (phạt lộ trình xa).
   * - **budget**: Phạt âm (`−|budgetRemaining| × 0.001`) khi vượt ngân sách.
   * - **weather**: +1 khi indoor và mưa ≥ 5mm/h; −1 khi outdoor và mưa; thêm −travelMin/30 khi transit dưới mưa.
   * - **risk**: Âm của tổng `fatigue` tích lũy sau mỗi slot.
   * - **stability**: `−countChanges(history)` — càng ít thay đổi, điểm càng cao.
   * - **potentialBias**: +0.75 cho địa điểm tiềm năng; +1.25 cho địa điểm bắt buộc.
   * - **proximity**: `max(0, 1 − travelMin/15)` cho mỗi slot khi `ctx.userIsAtVenue=true` —
   *   thưởng điểm cao cho địa điểm gần nơi user đã đến để giảm cảm giác "mất công di chuyển".
   *
   * **Side Effects:** Không có. Hàm thuần túy sau khi `evolver` được inject.
   *
   * @param plan    {TripSlot[]}       Kế hoạch cần chấm điểm — có thể rỗng (trả về 0.0).
   * @param states  {TripState[]}      Quỹ đạo trạng thái dài `plan.length + 1`; `states[i+1]`
   *   là trạng thái sau khi ghé `plan[i]`. Slot thiếu state tương ứng sẽ bị bỏ qua.
   * @param weights {ObjectiveWeights} Hệ số trọng số cho từng chiều. Không được null.
   * @param ctx     {BeamSearchContext} Ngữ cảnh chứa candidatePool, user, weatherForecast...
   * @param history {MutationResult[]} Lịch sử mutation dùng tính `stability`. Mặc định `[]`.
   * @returns {number} Điểm tổng hợp — không có giới hạn cứng; điểm dương là tốt hơn baseline.
   *
   * @pre `states.length === plan.length + 1` để tra cứu đúng trạng thái trước/sau mỗi slot.
   * @post Không thay đổi `plan`, `states`, `ctx`, hay `history`.
   *
   * @example
   * ```typescript
   * const scorer = new ObjectiveScorer(evolver);
   * const score = scorer.score(plan, states, weights, ctx, mutationHistory);
   * // score > 0 → plan tốt hơn baseline
   * // score < 0 → plan tệ hơn baseline
   * ```
   */
  score(
    plan: TripSlot[],
    states: TripState[],
    weights: ObjectiveWeights,
    ctx: BeamSearchContext,
    history: MutationResult[] = [],
  ): number {
    let interest = 0;
    let distance = 0;
    let budget = 0;
    let weather = 0;
    let risk = 0;
    let stability = 0;
    let potentialBias = 0;
    let proximity = 0;
    let synergy = 0;

    const placeMap = ctx.placeMap ?? new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
    const potentialSet = new Set(ctx.potentialPlaceIds ?? []);
    const requiredSet = new Set(ctx.requiredPlaceIds ?? []);

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = placeMap.get(slot.placeId);
      if (!place) continue;

      const stateAfter = states[i + 1];
      if (!stateAfter) continue;

      interest += dot(ctx.user.preferenceVector, tagVectorOf(place));

      const prevState = states[i];
      if (prevState) {
        distance -= this.travelTimeMin(prevState, place) / 60;
      }

      if (stateAfter.budgetRemaining < 0) {
        budget -= 10000 + Math.abs(stateAfter.budgetRemaining) * 0.1;
      }

      const rainMmPerH = ctx.weatherForecast?.[slot.dayIndex]?.rainMmPerH ?? 0;
      if (rainMmPerH >= 5) {
        if (place.indoorOutdoor === 'indoor') weather += 1;
        else if (place.indoorOutdoor === 'outdoor') weather -= 1;
        // Penalize transit time in rain: traveling between places exposes the user
        // to rain even when both endpoints are indoor. 30 min transit = -1 point.
        if (prevState) {
          weather -= this.travelTimeMin(prevState, place) / 30;
        }
      }

      risk -= stateAfter.fatigue;
      if (stateAfter.fatigue > 0.95) {
        risk -= 10000 + (stateAfter.fatigue - 0.95) * 100000;
      }
    }

    for (const slot of plan) {
      if (potentialSet.has(slot.placeId)) potentialBias += 0.75;
      if (requiredSet.has(slot.placeId)) potentialBias += 1.25;
    }

    // Proximity bonus: reward alternatives near the venue the user already
    // reached. Only active when userIsAtVenue=true (GPS confirmed arrival).
    // 15-minute travel from venue = 0 bonus; 0 minutes = +1 per slot.
    if (ctx.userIsAtVenue && ctx.venueLatLng) {
      const { lat: vLat, lng: vLng } = ctx.venueLatLng;
      for (const slot of plan) {
        const place = placeMap.get(slot.placeId);
        if (!place) continue;
        const travelMin = this.evolver.estimateTravelTime(vLat, vLng, place.lat, place.lng);
        proximity += Math.max(0, 1 - travelMin / 15);
      }
    }

    for (let i = 0; i < plan.length - 1; i++) {
      const pA = placeMap.get(plan[i]!.placeId);
      const pB = placeMap.get(plan[i + 1]!.placeId);
      if (pA && pB) synergy += dot(tagVectorOf(pA), tagVectorOf(pB));
    }

    const paceFit = this.computePaceFit(plan, ctx.user.pace);
    stability = -countChanges(history);

    let timePenalty = 0;
    if (states.length > 0) {
      const finalState = states[states.length - 1];
      if (finalState && finalState.timeRemainingMin < 0) {
        timePenalty = 10000 + Math.abs(finalState.timeRemainingMin) * 1000;
      }
    }

    return (
      weights.wInterest * interest +
      weights.wPace * paceFit +
      weights.wDistance * distance +
      weights.wBudget * budget +
      weights.wWeather * weather +
      weights.wRisk * risk +
      weights.wStability * stability +
      weights.wPotentialBias * potentialBias +
      weights.wProximity * proximity +
      (weights.wSynergy ?? 0) * synergy -
      timePenalty
    );
  }

  /**
   * @summary Ước tính thời gian di chuyển (phút) từ trạng thái hiện tại đến một địa điểm.
   *
   * Uỷ thác cho `StateEvolver.estimateTravelTime()` với tọa độ lấy từ `state.currentLat/Lng`.
   * Trả về 0 ngay lập tức nếu vị trí hiện tại chưa được xác định (`null`).
   *
   * **Side Effects:** Không có.
   *
   * @param state {TripState}                   Trạng thái hiện tại — tọa độ được lấy từ đây.
   * @param place {{ lat: number; lng: number }} Tọa độ địa điểm đích.
   * @returns {number} Thời gian di chuyển ước tính (phút) — luôn ≥ 0.
   *   Trả về 0 khi `state.currentLat` hoặc `state.currentLng` là `null`.
   *
   * @pre `place.lat` và `place.lng` là số hữu hạn hợp lệ.
   * @post Không thay đổi `state` hay `place`.
   *
   * @example
   * ```typescript
   * const minutes = scorer['travelTimeMin'](currentState, { lat: 16.05, lng: 108.20 });
   * // => 12.3 (phút) hoặc 0 nếu chưa có vị trí
   * ```
   */
  private travelTimeMin(state: TripState, place: { lat: number; lng: number }): number {
    if (state.currentLat == null || state.currentLng == null) return 0;
    return this.evolver.estimateTravelTime(
      state.currentLat,
      state.currentLng,
      place.lat,
      place.lng
    );
  }

  /**
   * @summary Tính điểm phù hợp nhịp độ (pace fitness) so với sở thích tốc độ di chuyển của người dùng.
   *
   * So sánh số slot trung bình mỗi ngày trong plan với số slot lý tưởng theo `preferredPace`.
   * Công thức mục tiêu: `targetSlotsPerDay = 3 + preferredPace × 4`
   * (pace=0 → 3 slot/ngày thư thả; pace=1 → 7 slot/ngày dày đặc).
   * Điểm phù hợp giảm tuyến tính theo độ lệch: `1 − |diff| / 4`.
   * Điểm có thể âm khi plan quá dày hoặc quá thưa so với sở thích người dùng.
   *
   * **Side Effects:** Không có. Hàm thuần túy.
   *
   * @param plan          {TripSlot[]} Kế hoạch cần đánh giá nhịp độ. Trả về 1.0 nếu rỗng.
   * @param preferredPace {number}     Nhịp độ mong muốn trong [0, 1] — 0: thư thả, 1: dày đặc.
   * @returns {number} Điểm pace fitness; 1.0 là hoàn hảo, có thể âm khi lệch lớn.
   *
   * @pre `preferredPace` nằm trong khoảng [0, 1].
   * @post Không thay đổi `plan`.
   *
   * @example
   * ```typescript
   * // plan: ngày 1 có 3 slot, ngày 2 có 5 slot → avgSlotsPerDay = 4
   * // preferredPace = 0.5 → target = 3 + 0.5×4 = 5
   * // diff = |4 − 5| = 1 → score = 1 − 1/4 = 0.75
   * computePaceFit(plan, 0.5); // => 0.75
   * ```
   */
  private computePaceFit(plan: TripSlot[], preferredPace: number): number {
    if (plan.length === 0) return 1;
    const dayMap = new Map<number, number>();
    for (const s of plan) {
      dayMap.set(s.dayIndex, (dayMap.get(s.dayIndex) ?? 0) + 1);
    }
    const avgSlotsPerDay = [...dayMap.values()].reduce((a, b) => a + b, 0) / dayMap.size;
    const targetSlotsPerDay = 3 + preferredPace * 4;
    const diff = Math.abs(avgSlotsPerDay - targetSlotsPerDay);
    return 1 - diff / 4;
  }

  // ---------------------------------------------------------------------------
  // Incremental scoring helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute raw (unweighted) per-slot score contributions for one slot.
   * `prevState` is states[i] (the state BEFORE visiting slot i).
   * `stateAfter` is states[i+1] (the state AFTER visiting slot i).
   */
  private computeSlotBreakdown(
    slot: TripSlot,
    place: { lat: number; lng: number; indoorOutdoor: string; tags?: ReadonlyArray<{ tagId: number }> | null },
    stateAfter: TripState,
    prevState: TripState | undefined,
    ctx: BeamSearchContext,
    potentialSet: Set<number>,
    requiredSet: Set<number>,
  ): SlotScoreBreakdown {
    const interest = dot(ctx.user.preferenceVector, tagVectorOf(place));
    const distance = prevState ? -this.travelTimeMin(prevState, place as { lat: number; lng: number }) / 60 : 0;
    const budget = stateAfter.budgetRemaining < 0
      ? -(10000 + Math.abs(stateAfter.budgetRemaining) * 0.1)
      : 0;

    const rainMmPerH = ctx.weatherForecast?.[slot.dayIndex]?.rainMmPerH ?? 0;
    let weather = 0;
    if (rainMmPerH >= 5) {
      if (place.indoorOutdoor === 'indoor') weather += 1;
      else if (place.indoorOutdoor === 'outdoor') weather -= 1;
      if (prevState) {
        weather -= this.travelTimeMin(prevState, place as { lat: number; lng: number }) / 30;
      }
    }

    let risk = -stateAfter.fatigue;
    if (stateAfter.fatigue > 0.95) {
      risk -= 10000 + (stateAfter.fatigue - 0.95) * 100000;
    }

    let potentialBias = 0;
    if (potentialSet.has(slot.placeId)) potentialBias += 0.75;
    if (requiredSet.has(slot.placeId)) potentialBias += 1.25;

    let proximity = 0;
    if (ctx.userIsAtVenue && ctx.venueLatLng) {
      const { lat: vLat, lng: vLng } = ctx.venueLatLng;
      const travelMin = this.evolver.estimateTravelTime(vLat, vLng,
        (place as { lat: number; lng: number }).lat, (place as { lat: number; lng: number }).lng);
      proximity = Math.max(0, 1 - travelMin / 15);
    }

    return { interest, distance, budget, weather, risk, potentialBias, proximity };
  }

  /**
   * Like {@link score} but also returns a populated {@link TrajectoryCache} for
   * use in subsequent incremental scoring calls.
   *
   * This is the entry point for the root beam node and for any fallback path
   * where no parent cache is available.
   */
  scoreFullAndCache(
    plan: TripSlot[],
    states: TripState[],
    weights: ObjectiveWeights,
    ctx: BeamSearchContext,
    history: MutationResult[] = [],
  ): { total: number; cache: TrajectoryCache } {
    const placeMap = ctx.placeMap ?? new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
    const potentialSet = new Set(ctx.potentialPlaceIds ?? []);
    const requiredSet = new Set(ctx.requiredPlaceIds ?? []);

    const slotScores: SlotScoreBreakdown[] = [];
    const synergyPairs: number[] = [];
    let slotScoreSum = 0;
    let synergy = 0;

    for (let i = 0; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = placeMap.get(slot.placeId);
      const stateAfter = states[i + 1];

      if (!place || !stateAfter) {
        slotScores.push({ ...ZERO_SLOT_SCORE });
        continue;
      }

      const prevState = states[i];
      const bd = this.computeSlotBreakdown(slot, place, stateAfter, prevState, ctx, potentialSet, requiredSet);
      slotScores.push(bd);

      slotScoreSum +=
        weights.wInterest * bd.interest +
        weights.wDistance * bd.distance +
        weights.wBudget * bd.budget +
        weights.wWeather * bd.weather +
        weights.wRisk * bd.risk +
        weights.wPotentialBias * bd.potentialBias +
        weights.wProximity * bd.proximity;

      if (i < plan.length - 1) {
        const pB = placeMap.get(plan[i + 1]!.placeId);
        const pairScore = pB ? dot(tagVectorOf(place), tagVectorOf(pB)) : 0;
        synergyPairs.push(pairScore);
        synergy += pairScore;
      }
    }

    const pace = this.computePaceFit(plan, ctx.user.pace);
    const stability = -countChanges(history);

    let timePenalty = 0;
    if (states.length > 0) {
      const finalState = states[states.length - 1];
      if (finalState && finalState.timeRemainingMin < 0) {
        timePenalty = 10000 + Math.abs(finalState.timeRemainingMin) * 1000;
      }
    }

    const total =
      slotScoreSum +
      weights.wPace * pace +
      weights.wStability * stability +
      (weights.wSynergy ?? 0) * synergy -
      timePenalty;

    const cache: TrajectoryCache = {
      states,
      slotScores,
      planScores: { pace, synergy, synergyPairs },
      planHash: computePlanHash(plan),
    };
    return { total, cache };
  }

  /**
   * Incremental scoring.
   *
   * Reuses per-slot score breakdowns from `parentCache` for slots
   * 0..resumeIndex-1 (the unchanged prefix) and recomputes from `resumeIndex`.
   * Plan-level components (pace, synergy) are updated incrementally.
   * Stability is always recomputed from `history` (history-dependent).
   *
   * Falls back to {@link scoreFullAndCache} when `parentCache` is absent or
   * `resumeIndex` is 0.
   */
  scoreDelta(
    plan: TripSlot[],
    states: TripState[],
    weights: ObjectiveWeights,
    ctx: BeamSearchContext,
    history: MutationResult[],
    parentCache: TrajectoryCache | null | undefined,
    resumeIndex: number,
  ): { total: number; cache: TrajectoryCache } {
    if (!parentCache || resumeIndex <= 0) {
      return this.scoreFullAndCache(plan, states, weights, ctx, history);
    }

    const placeMap = ctx.placeMap ?? new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
    const potentialSet = new Set(ctx.potentialPlaceIds ?? []);
    const requiredSet = new Set(ctx.requiredPlaceIds ?? []);

    // === Per-slot components ===
    // Reuse prefix slot scores (index 0..resumeIndex-1), recompute suffix.
    const prefixLen = Math.min(resumeIndex, parentCache.slotScores.length, plan.length);
    const slotScores: SlotScoreBreakdown[] = parentCache.slotScores.slice(0, prefixLen);

    let slotScoreSum = 0;
    for (const bd of slotScores) {
      slotScoreSum +=
        weights.wInterest * bd.interest +
        weights.wDistance * bd.distance +
        weights.wBudget * bd.budget +
        weights.wWeather * bd.weather +
        weights.wRisk * bd.risk +
        weights.wPotentialBias * bd.potentialBias +
        weights.wProximity * bd.proximity;
    }

    for (let i = prefixLen; i < plan.length; i++) {
      const slot = plan[i]!;
      const place = placeMap.get(slot.placeId);
      const stateAfter = states[i + 1];

      if (!place || !stateAfter) {
        slotScores.push({ ...ZERO_SLOT_SCORE });
        continue;
      }

      const prevState = states[i];
      const bd = this.computeSlotBreakdown(slot, place, stateAfter, prevState, ctx, potentialSet, requiredSet);
      slotScores.push(bd);

      slotScoreSum +=
        weights.wInterest * bd.interest +
        weights.wDistance * bd.distance +
        weights.wBudget * bd.budget +
        weights.wWeather * bd.weather +
        weights.wRisk * bd.risk +
        weights.wPotentialBias * bd.potentialBias +
        weights.wProximity * bd.proximity;
    }

    // === Synergy: reuse pairs 0..resumeIndex-2, recompute from resumeIndex-1 ===
    const keepPairs = Math.max(0, prefixLen - 1);
    const synergyPairs: number[] = parentCache.planScores.synergyPairs.slice(0, keepPairs);
    let synergy = synergyPairs.reduce((a, b) => a + b, 0);

    for (let i = Math.max(0, prefixLen - 1); i < plan.length - 1; i++) {
      const pA = placeMap.get(plan[i]!.placeId);
      const pB = placeMap.get(plan[i + 1]!.placeId);
      const pairScore = pA && pB ? dot(tagVectorOf(pA), tagVectorOf(pB)) : 0;
      synergyPairs.push(pairScore);
      synergy += pairScore;
    }

    // Pace: always recompute (O(N) but very cheap — just a dayMap count).
    const pace = this.computePaceFit(plan, ctx.user.pace);
    // Stability: always recompute (depends on history, which grows each iteration).
    const stability = -countChanges(history);

    let timePenalty = 0;
    if (states.length > 0) {
      const finalState = states[states.length - 1];
      if (finalState && finalState.timeRemainingMin < 0) {
        timePenalty = 10000 + Math.abs(finalState.timeRemainingMin) * 1000;
      }
    }

    const total =
      slotScoreSum +
      weights.wPace * pace +
      weights.wStability * stability +
      (weights.wSynergy ?? 0) * synergy -
      timePenalty;

    const cache: TrajectoryCache = {
      states,
      slotScores,
      planScores: { pace, synergy, synergyPairs },
      planHash: computePlanHash(plan),
    };
    return { total, cache };
  }
}

// ---------------------------------------------------------------------------
// Reward collection (for UCB1 bandit)
// ---------------------------------------------------------------------------

/**
 * Compute per-operator survival counts for one beam-search iteration.
 *
 * A candidate "survived" if its plan signature appears in `newBeam`.
 * Reward is attributed to the last mutation in the candidate's history,
 * which is the operator that produced the plan for this iteration.
 */
export function collectFeedback(
  newBeam: BeamNode[],
  allCandidates: BeamNode[],
  generatedCounts: Map<OperatorName, number>,
): OperatorFeedback[] {
  const beamSigs = new Set(newBeam.map(n => planSignature(n.plan)));
  const survivedCounts = new Map<OperatorName, number>();
  for (const op of ALL_OPERATORS) survivedCounts.set(op, 0);

  for (const candidate of allCandidates) {
    if (!beamSigs.has(planSignature(candidate.plan))) continue;
    const lastMut = candidate.mutationHistory[candidate.mutationHistory.length - 1];
    if (lastMut) {
      survivedCounts.set(lastMut.operator, (survivedCounts.get(lastMut.operator) ?? 0) + 1);
    }
  }

  return ALL_OPERATORS.map(op => ({
    operator: op,
    candidatesGenerated: generatedCounts.get(op) ?? 0,
    candidatesSurvived: survivedCounts.get(op) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// BeamSearch
// ---------------------------------------------------------------------------

/**
 * @summary Thuật toán Beam Search tìm kiếm phương án tái lập lịch tối ưu cho chuyến đi.
 *
 * Thực hiện tìm kiếm heuristic theo chiều rộng có giới hạn (bounded-width BFS) trong không gian
 * các biến đổi kế hoạch. Mỗi vòng lặp mở rộng `beamWidth` ứng viên tốt nhất bằng cách áp dụng
 * tất cả `MutationOperators`, chấm điểm qua `ObjectiveScorer`, và giữ lại top-K ứng viên.
 *
 * **Cơ chế dừng sớm:**
 * - Đạt `maxIterations` vòng lặp.
 * - Hết `latencyBudgetMs` (mặc định 4500ms).
 * - Độ cải thiện điểm giữa hai vòng < `improvementThreshold`.
 * - Beam rỗng (tất cả ứng viên đều infeasible).
 *
 * **Side Effects:** Gọi `Date.now()` để kiểm soát latency budget; ngoài ra không có I/O hay DB access.
 * Kết quả hoàn toàn xác định theo input nếu `Date.now()` được mock trong test.
 */
export class BeamSearch {
  private readonly bandit: UCB1Bandit;

  constructor(
    private readonly evolver: StateEvolver,
    public readonly operators: MutationOperators,
    private readonly scorer: ObjectiveScorer,
    public readonly config: BeamSearchConfig = DEFAULT_CONFIG
  ) {
    this.bandit = new UCB1Bandit({
      explorationConstant: config.banditExploration,
      minAllocation: config.banditMinAllocation,
    });
  }

  /**
   * @summary Thực thi Beam Search và trả về BeamNode tốt nhất tìm được trong latency budget.
   *
   * Khởi tạo root node từ `ctx.remainingSlots`, sau đó lặp lại quy trình mở rộng và lọc:
   * 1. Với mỗi node trong beam, gọi `operators.generateAll()` để sinh ứng viên mới.
   * 2. Mô phỏng quỹ đạo trạng thái bằng `evolver.computeTrajectory()` cho từng ứng viên.
   * 3. Lọc ứng viên vi phạm ràng buộc cứng (`states[1..]` phải tất cả feasible).
   * 4. Chấm điểm ứng viên còn lại bằng `scorer.score()`.
   * 5. Sắp xếp giảm dần, dedup bằng `planSignature()`, giữ lại `beamWidth` ứng viên đầu.
   * 6. Cập nhật `bestNode` nếu ứng viên tốt nhất có điểm cao hơn.
   * 7. Kiểm tra điều kiện dừng (timeout, improvement threshold, beam rỗng).
   *
   * **Side Effects:**
   * - Gọi `Date.now()` nhiều lần để kiểm tra latency (có thể bị spy trong test).
   * - Không ghi database, không I/O.
   *
   * **Lưu ý [Bug 1 — Double Simulation]:** `generateAll()` đã mô phỏng trajectory nội bộ
   * qua `allFeasible()`, nhưng `search()` mô phỏng lại lần hai → lãng phí ~50% tính toán.
   * TODO: tối ưu bằng cách cache states trong `MutationResult`.
   *
   * @param ctx {BeamSearchContext} Ngữ cảnh đầy đủ gồm `remainingSlots`, `initialState`,
   *   `weights`, `candidatePool`, `user`, `weatherForecast`. Không được null.
   * @returns {BeamNode} Node tốt nhất tìm được — có thể là root nếu không có ứng viên nào tốt hơn.
   *   `bestNode.plan` luôn là kế hoạch feasible.
   *   `bestNode.score` là điểm ObjectiveScorer tại thời điểm tìm thấy.
   *   `bestNode.mutationHistory` là chuỗi mutation dẫn đến plan này (dùng cho CausalTrace).
   * @throws Không ném exception. Lỗi trong `computeTrajectory()` bị bắt và ứng viên đó bị bỏ qua.
   *
   * @pre Mọi `placeId` trong `ctx.remainingSlots` phải tồn tại trong `ctx.candidatePool`.
   *   `ctx.initialState` hợp lệ và feasible tại thời điểm gọi.
   * @post Trả về node feasible. Không thay đổi `ctx`.
   *
   * @example
   * ```typescript
   * const beamSearch = new BeamSearch(evolver, operators, scorer, {
   *   beamWidth: 6, maxIterations: 20, improvementThreshold: 0.01, latencyBudgetMs: 4500,
   * });
   * const bestNode = beamSearch.search(ctx);
   * console.log(bestNode.plan);           // Kế hoạch tốt nhất tìm được
   * console.log(bestNode.score);          // Điểm mục tiêu
   * console.log(bestNode.mutationHistory); // Chuỗi mutation để tạo CausalTrace
   * ```
   */
  search(ctx: BeamSearchContext): BeamNode {
    const startTime = Date.now();
    // Build placeMap once per request and thread through all sub-calls to avoid
    // O(candidatePool) rebuilds on every computeTrajectory / repairSuffix invocation.
    const placeMap = new Map(ctx.candidatePool.map((p) => [p.placeId, p]));
    const ctxWithMap: BeamSearchContext = { ...ctx, placeMap };
    // Clear per-request LB cache so stale results from prior requests don't bleed through.
    clearSetFeasibilityCache();

    const rootPlan = ctxWithMap.remainingSlots;
    const rootStates = this.evolver.computeTrajectory(rootPlan, ctxWithMap.initialState, ctxWithMap);
    const { total: rootScore, cache: rootCache } =
      this.scorer.scoreFullAndCache(rootPlan, rootStates, ctxWithMap.weights, ctxWithMap, []);

    const rootNode: BeamNode = {
      plan: rootPlan,
      stateTrajectory: rootStates,
      score: rootScore,
      mutationHistory: [],
      parent: null,
      trajectoryCache: rootCache,
    };

    let beam: BeamNode[] = [rootNode];
    let bestNode = rootNode;
    let prevBestScore = rootScore;

    const useAdaptive = this.config.adaptiveOperators !== false;
    this.bandit.reset();

    for (let iter = 0; iter < this.config.maxIterations; iter++) {
      if (Date.now() - startTime > this.config.latencyBudgetMs) break;

      const candidates: BeamNode[] = [];
      const iterGeneratedCounts = new Map<OperatorName, number>();
      const allocation = useAdaptive ? this.bandit.allocate(GENERATE_ALL_CAP) : null;

      for (const node of beam) {
        if (Date.now() - startTime > this.config.latencyBudgetMs) break;

        let mutations: MutationResult[];
        if (useAdaptive && allocation) {
          const result = this.operators.generateAllAdaptive(node.plan, ctxWithMap, allocation);
          mutations = result.candidates;
          for (const [op, count] of result.generatedCounts) {
            iterGeneratedCounts.set(op, (iterGeneratedCounts.get(op) ?? 0) + count);
          }
        } else {
          const windows = propagateConstraints(
            node.plan, ctxWithMap.initialState, this.evolver, ctxWithMap.placeMap!,
          );
          const proposed = this.operators.generateAllProposed(node.plan, ctxWithMap);
          const surviving = proposed.filter((p) => !canPrune(p, node.plan, windows));
          const materialized: MutationResult[] = [];
          for (const p of surviving) {
            const m = this.operators.materializeMutation(p, node.plan, ctxWithMap);
            if (m) materialized.push(m);
          }
          mutations = materialized;
        }

        for (const m of mutations) {
          // [Design 4] Latency check per-mutation, not only per-node. generateAll() can return
          // up to GENERATE_ALL_CAP=30 items and each trajectory below costs O(slots) work.
          if (Date.now() - startTime > this.config.latencyBudgetMs) break;

          // [Bug 1 fix] Reuse the trajectory already computed by simulateIfFeasible() inside
          // the mutation operator. Falls back to a fresh computeTrajectory() only for candidates
          // that somehow arrive without a cached trajectory (e.g. future operator additions).
          let states: TripState[];
          if (m.stateTrajectory) {
            states = m.stateTrajectory; // feasibility already validated by simulateIfFeasible
          } else {
            try {
              states = this.evolver.computeTrajectory(m.newPlan, ctxWithMap.initialState, ctxWithMap);
            } catch {
              continue;
            }
            if (!states.slice(1).every((s) => this.evolver.isFeasible(s))) continue;
          }

          const newHistory = [...node.mutationHistory, m];
          const { total: score, cache: newCache } = this.scorer.scoreDelta(
            m.newPlan,
            states,
            ctxWithMap.weights,
            ctxWithMap,
            newHistory,
            node.trajectoryCache ?? null,
            m.resumeIndex ?? 0,
          );
          candidates.push({
            plan: m.newPlan,
            stateTrajectory: states,
            score,
            mutationHistory: newHistory,
            parent: node,
            trajectoryCache: newCache,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const deduped: BeamNode[] = [];
      for (const cand of candidates) {
        const sig = planSignature(cand.plan);
        if (!seen.has(sig)) {
          seen.add(sig);
          deduped.push(cand);
        }
      }

      beam = mmrSelect(deduped, this.config.beamWidth);

      if (useAdaptive && allocation) {
        const feedbacks = collectFeedback(beam, candidates, iterGeneratedCounts);
        this.bandit.update(feedbacks);
        if (this.config.logBandit) {
          const stats = this.bandit.getStats();
          console.log(`[BeamSearch iter=${iter}] Bandit allocation:`,
            Object.fromEntries(
              [...stats.perOperator.entries()].map(([op, s]) =>
                [op, {
                  alloc: allocation.get(op),
                  avgReward: s.avgReward.toFixed(3),
                  ucb: isFinite(s.ucbScore) ? s.ucbScore.toFixed(3) : 'Inf',
                }]
              )
            )
          );
        }
      }

      if (beam.length === 0) break;

      if (beam[0]!.score > bestNode.score) {
        bestNode = beam[0]!;
      }

      if (iter > 0) {
        const denom = Math.abs(prevBestScore) > Number.EPSILON ? Math.abs(prevBestScore) : Number.EPSILON;
        const improvement = (beam[0]!.score - prevBestScore) / denom;
        if (improvement < this.config.improvementThreshold) break;
      }
      prevBestScore = beam[0]!.score;
    }

    return bestNode;
  }
}

export default BeamSearch;
