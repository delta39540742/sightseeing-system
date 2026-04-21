import { Router, Request, Response } from 'express';
// Import prisma instance từ server.ts (nằm ở cấu trúc src/server.ts)
import { prisma } from '../server';

const router = Router();

/**
 * GET /
 * API lấy toàn bộ danh sách địa điểm Đà Nẵng
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Dùng prisma.place.findMany() để lấy tất cả dữ liệu
    const places = await prisma.place.findMany();

    // 2. Trả về JSON response chuẩn
    res.status(200).json({
      success: true,
      count: places.length,
      data: places
    });
  } catch (error) {
    // 3. Xử lý lỗi 500
    console.error('Lỗi khi lấy danh sách địa điểm:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi máy chủ nội bộ. Không thể truy xuất database.'
    });
  }
});

export default router;
