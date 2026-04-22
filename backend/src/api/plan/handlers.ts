// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../server';
import { generateGreedyPlan, optimizeWith2Opt } from './solver';

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
    const candidates = places.map(p => {
      // tagMatch: số lượng tag trùng khớp với sở thích user
      const tagMatchCount = p.place_tag_map.filter(tm => 
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

// Thêm dòng này lên khu vực import ở đầu file:
// import { generateGreedyPlan } from './solver';

export const createTrip = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
        const payload = req.body as any; 
        
        // --- PHẦN THÊM MỚI: Lấy candidates từ Database ---
        const avgBudgetPerDay = (payload.budgetTotal || 5000000) / 3;
        const places = await prisma.place.findMany({
            where: {
                address: { contains: payload.destinationCity || 'Da Nang' },
                min_price: { lte: avgBudgetPerDay },
            },
            include: { place_tag_map: true }
        });

        const candidates = places.map((p: any) => {
            const tagMatchCount = p.place_tag_map.filter((tm: any) =>
                (payload.preferredTagIds || []).includes(tm.tag_id)
            ).length;
            return {
                placeId:            Number(p.place_id),
                name:               p.name,
                lat:                p.lat ?? 16.06,
                lng:                p.lng ?? 108.22,
                avgVisitDurationMin: p.avg_visit_duration_min ?? 60,
                minPrice:           p.min_price ?? 0,
                maxPrice:           p.max_price ?? 0,
                indoorOutdoor:      p.indoor_outdoor,
                popularityScore:    p.popularity_score ?? 0,
                terrainEasiness:    p.terrain_easiness ?? 1,
                tags:               p.place_tag_map,
                openingHours:       [],
                matchScore:         tagMatchCount + (p.popularity_score || 0) * 0.3,
            };
        }).sort((a: any, b: any) => b.matchScore - a.matchScore).slice(0, 100);
        // ---------------------------------------------------

        const dummyWeights = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
        
        // 1. Chạy Greedy (Lấy lịch trình thô)
        const greedyPlan = generateGreedyPlan(3, payload.budgetTotal || 5000000, candidates, dummyWeights);

        // Tạo object userPreferences giả để 2-opt dùng
        const userPreferences = {
            preferredTagIds: payload.preferredTagIds || [],
            budgetRemaining: payload.budgetTotal || 5000000,
            weights: { interest: 1, distance: 1.5, budget: 1, weather: 1 }
        };

        // 2. Chạy 2-opt (Tối ưu hóa lịch trình thô)
        const optimizedPlan = optimizeWith2Opt(greedyPlan, userPreferences, candidates);

        // 3. Trả kết quả đã tối ưu về cho User
        // --- BẮT ĐẦU PHẦN LƯU DATABASE ---
        // Sử dụng $transaction để đảm bảo nếu lưu lỗi thì sẽ không tạo trip "rác"
        const defaultUser = await prisma.app_user.findFirst();
        if (!defaultUser) {
            throw new Error("Không tìm thấy người dùng nào trong DB. Hãy kiểm tra lại file seed!");
        }

        // Sử dụng $transaction để đảm bảo nếu lưu lỗi thì sẽ không tạo trip "rác"
        const savedTrip = await prisma.$transaction(async (tx) => {
            // 1. Tạo bản ghi Trip chính
            const trip = await tx.trip.create({
                data: {
                    // SỬA Ở ĐÂY: Lấy ID thật của defaultUser vừa tìm được
                    user_id: payload.userId || defaultUser.user_id, 
                    destination_city: payload.destinationCity || 'Da Nang',
                    start_date: new Date(payload.startDate),
                    end_date: new Date(payload.endDate),
                    budget_total: payload.budgetTotal || 5000000,
                    status: 'confirmed',
                    objective_score: 59.34, 
                }
            });

            // 2. Tạo danh sách các Slot gắn liền với Trip vừa tạo
            const slotsData = optimizedPlan.map(slot => ({
                trip_id: trip.trip_id,
                day_index: slot.dayIndex,
                slot_order: slot.slotOrder,
                place_id: BigInt(slot.placeId),
                planned_start: new Date(slot.plannedStart),
                planned_end: new Date(slot.plannedEnd),
                estimated_cost: slot.estimatedCost,
                activity_type: slot.activityType,
                rationale: slot.rationale,
                status: 'planned'
            }));

            await tx.trip_slot.createMany({
                data: slotsData
            });

            // Lấy lại full dữ liệu trip kèm slots để trả về
            return await tx.trip.findUnique({
                where: { trip_id: trip.trip_id },
                include: { trip_slot: true }
            });
        });

        // 3. Trả về kết quả 201 thành công kèm dữ liệu đã lưu từ Database
        return reply.status(201).send(savedTrip);
        // --- KẾT THÚC PHẦN LƯU DATABASE ---
    } catch (error: any) {
        console.error("=== LỖI CREATE TRIP ===", error); 
        return reply.status(500).send({ error: error.message });
    }
};