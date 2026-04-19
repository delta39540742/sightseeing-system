// src/api/trips/handlers.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 100);

    return reply.send({ items: candidates });
  } catch (error) {
    return reply.status(500).send({ error: 'INTERNAL_SERVER_ERROR', message: error });
  }
}