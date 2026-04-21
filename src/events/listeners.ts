import { prisma } from '../server';
import { eventBus, EventName } from './eventBus';

// Camera 1: Kiểm tra xem server có gọi file này dậy thành công không
console.log("📢 [Camera 1] FILE LISTENERS.TS ĐÃ ĐƯỢC NẠP VÀO BỘ NHỚ!");

// Đăng ký worker lắng nghe sự kiện TRIP_CREATED
eventBus.on(EventName.TRIP_CREATED, async (tripPayload) => {
  // Camera 2: Xác nhận đã nghe được tiếng hét từ file routes
  console.log(`🔥 [Camera 2] BẮT ĐƯỢC SỰ KIỆN: ${EventName.TRIP_CREATED} | Mã Trip: ${tripPayload.trip_id}`);

  try {
    const newLog = await prisma.event_log.create({
      data: {
        event_name: EventName.TRIP_CREATED,
        payload: tripPayload // Prisma sẽ tự động stringify object này qua kiểu DB Json
      }
    });

    // Camera 3: Chốt đơn thành công
    console.log(`✅ [Camera 3] ĐÃ LƯU LOG THÀNH CÔNG! (Mã Log: ${newLog.log_id.toString()})`);
  } catch (error) {
    // Camera 4: Bắt tại trận nếu Database từ chối lưu
    console.error(`❌ [Camera 4 - LỖI NGHIÊM TRỌNG] LƯU DATABASE THẤT BẠI:`, error);
  }
});