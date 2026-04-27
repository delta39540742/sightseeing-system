# Preference Service

Service quản lý sở thích người dùng, vận hành thuật toán UCB1 Multi-Armed Bandit để tối ưu trọng số lập lịch, và học sở thích theo thời gian thực từ hành vi người dùng.

**Framework:** Fastify 5, TypeScript, Prisma 5  
**Port:** 3001

---

## Setup

```bash
cp .env.example .env
# Điền DATABASE_URL trỏ vào Docker Compose DB

npm install
npm run db:generate   # generate Prisma client
npm run dev           # chạy dev server port 3001
```

**`.env` cần có:**
```env
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
PORT=3001
NODE_ENV=development
```

---

## API Endpoints

Tất cả endpoints (trừ `/health` và `/internal/*`) cần header:
```
x-user-id: <UUID của user trong bảng app_user>
```

### Survey

| Method | Path | Mô tả |
|--------|------|-------|
| GET    | `/api/preferences/survey/status` | Kiểm tra user đã làm survey chưa |
| POST   | `/api/preferences/survey`        | Lưu kết quả survey (lần đầu) |
| PATCH  | `/api/preferences/survey`        | Cập nhật sở thích |

**Body POST/PATCH survey:**
```json
{
  "primaryPurpose": "leisure",
  "pace": 0.6,
  "dailyScheduleType": "morning",
  "budgetPerDayMin": 200000,
  "budgetPerDayMax": 800000,
  "groupType": "couple",
  "preferredTagIds": [1, 2, 3],
  "foodPreferences": ["local"],
  "mobilityRestrictions": []
}
```

Validation:
- `pace` phải nằm trong `[0, 1]`
- `preferredTagIds` phải nằm trong `[1..10]`, không trùng lặp
- `budgetPerDayMax >= budgetPerDayMin`
- `preferredTagIds` tối thiểu 3 phần tử

### Weights & Similarity (dành cho backend planner/replanner)

| Method | Path | Mô tả |
|--------|------|-------|
| GET    | `/api/preferences/weights`        | Lấy objective weights hiện tại (UCB1 bandit) |
| GET    | `/api/preferences/similar-users`  | Danh sách user có sở thích tương đồng |

**Response GET `/weights`:**
```json
{
  "weights": {
    "wInterest": 1.2,
    "wPace": 0.8,
    "wDistance": 1.5,
    "wBudget": 1.0,
    "wWeather": 1.0,
    "wRisk": 1.0
  },
  "softConstraints": [
    { "type": "avoid_category", "value": "3", "strength": 0.4 }
  ],
  "currentArmId": 2,
  "context": "plan"
}
```

**Query params GET `/similar-users`:**
- `limit` (mặc định 10, tối đa 50)

### Tương tác người dùng

| Method | Path | Mô tả |
|--------|------|-------|
| POST   | `/api/preferences/favorite`           | Thêm địa điểm vào yêu thích |
| DELETE | `/api/preferences/favorite/:placeId`  | Xoá địa điểm khỏi yêu thích |
| POST   | `/api/preferences/rating`             | Ghi nhận đánh giá địa điểm (rating 1–5) |

**Body POST `/rating`:**
```json
{
  "placeId": 123,
  "rating": 4,
  "tripId": "<optional-trip-id>"
}
```

Mỗi rating sẽ cập nhật `preferenceVector` của user theo công thức incremental learning.

### Internal (chỉ dành cho backend, không cần `x-user-id`)

| Method | Path | Mô tả |
|--------|------|-------|
| POST   | `/api/preferences/internal/reward` | Nhận event từ backend sau replan/slot decisions |

**Body POST `/internal/reward`:**
```json
{
  "userId": "<uuid>",
  "tripId": "<trip-id>",
  "armId": 2,
  "interactionType": "replan_accepted",
  "placeId": 123
}
```

`interactionType` hợp lệ: `replan_accepted`, `replan_rejected`, `poi_accepted`, `poi_rejected`, `slot_completed`

Backend gọi endpoint này **fire-and-forget** (không await) sau mỗi quyết định replan/slot.

---

## Thuật toán UCB1 Multi-Armed Bandit

Service vận hành 6 "arm" (bộ trọng số mục tiêu):

| Arm | Tên | Đặc điểm |
|-----|-----|-----------|
| 1 | balanced | Cân bằng tất cả |
| 2 | interest | Ưu tiên sở thích tag |
| 3 | pace | Ưu tiên nhịp độ |
| 4 | budget | Ưu tiên tiết kiệm |
| 5 | exploration | Ưu tiên khám phá (xa, đa dạng) |
| 6 | safe | Ưu tiên an toàn, ít rủi ro |

**UCB1 formula:** `score = avgReward + sqrt(2 * ln(totalPulls) / armPulls)`

Arm có score cao nhất được chọn cho user. Mỗi lần user accept/reject replan hoặc accept/reject slot, reward được cập nhật tương ứng.

---

## Incremental Preference Learning

Mỗi lần user tương tác với địa điểm, `preferenceVector` (10 chiều, mỗi chiều tương ứng 1 tag) được cập nhật:

```
newVec[i] = clamp(oldVec[i] + LEARNING_RATE * strength * tagVec[i], 0, 1)
```

Sau đó normalize về `[0, 1]` theo max value.

| Hành động | Strength |
|-----------|----------|
| Đánh giá 5 sao | +1.0 |
| Đánh giá 4 sao | +0.5 |
| Yêu thích (favorite) | +0.5 |
| Slot hoàn thành | +0.3 |
| POI accepted | +0.2 |
| Đánh giá 3 sao | 0.0 (trung lập) |
| POI rejected | -0.15 |
| Đánh giá 2 sao | -0.25 |
| Đánh giá 1 sao | -0.5 |
| Nhận diện địa danh | +0.1 × confidence |

Nếu user reject liên tục ≥ 3 POI cùng tag trong 7 ngày → tự động thêm `avoid_category` vào `softConstraints`.

---

## Cron Jobs

- **03:00 VN** mỗi đêm: tính lại user similarity (cosine similarity từ interaction logs)
- Chạy thủ công:
  ```bash
  npx ts-node -e "require('./src/jobs/similarity.job').runSimilarityJob()"
  ```

---

## Scripts

```bash
npm run dev           # dev server với hot-reload
npm run build         # compile TypeScript
npm start             # chạy bản build
npm run db:generate   # generate Prisma client
npm run db:migrate    # chạy migration
npm run db:push       # push schema trực tiếp (dev only)
```
