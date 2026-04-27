import { prisma } from '../lib/prisma';
import { selectArmUCB1, calcReward } from '../lib/ucb1';
import { calcBaseWeights } from '../lib/preference';
import { WeightsResponse } from '../types';

// ─── B1: GET weights (Người 4 và 6 gọi) ──────────────────────────────────────

export async function getWeights(userId: string): Promise<WeightsResponse> {
  const [objWeights, preference] = await Promise.all([
    prisma.userObjectiveWeights.findUnique({
      where: { userId },
      include: { arm: true },
    }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ]);

  if (!objWeights) {
    const defaultArm = await prisma.banditArm.findFirst({ where: { name: 'balanced' } });
    if (!defaultArm) throw new Error('bandit_arm table chưa được seed');

    return {
      weights: {
        wInterest: defaultArm.wInterest,
        wPace:     defaultArm.wPace,
        wDistance: defaultArm.wDistance,
        wBudget:   defaultArm.wBudget,
        wWeather:  defaultArm.wWeather,
        wRisk:     defaultArm.wRisk,
      },
      softConstraints: [],
      currentArmId: defaultArm.armId,
      armName: defaultArm.name,
      preferenceVector: preference?.preferenceVector ?? [],
      preferredTagIds: preference?.preferredTagIds ?? [],
      pace: preference?.pace ?? 0.5,
      budgetPerDayMin: preference?.budgetPerDayMin ?? 0,
      budgetPerDayMax: preference?.budgetPerDayMax ?? 0,
      mobilityRestrictions: preference?.mobilityRestrictions ?? [],
    };
  }

  return {
    weights: {
      wInterest: objWeights.wInterest,
      wPace:     objWeights.wPace,
      wDistance: objWeights.wDistance,
      wBudget:   objWeights.wBudget,
      wWeather:  objWeights.wWeather,
      wRisk:     objWeights.wRisk,
    },
    softConstraints: (objWeights.softConstraints as any[]) ?? [],
    currentArmId: objWeights.currentArmId,
    armName: objWeights.arm.name,
    preferenceVector: preference?.preferenceVector ?? [],
    preferredTagIds: preference?.preferredTagIds ?? [],
    pace: preference?.pace ?? 0.5,
    budgetPerDayMin: preference?.budgetPerDayMin ?? 0,
    budgetPerDayMax: preference?.budgetPerDayMax ?? 0,
    mobilityRestrictions: preference?.mobilityRestrictions ?? [],
  };
}

// ─── UCB1: Chọn arm mới và cập nhật weights ───────────────────────────────────

export async function selectAndApplyArm(userId: string): Promise<void> {
  const [armStats, preference] = await Promise.all([
    prisma.userArmStat.findMany({
      where: { userId },
      include: { arm: true },
    }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ]);

  if (armStats.length === 0 || !preference) return;

  const totalPulls = armStats.reduce((sum, s) => sum + s.pulls, 0);

  const selected = selectArmUCB1(
    armStats.map((s) => ({
      armId:       s.armId,
      armName:     s.arm.name,
      pulls:       s.pulls,
      totalReward: s.totalReward,
    })),
    totalPulls
  );

  const arm = armStats.find((s) => s.armId === selected.armId)!.arm;
  const baseWeights = calcBaseWeights(preference as any);

  // Cập nhật objective weights
  await prisma.userObjectiveWeights.update({
    where: { userId },
    data: {
      currentArmId: arm.armId,
      wInterest: baseWeights.wInterest * arm.wInterest,
      wPace:     baseWeights.wPace     * arm.wPace,
      wDistance: baseWeights.wDistance * arm.wDistance,
      wBudget:   baseWeights.wBudget   * arm.wBudget,
      wWeather:  baseWeights.wWeather  * arm.wWeather,
      wRisk:     baseWeights.wRisk     * arm.wRisk,
    },
  });
}

// ─── Nhận reward từ event → update bandit stats → chọn arm mới ───────────────

export async function processBanditReward(
  userId: string,
  armId: number,
  eventType: string
): Promise<void> {
  const reward = calcReward(eventType);

  // Update pulls và total_reward cho arm này (upsert để an toàn nếu record chưa có)
  await prisma.userArmStat.upsert({
    where: { userId_armId: { userId, armId } },
    create: { userId, armId, pulls: 1, totalReward: reward },
    update: { pulls: { increment: 1 }, totalReward: { increment: reward } },
  });

  // Sau mỗi reward → chạy UCB1 để chọn arm tốt nhất cho lần sau
  await selectAndApplyArm(userId);
}
