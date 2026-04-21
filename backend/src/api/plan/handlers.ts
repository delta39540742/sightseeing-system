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
            // where: {
            //     address: { contains: payload.destinationCity || 'Da Nang' },
            //     min_price: { lte: avgBudgetPerDay },
            // },
            include: { place_tag_map: true }
        });

        const candidates = places.map((p: any) => {
            const tagMatchCount = p.place_tag_map.filter((tm: any) => 
                (payload.preferredTagIds || []).includes(tm.tag_id)
            ).length;
            return { ...p, matchScore: tagMatchCount + (p.popularity_score || 0) * 0.3 };
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
        return reply.send({
            message: "Tạo lịch trình thành công",
            slots: optimizedPlan 
        });
    } catch (error: any) {
        console.error("=== LỖI CREATE TRIP ===", error); 
        return reply.status(500).send({ error: error.message });
    }
};