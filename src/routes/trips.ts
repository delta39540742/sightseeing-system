import { Router, Request, Response } from 'express';
import { prisma } from '../server';
import { eventBus, EventName } from '../events/eventBus';

const router = Router();

/**
 * POST /api/trips
 * Tạo biên bản (draft) chuyến đi mới
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Lấy dữ liệu cần thiết từ req.body
    // Dựa vào schema.prisma bảng 'trip', những trường bắt buộc để khởi tạo gồm có:
    const {
      user_id,             // Chú ý: Ở hệ thống thực nên dùng req.user.user_id lấy từ token (middleware)
      destination_city,
      start_date,
      end_date,
      budget_total,
      title,               // (Tùy chọn) 
      raw_prompt           // (Tùy chọn) raw text người dùng chat với AI
    } = req.body;

    // Validate dữ liệu cơ bản
    if (!user_id || !destination_city || !start_date || !end_date || budget_total === undefined) {
      res.status(400).json({
        success: false,
        error: 'Vui lòng cung cấp đầy đủ thông tin bắt buộc (user_id, destination_city, start_date, end_date, budget_total).'
      });
      return;
    }

    // 2. Dùng Prisma để lưu dữ liệu vào Database
    const newTrip = await prisma.trip.create({
      data: {
        user_id,
        destination_city,
        start_date: new Date(start_date), // Prisma yêu cầu kiểu DateTime
        end_date: new Date(end_date),
        budget_total: parseInt(budget_total),
        title: title || null,
        raw_prompt: raw_prompt || null,
        status: 'draft', // Bạn có set default trong schema, nhưng truyền vào cho tường minh
      }
    });

    // 3. Phát sự kiện (emit) khi việc tạo hoàn tất thành công
    // Hệ thống/AI engine có thể đang lắng nghe event này để bắt đầu chạy thuật toán gợi ý điểm điểm...
    eventBus.emit(EventName.TRIP_CREATED, newTrip);

    // 4. Trả về JSON cấu trúc chuẩn theo yêu cầu
    res.status(201).json({
      success: true,
      data: newTrip
    });

  } catch (error) {
    // 5. Bắt lỗi 500
    console.error('Lỗi khi tạo Trip:', error);
    res.status(500).json({
      success: false,
      error: 'Lỗi máy chủ nội bộ. Không thể tạo chuyến đi lúc này.'
    });
  }
});

export default router;
