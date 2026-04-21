import { EventEmitter } from 'events';

// Định nghĩa các EventName (Hằng số/Enum) cơ bản cho hệ thống
export enum EventName {
  TRIP_CREATED = 'TRIP_CREATED',
  USER_LOGGED_IN = 'USER_LOGGED_IN',
  USER_REGISTERED = 'USER_REGISTERED',
  PAYMENT_COMPLETED = 'PAYMENT_COMPLETED',
  ERROR_OCCURRED = 'ERROR_OCCURRED'
}

// Khởi tạo lớp EventBus kế thừa từ EventEmitter (giúp dễ dàng mở rộng, ví dụ: override các method nếu cần)
class EventBus extends EventEmitter {}

// Tạo và export một instance duy nhất (Singleton) dùng chung cho toàn bộ ứng dụng
export const eventBus = new EventBus();

// Alias với API kiểu static để tương thích với các module dùng InternalEventBus.publish()
export const InternalEventBus = {
  publish: (event: string, payload: unknown): void => {
    eventBus.emit(event, payload);
  },
  subscribe: (event: string, listener: (...args: unknown[]) => void): void => {
    eventBus.on(event, listener);
  },
  unsubscribe: (event: string, listener: (...args: unknown[]) => void): void => {
    eventBus.off(event, listener);
  },
};

/*
---------------------------------------------------------------------------
VÍ DỤ CÁCH SỬ DỤNG EVENT BUS (Phát và Lắng nghe sự kiện)
---------------------------------------------------------------------------

// 1. NGƯỜI LẮNG NGHE (Ví dụ: src/services/notification.service.ts)
// Import eventBus và Enum EventName
import { eventBus, EventName } from '../events/eventBus';

// Đăng ký lắng nghe sự kiện
eventBus.on(EventName.USER_LOGGED_IN, (payload) => {
  console.log(`[Listener] Người dùng đăng nhập:`, payload.userId);
});

eventBus.on(EventName.TRIP_CREATED, (tripData) => {
  console.log(`[Listener] Có chuyến đi mới được tạo:`, tripData);
  // Thực hiện các logic bất đồng bộ: tính toán lộ trình, gửi thông báo,...
});


// 2. NGƯỜI PHÁT SỰ KIỆN (Ví dụ: src/controllers/user.controller.ts)
// Import eventBus và Enum EventName
import { eventBus, EventName } from '../events/eventBus';

const loginUser = (req, res) => {
  // ... (Logic xử lý đăng nhập thành công)
  const userData = { userId: 123, email: 'test@example.com' };

  // Bắn (emit) sự kiện ra toàn hệ thống
  eventBus.emit(EventName.USER_LOGGED_IN, userData);

  // res.status(200).json({ message: 'Login successful' });
};

const createTrip = (req, res) => {
  // ... (Logic lưu vào Database thành công)
  const newTrip = { id: 'T_001', destination: 'Đà Nẵng' };

  // Phát sự kiện trip được tạo
  eventBus.emit(EventName.TRIP_CREATED, newTrip);

  // res.status(201).json(newTrip);
};
*/
