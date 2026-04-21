/**
 * UCB1 (Upper Confidence Bound) Bandit
 *
 * Công thức: UCB1(arm) = avgReward(arm) + sqrt(2 * ln(totalPulls) / pulls(arm))
 *
 * - avgReward cao  → arm này đang hoạt động tốt
 * - sqrt(...)      → arm chưa được thử nhiều sẽ có bonus cao (khuyến khích khám phá)
 * - Kết quả: cân bằng giữa exploit (dùng arm tốt nhất) và explore (thử arm chưa biết)
 */

export interface ArmStat {
  armId: number;
  armName: string;
  pulls: number;
  totalReward: number;
}

export function selectArmUCB1(arms: ArmStat[], totalPulls: number): ArmStat {
  // Nếu có arm chưa được thử lần nào → ưu tiên thử trước (tránh chia 0)
  const untried = arms.find((a) => a.pulls === 0);
  if (untried) return untried;

  // Tính UCB1 score cho từng arm
  const scores = arms.map((arm) => {
    const avgReward = arm.totalReward / arm.pulls;
    const exploration = Math.sqrt((2 * Math.log(totalPulls)) / arm.pulls);
    return { arm, score: avgReward + exploration };
  });

  // Chọn arm có score cao nhất
  scores.sort((a, b) => b.score - a.score);
  return scores[0].arm;
}

/**
 * Tính reward từ hành vi user:
 * - accept replan / accept slot  → reward = 1.0
 * - reject replan / reject slot  → reward = 0.0
 * - slot completed               → reward = 1.0
 * - landmark recognized          → reward = 0.3 (tín hiệu yếu)
 */
export function calcReward(eventType: string, accepted?: boolean): number {
  switch (eventType) {
    case 'replan_accepted':
    case 'poi_accepted':
    case 'slot_completed':
    case 'poi_favorited':
      return 1.0;
    case 'replan_rejected':
    case 'poi_rejected':
      return 0.0;
    case 'landmark_recognized':
      return 0.3;
    default:
      return accepted ? 1.0 : 0.0;
  }
}
