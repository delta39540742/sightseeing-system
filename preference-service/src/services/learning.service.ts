import { prisma } from '../lib/prisma';

const LEARNING_RATE = 0.05; // tốc độ học — nhỏ để không overwrite survey data

/**
 * Lấy tag vector 10 chiều của một place từ shared DB.
 * place_tag_map là bảng shared với backend, query bằng raw SQL.
 * Chiều i (0-based) ↔ tagId i+1 (range 1–10).
 */
async function fetchPlaceTagVector(placeId: number): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ tag_id: number }[]>`
    SELECT tag_id FROM place_tag_map WHERE place_id = ${placeId}
  `;
  if (rows.length === 0) return null;

  const vec = new Array(10).fill(0);
  rows.forEach((r) => {
    if (r.tag_id >= 1 && r.tag_id <= 10) vec[r.tag_id - 1] = 1;
  });
  return vec;
}

/**
 * Normalize vector về [0,1] theo max value.
 * Nếu max = 0 (zero vector) trả về vector gốc.
 */
function normalizeVector(vec: number[]): number[] {
  const max = Math.max(...vec);
  if (max === 0) return vec;
  return vec.map((v) => Math.min(v / max, 1));
}

/**
 * Cập nhật preferenceVector của user dựa trên hành vi thực tế.
 *
 * @param userId    User cần cập nhật
 * @param placeId   Địa điểm vừa interact
 * @param strength  Cường độ tín hiệu:
 *                    > 0 → nudge vector về phía tags của place (tích cực)
 *                    < 0 → nudge vector ra xa tags của place (tiêu cực)
 *                  Gợi ý: +1.0 (explicit rating cao), +0.5 (favorited),
 *                          +0.3 (slot completed), -0.3 (poi rejected hàng loạt)
 *
 * Công thức: newVec[i] = clamp(oldVec[i] + LEARNING_RATE * strength * tagVec[i], 0, 1)
 * Sau đó normalize lại.
 */
export async function updatePreferenceVector(
  userId: string,
  placeId: number,
  strength: number,
): Promise<void> {
  const [tagVec, pref] = await Promise.all([
    fetchPlaceTagVector(placeId),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { preferenceVector: true },
    }),
  ]);

  if (!tagVec || !pref) return; // place không có tags hoặc user chưa làm survey

  const delta = LEARNING_RATE * strength;
  const updated = pref.preferenceVector.map((v, i) =>
    Math.max(0, Math.min(1, v + delta * tagVec[i])),
  );

  await prisma.userPreference.update({
    where: { userId },
    data: { preferenceVector: normalizeVector(updated) },
  });
}

/**
 * Tự động cập nhật soft constraints dựa trên xu hướng reject gần đây.
 *
 * Nếu user reject >= 3 POIs thuộc cùng một tag trong 7 ngày gần đây
 * → thêm avoid_category cho tag đó vào userObjectiveWeights.softConstraints.
 *
 * Gọi sau khi xử lý sự kiện reject để dần học pattern "không thích".
 */
export async function autoUpdateSoftConstraints(userId: string): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 ngày

  // Lấy các place bị reject gần đây
  const recentRejections = await prisma.interactionLog.findMany({
    where: {
      userId,
      interactionType: 'poi_rejected',
      createdAt: { gte: since },
      placeId: { not: null },
    },
    select: { placeId: true },
  });

  if (recentRejections.length < 3) return;

  const rejectedPlaceIds = recentRejections.map((r) => Number(r.placeId!));

  // Lấy tags của các place bị reject
  const tagRows = await prisma.$queryRaw<{ tag_id: number; cnt: number }[]>`
    SELECT tag_id, COUNT(*)::int AS cnt
    FROM place_tag_map
    WHERE place_id = ANY(${rejectedPlaceIds}::bigint[])
    GROUP BY tag_id
    HAVING COUNT(*) >= 3
    ORDER BY cnt DESC
  `;

  if (tagRows.length === 0) return;

  const objWeights = await prisma.userObjectiveWeights.findUnique({
    where: { userId },
    select: { softConstraints: true },
  });
  if (!objWeights) return;

  const constraints = (objWeights.softConstraints as any[]) ?? [];
  let changed = false;

  for (const row of tagRows) {
    const alreadyExists = constraints.some(
      (c) => c.type === 'avoid_category' && c.value === String(row.tag_id),
    );
    if (!alreadyExists) {
      constraints.push({
        type: 'avoid_category',
        value: String(row.tag_id),
        strength: Math.min(0.3 + (row.cnt - 3) * 0.05, 0.7), // tăng dần theo số lần reject
      });
      changed = true;
    }
  }

  if (changed) {
    await prisma.userObjectiveWeights.update({
      where: { userId },
      data: { softConstraints: constraints as any },
    });
  }
}
