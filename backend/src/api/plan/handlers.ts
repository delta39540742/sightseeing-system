// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, pool } from '../../lib/prisma';
import { generateGreedyPlan, optimizeWith2Opt, generateI3CHPlan, SolverContext, SoftConstraint, descriptionMatchScore } from './solver';
import { getCurrentArmId, sendPoiAcceptedBatch } from '../../lib/preferenceClient';
import { embedText, vectorToSqlLiteral } from '../../services/embeddingService';

const DEFAULT_WEIGHTS = {
  wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1,
  wStability: 0.05, wPotentialBias: 0.10, wProximity: 0,
};

interface PreferenceBundle {
  weights: typeof DEFAULT_WEIGHTS;
  preferenceVector: number[];
  preferredTagIds: number[];
  softConstraints: SoftConstraint[];
  collaborativeBoosts: Map<number, number>;
}

const PREF_FETCH_TIMEOUT_MS = 2000;

async function fetchPreferenceBundle(userId: string): Promise<PreferenceBundle> {
  const fallback: PreferenceBundle = {
    weights: DEFAULT_WEIGHTS,
    preferenceVector: [],
    preferredTagIds: [],
    softConstraints: [],
    collaborativeBoosts: new Map(),
  };
  try {
    const prefUrl = process.env.PREFERENCE_SERVICE_URL ?? 'http://localhost:3001';
    const headers = { 'x-user-id': userId };

    // AbortSignal.timeout chỉ có từ Node 17.3+ — backend dùng Node 20+ nên OK.
    const [weightsResp, cfResp] = await Promise.all([
      fetch(`${prefUrl}/api/preferences/weights?context=plan`, {
        headers,
        signal: AbortSignal.timeout(PREF_FETCH_TIMEOUT_MS),
      }).catch(() => null),
      fetch(`${prefUrl}/api/preferences/collaborative-boost`, {
        headers,
        signal: AbortSignal.timeout(PREF_FETCH_TIMEOUT_MS),
      }).catch(() => null),
    ]);

    if (!weightsResp || !weightsResp.ok) return fallback;
    const data = (await weightsResp.json()) as any;

    const cfMap = new Map<number, number>();
    if (cfResp?.ok) {
      const cfData = (await cfResp.json()) as any;
      if (Array.isArray(cfData.boosts)) {
        for (const b of cfData.boosts) {
          if (typeof b.placeId === 'number' && typeof b.boost === 'number') {
            cfMap.set(b.placeId, b.boost);
          }
        }
      }
    }

    return {
      weights: data.weights ?? DEFAULT_WEIGHTS,
      preferenceVector: Array.isArray(data.preferenceVector) ? data.preferenceVector : [],
      preferredTagIds: Array.isArray(data.preferredTagIds) ? data.preferredTagIds : [],
      softConstraints: Array.isArray(data.softConstraints) ? data.softConstraints : [],
      collaborativeBoosts: cfMap,
    };
  } catch {
    return fallback;
  }
}

