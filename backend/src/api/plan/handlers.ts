// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import type { place, place_tag_map } from '@prisma/client';
import { prisma } from '../../server';
import { generateGreedyPlan, optimizeWith2Opt } from './solver';

type PlaceWithTags = place & { place_tag_map: place_tag_map[] };

export async function getTripCandidates(req: FastifyRequest, reply: FastifyReply) {
  try {
    // 1. Lấy dữ liệu đầu vào từ Body
    const { 
      destinationCity, startDate, endDate, 
      budgetTotal, preferredTagIds, mobilityRestrictions 
    } = req.body as any;

    // 2. Tính ngân sách trung bình mỗi ngày
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;
    const avgBudgetPerDay = budgetTotal / days;

    // 3. Truy vấn Database với các ràng buộc cứng
    const places = await prisma.place.findMany({
      where: {
        // Lọc theo thành phố (mặc định Da Nang)
        address: { contains: destinationCity || 'Da Nang' },
        // Giá phải nằm trong ngân sách ngày
        min_price: { lte: avgBudgetPerDay },
        // Kiểm tra khả năng tiếp cận xe lăn nếu cần
        ...(mobilityRestrictions?.includes('xe_lan') ? { wheelchair_access: true } : {}),
      },
      include: {
        place_tag_map: true // Lấy kèm tag để tính điểm
      }
    });

    // 4. Tính toán matchScore (Logic lõi của Người 4)
    const candidates = places.map((p: PlaceWithTags) => {
      // tagMatch: số lượng tag trùng khớp với sở thích user
      const tagMatchCount = p.place_tag_map.filter((tm: place_tag_map) =>
        preferredTagIds.includes(tm.tag_id)
      ).length;

      // Công thức: tagMatch + popularity * 0.3
      const matchScore = tagMatchCount + (p.popularity_score || 0) * 0.3;

      return {
        ...p,
        matchScore
      };
    })
    // Sắp xếp giảm dần theo điểm và lấy top 100
    .sort((a: { matchScore: number }, b: { matchScore: number }) => b.matchScore - a.matchScore)
    .slice(0, 100);

    return reply.send({ items: candidates });
  } catch (error: any) {
    // Thêm dòng này để in lỗi đỏ chót ra terminal
    console.error("=== LỖI DATABASE ===", error); 

    // Ép nó trả về message thật thay vì mỗi cái clientVersion
    return reply.status(500).send({ 
      error: 'INTERNAL_SERVER_ERROR', 
      message: error.message || 'Lỗi không xác định' 
    });
  }
}

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
        const places = await prisma.place.findMany({ include: { place_tag_map: true } });
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
        const greedyPlan = generateGreedyPlan(days, payload.budgetTotal || 5000000, candidates, weights);
        const userPreferences = {
            preferredTagIds,
            budgetRemaining: payload.budgetTotal || 5000000,
            weights: { interest: 1, distance: 1.5, budget: 1, weather: 1 },
        };
        const optimizedPlan = optimizeWith2Opt(greedyPlan, userPreferences, candidates);

        // Lưu Trip vào DB
        const newTrip = await prisma.trip.create({
            data: {
                user_id:          dbUser.user_id,
                destination_city: payload.destinationCity || 'Da Nang',
                start_date:       startDate,
                end_date:         endDate,
                budget_total:     payload.budgetTotal || 5000000,
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