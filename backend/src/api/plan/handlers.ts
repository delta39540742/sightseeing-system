// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../server';
import { generateGreedyPlan } from './solver';

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

export async function createTrip(req: FastifyRequest, reply: FastifyReply) {
    try {
        const payload = req.body as any; // Lấy dữ liệu user submit
        
        // B1: Lấy danh sách ứng viên thật từ database (Đã sửa lỗi dòng đỏ)
        // B1: Lấy danh sách ứng viên từ database (Dữ liệu thô snake_case)
        const rawCandidates = await prisma.place.findMany({
            where: {
                address: { contains: payload.destinationCity || 'Da Nang' }
            },
            include: {
                place_tag_map: true 
            }
        });

        // B1.5: "Phiên dịch" dữ liệu từ snake_case sang camelCase để TypeScript ngừng kêu ca
        const candidates = rawCandidates.map((p: any) => ({
            ...p, // Giữ lại các trường giống nhau (name, lat, lng, description...)
            placeId: Number(p.place_id), // Xử lý lỗi BigInt của PostgreSQL
            minPrice: p.min_price,
            maxPrice: p.max_price,
            priceType: p.price_type,
            avgVisitDurationMin: p.avg_visit_duration_min,
            parkingAvailable: p.parking_available,
            wheelchairAccess: p.wheelchair_access,
            publicTransport: p.public_transport,
            terrainEasiness: p.terrain_easiness,
            roadAccessScore: p.road_access_score,
            spaciousness1km: p.spaciousness_1km,
            popularityScore: p.popularity_score,
            indoorOutdoor: p.indoor_outdoor,
            isLandmark: p.is_landmark,
            landmarkClassId: p.landmark_class_id,
            // Map luôn cái tag để xíu nữa Greedy chấm điểm
            tags: p.place_tag_map.map((tm: any) => ({ tagId: tm.tag_id }))
        }));
        
        // B2: Mock một bộ trọng số
        const dummyWeights = { wInterest: 1, wPace: 1, wDistance: 1.5, wBudget: 1, wWeather: 1, wRisk: 1 };
        
        // B3: Chạy thuật toán Greedy
        const plannedSlots = generateGreedyPlan(
            3, // Số ngày
            payload.budgetTotal || 5000000,
            candidates, 
            dummyWeights
        );

        // Trả về lịch trình để Frontend hiển thị
        return reply.send({ slots: plannedSlots });
        
    } catch (error: any) {
        return reply.status(500).send({ error: error.message });
    }
}