export async function getTripCandidates(req: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      destinationCity, startDate, endDate,
      budgetTotal, preferences, mobilityRestrictions,
      experienceKeywords, vibe, amenities, originalPrompt,
    } = req.body as any;
    const expKws: string[] = Array.isArray(experienceKeywords)
      ? experienceKeywords.filter((s: any) => typeof s === 'string' && s.trim().length > 0)
      : [];
    const vibes: string[] = Array.isArray(vibe) ? vibe : [];
    const ams: string[] = Array.isArray(amenities) ? amenities : [];

    // Map preference strings → tag IDs
    let resolvedTagIds: number[] = [];
    if (Array.isArray(preferences) && preferences.length > 0) {
      const matchedTags = await prisma.place_tag.findMany({
        where: {
          OR: [
            { name: { in: preferences } },
            { display_name: { in: preferences } },
          ],
        },
      });
      resolvedTagIds = matchedTags.map((t) => t.tag_id);
    }

    // Budget per day (fallback khi thiếu ngày)
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 2 * 86_400_000);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
    const budget = budgetTotal ?? 5_000_000;
    const avgBudgetPerDay = budget / days;

    const includeRelations = {
      place_image:        true,
      place_tag_map:      { include: { place_tag: true } },
      place_opening_hour: true,
    } as const;

    const mobilityFilter = mobilityRestrictions?.includes('xe_lan') ? { wheelchair_access: true as const } : {};
    const budgetCondition = { OR: [{ min_price: null }, { min_price: { lte: avgBudgetPerDay } }] };

    // Build AND array to avoid OR key collision when spreading multiple OR filters
    const andConditions: any[] = [budgetCondition];
    if (destinationCity) {
      // Chỉ nhận place thực sự khớp city qua address / name / description.
      // KHÔNG include `address: null` vì như vậy sẽ nuốt mọi place ở tỉnh khác mà
      // chỉ đơn giản là thiếu address → đề xuất bị "lạc đoàn".
      andConditions.push({
        OR: [
          { address:     { contains: destinationCity, mode: 'insensitive' as const } },
          { name:        { contains: destinationCity, mode: 'insensitive' as const } },
          { description: { contains: destinationCity, mode: 'insensitive' as const } },
        ],
      });
    }
    if (mobilityRestrictions?.includes('xe_lan')) {
      andConditions.push({ wheelchair_access: true });
    }

    let places = await prisma.place.findMany({
      where: { AND: andConditions },
      include: includeRelations,
    });

    // Nếu city filter không tìm thấy kết quả → báo lỗi rõ ràng, KHÔNG fallback sang thành phố khác
    if (places.length === 0 && destinationCity) {
      return reply.status(404).send({
        error: 'NO_PLACES_FOR_CITY',
        message: `Chưa có địa điểm nào cho "${destinationCity}" trong hệ thống. Thử chọn thành phố khác.`,
        destinationCity,
      });
    }

    // Nếu DB hoàn toàn rỗng (không có city filter) → trả mock data để test UI
    if (places.length === 0) {
      return reply.send({ places: MOCK_PLACES, _mock: true });
    }

    // Semantic similarity từ description_embedding (pgvector cosine).
    // Embed query text từ experienceKeywords → tính sim cho mỗi place trong pool.
    // Best-effort: nếu model chưa load xong / DB chưa backfill embedding → bỏ qua,
    // scoring vẫn rơi về descriptionMatchScore (keyword) như cũ.
    const semSimMap = new Map<string, number>();
    
    // Xây dựng query text giàu ngữ cảnh: Keywords + Vibes + Amenities + Original Prompt
    const queryParts = [];
    if (expKws.length > 0) queryParts.push(`Trải nghiệm: ${expKws.join(', ')}`);
    if (vibes.length > 0) queryParts.push(`Không khí: ${vibes.join(', ')}`);
    if (ams.length > 0) queryParts.push(`Tiện nghi: ${ams.join(', ')}`);
    if (originalPrompt) queryParts.push(`Yêu cầu gốc: ${originalPrompt}`);
    
    const queryText = queryParts.join('. ').trim();
    
    if (queryText.length > 0) {
      try {
        const queryVec = await embedText(queryText);
        const placeIds = places.map((p: any) => p.place_id.toString());
        if (placeIds.length > 0) {
          const { rows } = await pool.query<{ pid: string; sim: string }>(
            `SELECT place_id::text AS pid,
                    1 - (description_embedding <=> $1::vector) AS sim
             FROM place
             WHERE place_id = ANY($2::bigint[])
               AND description_embedding IS NOT NULL`,
            [vectorToSqlLiteral(queryVec), placeIds],
          );
          for (const r of rows) {
            const sim = Number(r.sim);
            if (Number.isFinite(sim)) semSimMap.set(r.pid, sim);
          }
        }
      } catch (err) {
        req.log.warn({ err: (err as Error).message }, 'semantic embedding failed; fallback to keyword match');
      }
    }

    // Optionally pull user's preference vector for richer scoring (best-effort)
    let userVector: number[] = [];
    let userSoft: SoftConstraint[] = [];
    let userCfBoosts: Map<number, number> = new Map();
    const headerUid = (req.headers['x-user-id'] as string) || (req.user?.uid as string | undefined);
    if (headerUid) {
      try {
        const dbUser = await prisma.app_user.findUnique({
          where: { firebase_uid: headerUid },
          select: { user_id: true },
        });
        if (dbUser) {
          const bundle = await fetchPreferenceBundle(dbUser.user_id);
          userVector = bundle.preferenceVector;
          userSoft = bundle.softConstraints;
          userCfBoosts = bundle.collaborativeBoosts;
          if (bundle.preferredTagIds.length > 0 && resolvedTagIds.length === 0) {
            resolvedTagIds = bundle.preferredTagIds;
          }
        }
      } catch {
        // non-blocking
      }
    }

    // Score + sort: cosine-ish on vector if available, fallback to tag overlap
    const scored = places.map((p: any) => {
      const tagIds: number[] = (p.place_tag_map ?? []).map((tm: any) => tm.tag_id);
      let interest = 0;
      const sumVec = userVector.reduce((a, b) => a + b, 0);
      if (userVector.length >= 10 && sumVec > 0) {
        for (const t of tagIds) {
          if (t >= 1 && t <= 10) interest += userVector[t - 1] ?? 0;
        }
        if (tagIds.length > 0) interest /= Math.sqrt(tagIds.length);
      } else if (resolvedTagIds.length > 0) {
        const overlap = tagIds.filter((id) => resolvedTagIds.includes(id)).length;
        interest = overlap / Math.max(1, resolvedTagIds.length);
      }

      let softAdj = 0;
      for (const sc of userSoft) {
        if (sc.type === 'avoid_category') {
          const target = Number(sc.value);
          if (Number.isFinite(target) && tagIds.includes(target)) softAdj -= sc.strength * 5;
        } else if (sc.type === 'prefer_indoor' && p.indoor_outdoor === 'indoor') {
          softAdj += sc.strength * 2;
        } else if (sc.type === 'prefer_outdoor' && p.indoor_outdoor === 'outdoor') {
          softAdj += sc.strength * 2;
        }
      }

      const cf = userCfBoosts.get(Number(p.place_id)) ?? 0;
      const cfBoost = cf > 0 ? Math.min(cf, 5) * 1.5 : 0;

      // Hybrid scoring: semantic embedding (mạnh hơn cho mô tả mơ hồ) + keyword exact match.
      // Khi embedding có sim cao → semantic chiếm trọng số lớn; nếu không có embedding
      // (place chưa backfill / model fail) → fall về expBoost từ keyword.
      const sim = semSimMap.get(p.place_id.toString()) ?? 0;
      const semBoost = 12 * sim;
      const expBoost = 6 * descriptionMatchScore(p, expKws);

      const score = interest * 10 + (p.popularity_score ?? 0) * 0.3 + softAdj + cfBoost + semBoost + expBoost;
      return { p, score };
    });
    scored.sort((a: any, b: any) => b.score - a.score);

    // Serialize to Place type
    const result = scored.slice(0, 20).map(({ p }: any) => ({
      placeId:             Number(p.place_id),
      name:                p.name,
      description:         p.description ?? null,
      lat:                 p.lat,
      lng:                 p.lng,
      indoorOutdoor:       p.indoor_outdoor,
      avgVisitDurationMin: p.avg_visit_duration_min ?? 60,
      minPrice:            p.min_price ?? null,
      priceType:           p.price_type ?? null,
      imageUrl:            p.place_image?.url ?? null,
      rating:              p.rating ?? null,
      tags: (p.place_tag_map ?? []).map((m: any) => ({
        tagId: m.tag_id,
        name:  m.place_tag?.name ?? null,
      })),
      openingHours: (p.place_opening_hour ?? []).map((h: any) => ({
        dayOfWeek: h.day_of_week,
        openTime:  h.open_time,
        closeTime: h.close_time,
      })),
    }));

    return reply.send({ places: result });
  } catch (error: any) {
    req.log.error({ err: error }, 'getTripCandidates failed');
    return reply.status(500).send({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

// ---------------------------------------------------------------------------
// Mock places — chỉ dùng khi DB hoàn toàn rỗng (để test UI)
// -------------------------MOCK_PLACES--------------------------------------------------
const MOCK_PLACES = [
  { placeId: 9001, name: 'Bãi biển Mỹ Khê', description: 'Bãi biển dài nhất Đà Nẵng, cát trắng mịn.', lat: 16.0544, lng: 108.2474, indoorOutdoor: 'outdoor', avgVisitDurationMin: 120, minPrice: 0, priceType: null, imageUrl: null, rating: 4.7, tags: [{ tagId: 1, name: 'beach' }], openingHours: [] },
  { placeId: 9002, name: 'Bán đảo Sơn Trà', description: 'Khu bảo tồn thiên nhiên với đàn voọc chà vá chân nâu.', lat: 16.1096, lng: 108.2748, indoorOutdoor: 'outdoor', avgVisitDurationMin: 180, minPrice: 0, priceType: null, imageUrl: null, rating: 4.8, tags: [{ tagId: 2, name: 'nature' }], openingHours: [] },
  { placeId: 9003, name: 'Ngũ Hành Sơn', description: '5 ngọn núi đá cẩm thạch với hang động và chùa cổ.', lat: 15.9731, lng: 108.2614, indoorOutdoor: 'mixed', avgVisitDurationMin: 150, minPrice: 40000, priceType: 'ticket', imageUrl: null, rating: 4.5, tags: [{ tagId: 3, name: 'landmark' }], openingHours: [] },
  { placeId: 9004, name: 'Bảo tàng Chăm', description: 'Bảo tàng điêu khắc Chăm lớn nhất thế giới.', lat: 16.0602, lng: 108.2239, indoorOutdoor: 'indoor', avgVisitDurationMin: 90, minPrice: 60000, priceType: 'ticket', imageUrl: null, rating: 4.4, tags: [{ tagId: 4, name: 'museum' }], openingHours: [] },
  { placeId: 9005, name: 'Cầu Rồng', description: 'Cây cầu biểu tượng của Đà Nẵng, phun lửa cuối tuần.', lat: 16.0612, lng: 108.2272, indoorOutdoor: 'outdoor', avgVisitDurationMin: 45, minPrice: 0, priceType: null, imageUrl: null, rating: 4.6, tags: [{ tagId: 5, name: 'landmark' }], openingHours: [] },
  { placeId: 9006, name: 'Chùa Linh Ứng Bãi Bụt', description: 'Chùa lớn nằm trên Sơn Trà, tượng Phật Quan Âm 67m.', lat: 16.0987, lng: 108.2789, indoorOutdoor: 'outdoor', avgVisitDurationMin: 90, minPrice: 0, priceType: null, imageUrl: null, rating: 4.7, tags: [{ tagId: 6, name: 'pagoda' }], openingHours: [] },
  { placeId: 9007, name: 'Phố cổ Hội An', description: 'Di sản văn hóa thế giới với đèn lồng và kiến trúc cổ.', lat: 15.8801, lng: 108.3380, indoorOutdoor: 'outdoor', avgVisitDurationMin: 240, minPrice: 120000, priceType: 'ticket', imageUrl: null, rating: 4.9, tags: [{ tagId: 7, name: 'heritage' }], openingHours: [] },
  { placeId: 9008, name: 'Khu ẩm thực Bạch Đằng', description: 'Phố ẩm thực bên sông Hàn, nhiều món đặc sản Đà Nẵng.', lat: 16.0750, lng: 108.2206, indoorOutdoor: 'outdoor', avgVisitDurationMin: 90, minPrice: 50000, priceType: 'meal', imageUrl: null, rating: 4.3, tags: [{ tagId: 8, name: 'food' }], openingHours: [] },
  { placeId: 9009, name: 'Đỉnh Bà Nà Hills', description: 'Khu du lịch trên đỉnh núi 1487m, Cầu Vàng nổi tiếng.', lat: 15.9976, lng: 107.9884, indoorOutdoor: 'mixed', avgVisitDurationMin: 300, minPrice: 750000, priceType: 'ticket', imageUrl: null, rating: 4.6, tags: [{ tagId: 2, name: 'nature' }], openingHours: [] },
  { placeId: 9010, name: 'Làng đá mỹ nghệ Non Nước', description: 'Làng nghề truyền thống chạm khắc đá cẩm thạch.', lat: 15.9735, lng: 108.2589, indoorOutdoor: 'outdoor', avgVisitDurationMin: 60, minPrice: 0, priceType: null, imageUrl: null, rating: 4.2, tags: [{ tagId: 9, name: 'craft' }], openingHours: [] },
];

export const createTrip = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const payload = req.body as any;
        const expKws: string[] = Array.isArray(payload.experienceKeywords)
            ? payload.experienceKeywords.filter(
                (s: any) => typeof s === 'string' && s.trim().length > 0,
            )
            : [];

        // user lấy từ Firebase token đã verify ở preHandler verifyToken
        const firebaseUid = req.user?.uid;
        if (!firebaseUid) {
            return reply.status(401).send({ error: 'Unauthorized: missing Firebase token' });
        }
        const dbUser = await prisma.app_user.findUnique({ where: { firebase_uid: firebaseUid } });
        if (!dbUser) {
            return reply.status(401).send({ error: 'Unauthorized: user not found' });
        }

        // Tính số ngày thực tế từ startDate / endDate
        const startDate = new Date(payload.startDate);
        const endDate = new Date(payload.endDate);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return reply.status(400).send({ error: 'startDate hoặc endDate không hợp lệ' });
        }
        if (endDate.getTime() < startDate.getTime()) {
            return reply.status(400).send({ error: 'endDate phải >= startDate' });
        }
        const MAX_TRIP_DAYS = 30;
        const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)) + 1);
        if (days > MAX_TRIP_DAYS) {
            return reply.status(400).send({ error: `Trip không quá ${MAX_TRIP_DAYS} ngày` });
        }

        // Map preferences (string[]) sang tag IDs bằng cách tìm trong DB
        let preferredTagIds: number[] = payload.preferredTagIds || [];
        if (preferredTagIds.length === 0 && payload.preferences?.length > 0) {
            const matchedTags = await prisma.place_tag.findMany({
                where: {
                    OR: [
                        { name: { in: payload.preferences } },
                        { display_name: { in: payload.preferences } },
                    ],
                },
            });
            preferredTagIds = matchedTags.map((t) => t.tag_id);
        }

        // Lấy candidates từ DB
        const anchorPlaceIds: number[] = payload.anchorPlaceIds || [];
        const strictMode: boolean = payload.strictMode === true;
        const planningAlgorithm: 'greedy_2opt' | 'i3ch' = payload.planningAlgorithm ?? 'greedy_2opt';
        const rawLockedSlots: Array<{ placeId: number; dayIndex: number; fixedStart: string; durationMin?: number }> =
            Array.isArray(payload.lockedSlots) ? payload.lockedSlots : [];
        const destinationCity: string | undefined = payload.destinationCity;
        const mobilityRestrictions: string[] | undefined = payload.mobilityRestrictions;

        const placeInclude = { place_tag_map: true, place_opening_hour: true, place_peak_time: true } as const;
        const CANDIDATE_DB_LIMIT = 300; // hạn chế load: top 300 theo popularity rồi rerank in-mem

        // Build filter: strict → only anchor places. Còn lại filter theo city + mobility ở DB.
        const buildWhere = (): any => {
            if (strictMode && anchorPlaceIds.length > 0) {
                return { place_id: { in: anchorPlaceIds.map(BigInt) } };
            }
            const ands: any[] = [];
            if (destinationCity) {
                // Tránh `address: null` (gây "lạc đoàn"). Cho phép match qua name/description
                // để place không khai address nhưng có chứa tên city vẫn lọt.
                ands.push({
                    OR: [
                        { address:     { contains: destinationCity, mode: 'insensitive' as const } },
                        { name:        { contains: destinationCity, mode: 'insensitive' as const } },
                        { description: { contains: destinationCity, mode: 'insensitive' as const } },
                    ],
                });
            }
            if (mobilityRestrictions?.includes('xe_lan')) {
                ands.push({ wheelchair_access: true });
            }
            // anchor places phải luôn có trong pool (kể cả khi không match city)
            if (anchorPlaceIds.length > 0) {
                return { OR: [{ AND: ands }, { place_id: { in: anchorPlaceIds.map(BigInt) } }] };
            }
            return ands.length > 0 ? { AND: ands } : {};
        };

        let places = await prisma.place.findMany({
            where: buildWhere(),
            include: placeInclude,
            orderBy: { popularity_score: 'desc' },
            take: strictMode ? undefined : CANDIDATE_DB_LIMIT,
        });

        // Fallback: city filter quá hẹp → bỏ filter, giữ mobility
        if (places.length === 0 && !strictMode && destinationCity) {
            places = await prisma.place.findMany({
                where: mobilityRestrictions?.includes('xe_lan') ? { wheelchair_access: true } : {},
                include: placeInclude,
                orderBy: { popularity_score: 'desc' },
                take: CANDIDATE_DB_LIMIT,
            });
        }
        const candidates = places.map((p: any) => {
            const tagIds: number[] = (p.place_tag_map ?? []).map((tm: any) => tm.tag_id);
            const tagMatchCount = tagIds.filter((id) => preferredTagIds.includes(id)).length;
            const isAnchor = anchorPlaceIds.includes(Number(p.place_id));
            const expMatch = descriptionMatchScore(p, expKws);
            return {
                placeId:             Number(p.place_id),
                name:                p.name,
                description:         p.description ?? null,
                lat:                 p.lat ?? 16.06,
                lng:                 p.lng ?? 108.22,
                avgVisitDurationMin: p.avg_visit_duration_min ?? 60,
                minPrice:            p.min_price ?? 0,
                maxPrice:            p.max_price ?? 0,
                indoorOutdoor:       p.indoor_outdoor,
                popularityScore:     p.popularity_score ?? 0,
                terrainEasiness:     p.terrain_easiness ?? 1,
                tagIds,
                tags:                tagIds.map((id) => ({ tagId: id })),
                openingHours:        (p.place_opening_hour ?? []).map((h: any) => ({
                    dayOfWeek: h.day_of_week,
                    openTime:  h.open_time,
                    closeTime: h.close_time,
                })),
                peakTimes:           (p.place_peak_time ?? []).map((pt: any) => ({
                    startTime:      pt.start_time,
                    endTime:        pt.end_time,
                    emptinessLevel: pt.emptiness_level,
                })),
                matchScore:          tagMatchCount + (p.popularity_score || 0) * 0.3 + 2 * expMatch + (isAnchor ? 1000 : 0),
                isAnchor,
            };
        }).sort((a: any, b: any) => b.matchScore - a.matchScore).slice(0, 100);

        // Khi strictMode: tạo slots thẳng từ anchorPlaceIds theo thứ tự user chọn,
        // bỏ qua greedy planner để tránh mất slot do thiếu lat/lng hoặc lọc sai
        let optimizedPlan: any[];
        if (strictMode && anchorPlaceIds.length > 0) {
            const placeMap = new Map(candidates.map((c: any) => [c.placeId, c]));
        
            let curDayIndex = 0;
            const DAY_START_MIN = 8 * 60;  // 08:00 sáng
            const DAY_END_MIN = 22 * 60;   // 22:00 đêm (bạn có thể tùy chỉnh lại)

            let curMin = DAY_START_MIN;

            optimizedPlan = anchorPlaceIds
                .map((id, i) => {
                    const place = placeMap.get(id);
                    if (!place) return null;

                    const duration = place.avgVisitDurationMin || 60;

                    // Kiểm tra nếu tham quan điểm này làm lố giờ kết thúc ngày
                    // thì chuyển sang 08:00 sáng của ngày hôm sau
                    if (curMin + duration > DAY_END_MIN) {
                        curDayIndex++;
                        curMin = DAY_START_MIN;
                    }

                    const slotStart = new Date(startDate);
                    // Cộng số ngày tương ứng với curDayIndex (Date API tự động xử lý qua tháng/năm)
                    slotStart.setDate(slotStart.getDate() + curDayIndex);
                    slotStart.setHours(Math.floor(curMin / 60), curMin % 60, 0, 0);

                    const slotEnd = new Date(slotStart.getTime() + duration * 60_000);

                    // Cập nhật thời gian cho điểm tiếp theo (cộng thêm 30 phút di chuyển)
                    curMin += duration + 30;

                    return {
                        slotId:       `slot_${curDayIndex}_${i + 1}`,
                        tripId:       'temp_trip',
                        dayIndex:     curDayIndex,
                        slotOrder:    i + 1,
                        placeId:      place.placeId,
                        plannedStart: slotStart.toISOString(),
                        plannedEnd:   slotEnd.toISOString(),
                        estimatedCost: place.minPrice || 0,
                        activityType: 'sightseeing',
                        rationale:    'Điểm do người dùng chọn',
                        status:       'planned',
                    };
                })
                .filter(Boolean); // Loại bỏ các item null nếu không tìm thấy place trong map
        } else {
            // Chế độ AI: dùng greedy + 2-opt với scoring đầy đủ
            const bundle = await fetchPreferenceBundle(dbUser.user_id);

            // Payload preferences là explicit intent cho trip này → ưu tiên hơn survey.
            // Survey chỉ dùng khi payload không nói gì.
            const effectivePreferredTagIds = preferredTagIds.length > 0
                ? preferredTagIds
                : bundle.preferredTagIds;

            const solverCtx: SolverContext = {
                weights: bundle.weights,
                preferenceVector: bundle.preferenceVector,
                preferredTagIds: effectivePreferredTagIds,
                softConstraints: bundle.softConstraints,
                startDate,
                budgetTotal: payload.budgetTotal ?? 5_000_000,
                collaborativeBoosts: bundle.collaborativeBoosts,
                experienceKeywords: expKws,
            };

            if (planningAlgorithm === 'i3ch') {
                optimizedPlan = generateI3CHPlan(days, candidates as any, solverCtx, {
                    maxIterations: 15,
                    perturbMoves: 3,
                    timeBudgetMs: 4000,
                });
            } else {
                const greedyPlan = generateGreedyPlan(days, candidates as any, solverCtx);
                optimizedPlan = optimizeWith2Opt(greedyPlan, solverCtx, candidates as any);
            }
        }

        // Merge locked slots: pre-built from payload, inserted at correct position by time order.
        if (rawLockedSlots.length > 0) {
            const placeMap = new Map(candidates.map((c: any) => [c.placeId, c]));
            const lockedBuilt = rawLockedSlots.map((ls, i) => {
                const place = placeMap.get(ls.placeId);
                const duration = ls.durationMin ?? (place as any)?.avgVisitDurationMin ?? 60;
                const fixedStart = new Date(ls.fixedStart);
                const fixedEnd = new Date(fixedStart.getTime() + duration * 60_000);
                return {
                    slotId:        `locked_${ls.dayIndex}_${i}`,
                    tripId:        'temp_trip',
                    dayIndex:      ls.dayIndex,
                    slotOrder:     999,
                    version:       1,
                    placeId:       ls.placeId,
                    plannedStart:  fixedStart.toISOString(),
                    plannedEnd:    fixedEnd.toISOString(),
                    estimatedCost: (place as any)?.minPrice ?? 0,
                    activityType:  'transport' as const,
                    rationale:     'Cố định giờ bởi người dùng',
                    status:        'planned' as const,
                    isLocked:      true,
                };
            });

            // Merge: combine + sort by (dayIndex, plannedStart), then re-assign slotOrder per day
            const combined = [...optimizedPlan, ...lockedBuilt].sort((a: any, b: any) => {
                if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
                return new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime();
            });
            const dayCounters = new Map<number, number>();
            for (const slot of combined as any[]) {
                const cur = dayCounters.get(slot.dayIndex) ?? 0;
                slot.slotOrder = cur;
                dayCounters.set(slot.dayIndex, cur + 1);
            }
            optimizedPlan = combined;
        }

        // Atomic: Trip + Slots phải insert cùng nhau, tránh orphan trip nếu slot insert fail.
        const { newTrip, persistedSlots } = await prisma.$transaction(async (tx) => {
            const newTrip = await tx.trip.create({
                data: {
                    user_id:          dbUser.user_id,
                    destination_city: payload.destinationCity || 'Da Nang',
                    start_date:       startDate,
                    end_date:         endDate,
                    budget_total:     payload.budgetTotal ?? 5000000,
                    status:           'confirmed', // TODO: Verify compatibility with the rest of the software
                    raw_prompt:       payload.additionalNotes || null,
                },
            });

            if (optimizedPlan.length > 0) {
                await tx.trip_slot.createMany({
                    data: optimizedPlan.map((slot: any) => ({
                        trip_id:        newTrip.trip_id,
                        day_index:      slot.dayIndex,
                        slot_order:     slot.slotOrder,
                        place_id:       BigInt(slot.placeId),
                        planned_start:  new Date(slot.plannedStart),
                        planned_end:    new Date(slot.plannedEnd),
                        estimated_cost: slot.estimatedCost || 0,
                        activity_type:  slot.activityType || 'sightseeing',
                        status:         'planned',
                        rationale:      slot.rationale || null,
                        is_locked:      slot.isLocked === true,
                    })),
                });
            }

            const persistedSlots = await tx.trip_slot.findMany({
                where: { trip_id: newTrip.trip_id },
                orderBy: [{ day_index: 'asc' }, { slot_order: 'asc' }],
            });

            return { newTrip, persistedSlots };
        });

        // Feedback loop: mỗi placeId trong slots = user "chấp nhận" gợi ý / chốt lựa chọn.
        // Bandit sẽ học và preferenceVector sẽ nudge về phía tags của các place đó.
        if (persistedSlots.length > 0) {
            const armId = await getCurrentArmId(dbUser.user_id);
            sendPoiAcceptedBatch({
                userId: dbUser.user_id,
                tripId: newTrip.trip_id,
                armId,
                placeIds: persistedSlots.map((s) => Number(s.place_id)),
            });
        }

        // Trả về Trip object đúng format mà frontend expect
        return reply.status(201).send({
            tripId:          newTrip.trip_id,
            userId:          newTrip.user_id,
            title:           newTrip.title,
            destinationCity: newTrip.destination_city,
            startDate:       newTrip.start_date.toISOString(),
            endDate:         newTrip.end_date.toISOString(),
            status:          newTrip.status,
            budgetTotal:     newTrip.budget_total,
            objectiveScore:  newTrip.objective_score,
            createdAt:       newTrip.created_at.toISOString(),
            updatedAt:       newTrip.updated_at.toISOString(),
            slots: persistedSlots.map((s) => ({
                slotId:        s.slot_id,
                tripId:        s.trip_id,
                dayIndex:      s.day_index,
                slotOrder:     s.slot_order,
                placeId:       Number(s.place_id),
                plannedStart:  s.planned_start.toISOString(),
                plannedEnd:    s.planned_end.toISOString(),
                estimatedCost: s.estimated_cost,
                activityType:  s.activity_type,
                rationale:     s.rationale,
                status:        s.status,
                isLocked:      s.is_locked,
            })),
        });
    } catch (error: any) {
        req.log.error({ err: error }, 'createTrip failed');
        return reply.status(500).send({ error: error.message });
    }
};