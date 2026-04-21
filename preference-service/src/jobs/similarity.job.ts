import { prisma } from '../lib/prisma';

/**
 * E1: refresh_user_similarity
 * Chạy SVD trên interaction_log để tính user similarity.
 *
 * MVP: dùng cosine similarity trên preference_vector (không cần SVD thật).
 * Khi đủ data (>100 users), swap sang svd-js hoặc ml-matrix.
 *
 * Lịch chạy: 03:00 mỗi đêm — đăng ký ở app.ts bằng node-cron.
 */

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export async function runSimilarityJob(): Promise<void> {
  console.log('[SVD Job] Starting refresh_user_similarity...');
  const startAt = Date.now();

  // Lấy tất cả users đã có preference vector
  const users = await prisma.userPreference.findMany({
    select: { userId: true, preferenceVector: true },
  });

  if (users.length < 2) {
    console.log('[SVD Job] Not enough users, skipping.');
    return;
  }

  const TOP_K = 20; // Lưu top 20 user tương tự cho mỗi user
  const now = new Date();
  const inserts: {
    userId: string;
    similarUserId: string;
    similarity: number;
    rankPosition: number;
    computedAt: Date;
  }[] = [];

  // Tính cosine similarity giữa tất cả cặp user (O(n²) — OK cho MVP ≤1000 user)
  for (const user of users) {
    const similarities: { userId: string; sim: number }[] = [];

    for (const other of users) {
      if (other.userId === user.userId) continue;
      const sim = cosineSimilarity(user.preferenceVector, other.preferenceVector);
      similarities.push({ userId: other.userId, sim });
    }

    // Sắp xếp và lấy top K
    similarities.sort((a, b) => b.sim - a.sim);
    const topK = similarities.slice(0, TOP_K);

    topK.forEach((entry, idx) => {
      inserts.push({
        userId:        user.userId,
        similarUserId: entry.userId,
        similarity:    entry.sim,
        rankPosition:  idx + 1,
        computedAt:    now,
      });
    });
  }

  // Upsert batch — xóa cũ rồi insert mới (đơn giản hơn upsert từng dòng)
  await prisma.$transaction([
    prisma.userSimilarity.deleteMany({}),
    prisma.userSimilarity.createMany({ data: inserts }),
  ]);

  const elapsed = ((Date.now() - startAt) / 1000).toFixed(2);
  console.log(`[SVD Job] Done. Processed ${users.length} users, ${inserts.length} pairs. (${elapsed}s)`);
}
