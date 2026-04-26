// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../server';
import { generateGreedyPlan, optimizeWith2Opt } from './solver';

export async function getTripCandidates(req: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      destinationCity, startDate, endDate,
      budgetTotal, preferences, mobilityRestrictions,
    } = req.body as any;

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
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
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
      andConditions.push({
        OR: [
          { description: { contains: destinationCity, mode: 'insensitive' as const } },
          { name: { contains: destinationCity, mode: 'insensitive' as const } },
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

    // Fallback: nếu city filter quá hẹp → bỏ city filter, giữ budget
    // if (places.length === 0 && destinationCity) {
    //   places = await prisma.place.findMany({
    //     where: { AND: [budgetCondition, ...(mobilityFilter.wheelchair_access ? [{ wheelchair_access: true }] : [])] },
    //     include: includeRelations,
    //   });
    // }

    // Nếu DB hoàn toàn rỗng → trả mock data để test UI
    if (places.length === 0) {
      //return reply.send({ places: MOCK_PLACES, _mock: true });
      return reply.send({ places: [] });
    }

    // Score + sort
    const scored = places.map((p: any) => {
      const tagMatchCount = p.place_tag_map.filter((tm: any) =>
        resolvedTagIds.includes(tm.tag_id),
      ).length;
      const score = tagMatchCount * 2 + (p.popularity_score ?? 0) * 0.3;
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
    console.error('=== LỖI CANDIDATES ===', error);
    return reply.status(500).send({ error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
}

// ---------------------------------------------------------------------------
// Mock places — chỉ dùng khi DB hoàn toàn rỗng (để test UI)
// ---------------------------------------------------------------------------
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

        // Lấy user từ firebase_uid trong header x-user-id
        const firebaseUid = req.headers['x-user-id'] as string;
        if (!firebaseUid) {
            return reply.status(401).send({ error: 'Unauthorized: missing x-user-id header' });
        }
        const dbUser = await prisma.app_user.findUnique({ where: { firebase_uid: firebaseUid } });
        if (!dbUser) {
            return reply.status(401).send({ error: 'Unauthorized: user not found' });
        }

        // Tính số ngày thực tế từ startDate / endDate
        const startDate = new Date(payload.startDate);
        const endDate = new Date(payload.endDate);
        const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)) + 1);

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
        const targetCity = payload.destinationCity || 'Da Nang';
        const places = await prisma.place.findMany({ 
            where: {
                OR: [
                    { address: { contains: targetCity, mode: 'insensitive' as const } },
                    { description: { contains: targetCity, mode: 'insensitive' as const } },
                    { name: { contains: targetCity, mode: 'insensitive' as const } },
                ]
            },
            include: { place_tag_map: true } 
        });
        const candidates = places.map((p: any) => {
            const tagMatchCount = p.place_tag_map.filter((tm: any) =>
                preferredTagIds.includes(tm.tag_id)
            ).length;
            const isAnchor = anchorPlaceIds.includes(Number(p.place_id));
            return {
                placeId:             Number(p.place_id),
                name:                p.name,
                lat:                 p.lat ?? 16.06,
                lng:                 p.lng ?? 108.22,
                avgVisitDurationMin: p.avg_visit_duration_min ?? 60,
                minPrice:            p.min_price ?? 0,
                maxPrice:            p.max_price ?? 0,
                indoorOutdoor:       p.indoor_outdoor,
                popularityScore:     p.popularity_score ?? 0,
                terrainEasiness:     p.terrain_easiness ?? 1,
                tags:                p.place_tag_map,
                openingHours:        [],
                matchScore:          tagMatchCount + (p.popularity_score || 0) * 0.3 + (isAnchor ? 1000 : 0),
                isAnchor,
            };
        }).sort((a: any, b: any) => b.matchScore - a.matchScore).slice(0, 100);

        const weights = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
        
        // 1. TRUYỀN THÊM startDate VÀO HÀM NÀY
        const greedyPlan = generateGreedyPlan(days, payload.budgetTotal ?? 5000000, candidates, weights, startDate);
        
        const userPreferences = {
            preferredTagIds,
            budgetRemaining: payload.budgetTotal ?? 5000000,
            weights: { interest: 1, distance: 1.5, budget: 1, weather: 1 },
        };
        
        // 2. HỨNG OBJECT (Lấy ra biến optimizedPlan và finalScore)
        const { slots: optimizedPlan, score: finalScore } = optimizeWith2Opt(greedyPlan, userPreferences, candidates);

        // 3. LƯU Trip VÀO DB VỚI ĐIỂM SỐ
        const newTrip = await prisma.trip.create({
            data: {
                user_id:          dbUser.user_id,
                destination_city: payload.destinationCity || 'Da Nang',
                start_date:       startDate,
                end_date:         endDate,
                budget_total:     payload.budgetTotal ?? 5000000,
                objective_score:  finalScore, // <--- ĐIỂM SỐ ĐƯỢC LƯU VÀO ĐÂY
                status:           'draft',
            },
        });

        // Lưu các Slots vào DB
        if (optimizedPlan.length > 0) {
            await prisma.trip_slot.createMany({
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
                })),
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
            slots:           optimizedPlan.map((slot: any) => ({ ...slot, tripId: newTrip.trip_id })),
        });
    } catch (error: any) {
        console.error("=== LỖI CREATE TRIP ===", error);
        return reply.status(500).send({ error: error.message });
    }
};