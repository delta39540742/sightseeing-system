import { prisma } from '../lib/prisma';
import { buildPreferenceVector, buildSoftConstraints, calcBaseWeights } from '../lib/preference';
import { SurveyPayload } from '../types';

// ─── A1: Kiểm tra survey status ───────────────────────────────────────────────

export async function getSurveyStatus(userId: string) {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { updatedAt: true },
  });

  return {
    hasCompleted: !!pref,
    completedAt: pref?.updatedAt.toISOString() ?? null,
  };
}

// ─── A2: Tạo mới survey ───────────────────────────────────────────────────────

export async function createSurvey(userId: string, payload: SurveyPayload) {
  // Validate preferredTagIds max 3
  if (payload.preferredTagIds.length > 3) {
    throw new Error('preferredTagIds tối đa 3 tags');
  }
  if (!payload.preferredTagIds.every((id) => id >= 1 && id <= 10)) {
    throw new Error('preferredTagIds phải nằm trong [1..10]');
  }
  if (payload.pace < 0 || payload.pace > 1) {
    throw new Error('pace phải nằm trong [0,1]');
  }
  if (payload.budgetPerDayMax < payload.budgetPerDayMin) {
    throw new Error('budgetPerDayMax phải >= budgetPerDayMin');
  }

  const preferenceVector = buildPreferenceVector(payload);
  const softConstraints = buildSoftConstraints(payload);
  const baseWeights = calcBaseWeights(payload);

  // Transaction: tạo preference + khởi tạo bandit state + objective weights
  await prisma.$transaction(async (tx) => {
    // 1. Upsert user_preference
    await tx.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        primaryPurpose: payload.primaryPurpose,
        preferredTagIds: payload.preferredTagIds,
        pace: payload.pace,
        dailyScheduleType: payload.dailyScheduleType,
        foodPreferences: payload.foodPreferences,
        budgetPerDayMin: payload.budgetPerDayMin,
        budgetPerDayMax: payload.budgetPerDayMax,
        groupType: payload.groupType,
        mobilityRestrictions: payload.mobilityRestrictions,
        preferenceVector,
      },
      update: {
        primaryPurpose: payload.primaryPurpose,
        preferredTagIds: payload.preferredTagIds,
        pace: payload.pace,
        dailyScheduleType: payload.dailyScheduleType,
        foodPreferences: payload.foodPreferences,
        budgetPerDayMin: payload.budgetPerDayMin,
        budgetPerDayMax: payload.budgetPerDayMax,
        groupType: payload.groupType,
        mobilityRestrictions: payload.mobilityRestrictions,
        preferenceVector,
      },
    });

    // 2. Khởi tạo user_arm_stat cho 6 arms (nếu chưa có)
    const arms = await tx.banditArm.findMany();
    await Promise.all(
      arms.map((arm) =>
        tx.userArmStat.upsert({
          where: { userId_armId: { userId, armId: arm.armId } },
          create: { userId, armId: arm.armId, pulls: 0, totalReward: 0 },
          update: {}, // Không reset nếu đã có data
        })
      )
    );

    // 3. Upsert objective weights với arm 1 (balanced) là default
    const defaultArm = arms.find((a) => a.name === 'balanced') ?? arms[0];
    await tx.userObjectiveWeights.upsert({
      where: { userId },
      create: {
        userId,
        wInterest: baseWeights.wInterest * defaultArm.wInterest,
        wPace:     baseWeights.wPace     * defaultArm.wPace,
        wDistance: baseWeights.wDistance * defaultArm.wDistance,
        wBudget:   baseWeights.wBudget   * defaultArm.wBudget,
        wWeather:  baseWeights.wWeather  * defaultArm.wWeather,
        wRisk:     baseWeights.wRisk     * defaultArm.wRisk,
        currentArmId: defaultArm.armId,
        softConstraints: softConstraints as any,
      },
      update: {
        // Cập nhật soft constraints và base weights khi user làm lại survey
        wInterest: baseWeights.wInterest * defaultArm.wInterest,
        wPace:     baseWeights.wPace     * defaultArm.wPace,
        wDistance: baseWeights.wDistance * defaultArm.wDistance,
        wBudget:   baseWeights.wBudget   * defaultArm.wBudget,
        wWeather:  baseWeights.wWeather  * defaultArm.wWeather,
        wRisk:     baseWeights.wRisk     * defaultArm.wRisk,
        softConstraints: softConstraints as any,
      },
    });
  });
}

// ─── A3: Cập nhật survey (partial) ───────────────────────────────────────────

export async function updateSurvey(userId: string, payload: Partial<SurveyPayload>) {
  const existing = await prisma.userPreference.findUnique({ where: { userId } });
  if (!existing) {
    throw new Error('User chưa làm survey. Dùng POST trước.');
  }

  // Merge với data cũ để tính lại vector
  const merged: SurveyPayload = {
    primaryPurpose:      (payload.primaryPurpose ?? existing.primaryPurpose) as any,
    preferredTagIds:     payload.preferredTagIds  ?? existing.preferredTagIds,
    pace:                payload.pace             ?? existing.pace,
    dailyScheduleType:   (payload.dailyScheduleType ?? existing.dailyScheduleType) as any,
    foodPreferences:     payload.foodPreferences  ?? existing.foodPreferences,
    budgetPerDayMin:     payload.budgetPerDayMin  ?? existing.budgetPerDayMin,
    budgetPerDayMax:     payload.budgetPerDayMax  ?? existing.budgetPerDayMax,
    groupType:           (payload.groupType ?? existing.groupType) as any,
    mobilityRestrictions: payload.mobilityRestrictions ?? existing.mobilityRestrictions,
  };

  // Validate
  if (merged.preferredTagIds.length > 3) throw new Error('preferredTagIds tối đa 3 tags');
  if (merged.budgetPerDayMax < merged.budgetPerDayMin) throw new Error('budgetPerDayMax >= budgetPerDayMin');

  const preferenceVector = buildPreferenceVector(merged);
  const softConstraints = buildSoftConstraints(merged);

  await prisma.userPreference.update({
    where: { userId },
    data: {
      ...payload,
      preferenceVector,
    },
  });

  // Cập nhật soft constraints trong objective weights
  await prisma.userObjectiveWeights.update({
    where: { userId },
    data: { softConstraints: softConstraints as any },
  });
}
