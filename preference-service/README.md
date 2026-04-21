# Preference Service (Người 8)

## Setup

```bash
cp .env.example .env
# Điền DATABASE_URL trỏ vào Docker Compose DB

npm install
npm run db:generate   # generate Prisma client
npm run dev           # chạy dev server port 3001
```

## API Endpoints

### Survey
| Method | Path | Mô tả |
|--------|------|-------|
| GET    | `/api/preferences/survey/status` | Kiểm tra đã làm survey chưa |
| POST   | `/api/preferences/survey`        | Lưu kết quả survey (lần đầu) |
| PATCH  | `/api/preferences/survey`        | Cập nhật sở thích |

### Dành cho Người 4 & 6
| Method | Path | Mô tả |
|--------|------|-------|
| GET    | `/api/preferences/weights`        | Lấy weights + soft constraints |
| GET    | `/api/preferences/similar-users`  | Lấy danh sách user tương tự |

### Dành cho Người 7 (FE)
| Method | Path | Mô tả |
|--------|------|-------|
| POST   | `/api/preferences/favorite`           | Thêm favorite |
| DELETE | `/api/preferences/favorite/:placeId`  | Xóa favorite |

## Auth

Tất cả endpoints cần header:
```
x-user-id: <UUID của user>
```
Header này do Người 1 inject sau khi verify Firebase token.

## Event Bus (Người 4 & 6 cần emit)

Import `eventBus` và emit các event sau:

```typescript
import { eventBus } from 'preference-service/src/lib/eventBus';
// hoặc nếu cùng process:
import { eventBus } from '../lib/eventBus';

// Khi user accept/reject replan
eventBus.emit('trip.replan.accepted', { userId, tripId, armId });
eventBus.emit('trip.replan.rejected', { userId, tripId, armId });

// Khi user accept/reject slot
eventBus.emit('trip.slot.accepted',  { userId, tripId, placeId, armId });
eventBus.emit('trip.slot.rejected',  { userId, tripId, placeId, armId });

// Khi user hoàn thành 1 slot
eventBus.emit('trip.slot.completed', { userId, tripId, placeId, armId });

// Khi landmark được nhận diện (Người 3)
eventBus.emit('landmark.recognized', { userId, placeId, tripId?, confidence });
```

**Lưu ý:** `armId` là ID của arm đang được dùng cho user đó.
Lấy từ `GET /api/preferences/weights` → field `currentArmId`.

## Cron Jobs

- **03:00 VN** mỗi đêm: tính lại user similarity (SVD/cosine)
- Chạy thủ công: `ts-node -e "require('./src/jobs/similarity.job').runSimilarityJob()"`
