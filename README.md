# TravelSystem — MVP Setup Guide

Hệ thống gợi ý và lập lịch trình du lịch thông minh với replanning động.

## Kiến trúc tổng quan

```
TravelSystem/
├── backend/            # Fastify API (port 3000) — core service
├── preference-service/ # Express API (port 3001) — UCB1 bandit & survey
├── frontend/           # Static HTML login page
├── danang_places.json  # Dữ liệu 94 địa điểm Đà Nẵng
└── docker-compose.yml  # PostgreSQL + PostGIS
```

## Yêu cầu

- Node.js >= 18
- Docker Desktop
- Git Bash hoặc PowerShell

---

## 1. Khởi động Database

```bash
docker-compose up -d
```

Kiểm tra container đã lên:
```bash
docker ps
# PORTS: 0.0.0.0:5433->5432/tcp
```

---

## 2. Cài đặt Backend

```bash
cd backend
npm install
```

### Cấu hình môi trường

File `backend/.env` đã có sẵn với cấu hình mặc định:
```
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
DB_USER=tdtt_user
DB_PASSWORD=tdtt_password
DB_HOST=localhost
DB_PORT=5433
DB_NAME=tdtt_db
PORT=3000
```

### Chạy migration

```bash
npx prisma migrate deploy
npx prisma generate
```

### Seed dữ liệu

```bash
# Seed user dev
npm run seed

# Seed 94 địa điểm Đà Nẵng
npm run seed:places
```

> **Lưu ý:** Cần seed bandit arms thủ công (chạy 1 lần):
> ```bash
> docker exec $(docker ps -q) psql -U tdtt_user -d tdtt_db -c "
> INSERT INTO bandit_arm (arm_id, name, w_interest, w_pace, w_distance, w_budget, w_weather, w_risk) VALUES
> (1,'balanced',1.0,1.0,1.0,1.0,1.0,1.0),(2,'interest',2.0,0.5,0.5,0.5,0.5,0.5),
> (3,'pace',0.5,2.0,0.5,0.5,0.5,0.5),(4,'budget',0.5,0.5,0.5,2.0,0.5,0.5),
> (5,'exploration',1.5,0.5,1.5,0.5,0.5,0.5),(6,'safe',0.5,1.0,0.5,1.0,1.5,2.0)
> ON CONFLICT (arm_id) DO NOTHING;"
> ```

### Khởi động Backend

```bash
npm run dev
```

Kiểm tra:
```bash
curl http://localhost:3000/health
# {"status":"ok","message":"TDTT Backend is running"}
```

---

## 3. Cài đặt Preference Service

Mở terminal mới:

```bash
cd preference-service
npm install
```

Tạo file `.env`:
```bash
# Windows PowerShell
"DATABASE_URL=`"postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db`"`nPORT=3001`nNODE_ENV=development" | Out-File -Encoding utf8 .env

# Git Bash
echo 'DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
PORT=3001
NODE_ENV=development' > .env
```

Generate Prisma client:
```bash
npx prisma generate
```

Khởi động:
```bash
npm run dev
```

Kiểm tra:
```bash
curl http://localhost:3001/health
# {"status":"ok","service":"preference"}
```

---

## 4. Kiểm tra toàn bộ API

Thay `<USER_ID>` bằng UUID lấy từ lệnh:
```bash
docker exec $(docker ps -q) psql -U tdtt_user -d tdtt_db -c "SELECT user_id FROM app_user WHERE firebase_uid = 'seed-dev-user';"
```

### Backend API (port 3000)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/health` | Health check |
| POST | `/api/auth/login` | Đăng nhập Firebase |
| GET | `/api/places` | Danh sách địa điểm |
| GET | `/api/places/:id` | Chi tiết địa điểm |
| POST | `/api/trips` | Tạo trip mới |
| POST | `/api/plan/generate` | Tạo lịch trình greedy + 2-opt |
| POST | `/api/plan/candidates` | Lấy danh sách địa điểm phù hợp |
| POST | `/api/trips/:id/replan` | Tạo replan proposal |
| GET | `/api/trips/:id/replan/pending` | Lấy proposal đang chờ |
| POST | `/api/trips/:id/replan/:pid/accept` | Chấp nhận proposal |
| POST | `/api/trips/:id/replan/:pid/reject` | Từ chối proposal |

**Ví dụ tạo trip:**
```bash
curl -X POST http://localhost:3000/api/trips \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"<USER_ID>\",\"destination_city\":\"Da Nang\",\"start_date\":\"2026-05-01\",\"end_date\":\"2026-05-03\",\"budget_total\":5000000}"
```

**Ví dụ tạo lịch trình:**
```bash
curl -X POST http://localhost:3000/api/plan/generate \
  -H "Content-Type: application/json" \
  -d "{\"destinationCity\":\"Da Nang\",\"startDate\":\"2026-05-01\",\"endDate\":\"2026-05-03\",\"budgetTotal\":5000000}"
```

**Ví dụ replan:**
```bash
# 1. Update trip status sang active
docker exec $(docker ps -q) psql -U tdtt_user -d tdtt_db \
  -c "UPDATE trip SET status='active' WHERE trip_id='<TRIP_ID>';"

# 2. Tạo proposal
curl -X POST http://localhost:3000/api/trips/<TRIP_ID>/replan \
  -H "Content-Type: application/json" \
  -d "{\"replanScope\":\"remaining_trip\"}"

# 3. Accept proposal
curl -X POST http://localhost:3000/api/trips/<TRIP_ID>/replan/<PROPOSAL_ID>/accept
```

### Preference Service API (port 3001)

Tất cả endpoints đều cần header `x-user-id: <USER_ID>`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/preferences/survey` | Lưu survey lần đầu |
| GET | `/api/preferences/survey/status` | Kiểm tra đã survey chưa |
| PATCH | `/api/preferences/survey` | Cập nhật survey |
| GET | `/api/preferences/weights` | Lấy objective weights (UCB1) |
| GET | `/api/preferences/similar-users` | Danh sách user tương tự |
| POST | `/api/preferences/favorite` | Thêm địa điểm yêu thích |
| DELETE | `/api/preferences/favorite/:placeId` | Xoá khỏi yêu thích |

**Ví dụ survey:**
```bash
curl -X POST http://localhost:3001/api/preferences/survey \
  -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" \
  -d "{\"primaryPurpose\":\"leisure\",\"pace\":0.6,\"dailyScheduleType\":\"morning\",\"budgetPerDayMin\":200000,\"budgetPerDayMax\":800000,\"groupType\":\"couple\",\"preferredTagIds\":[1,2,3],\"foodPreferences\":[\"local\"],\"mobilityRestrictions\":[]}"
```

---

## 5. Chạy Tests

```bash
cd backend
npm test
# 100 tests pass
```

---

## 6. Cấu trúc thư mục Backend

```
backend/
├── src/
│   ├── server.ts              # Entry point Fastify
│   ├── lib/prisma.ts          # Prisma client singleton
│   ├── config/firebase.ts     # Firebase Admin SDK
│   ├── middlewares/           # Auth middleware
│   ├── routes/                # auth, places, trips, internalEvents
│   ├── api/
│   │   ├── plan/              # Greedy + 2-opt planner
│   │   └── replan/            # BeamSearch replanner
│   ├── replanner/             # Core engine
│   │   ├── BeamSearch.ts
│   │   ├── StateEvolver.ts
│   │   ├── MutationOperators.ts
│   │   ├── ObjectiveScorer.ts
│   │   ├── PlanLoader.ts
│   │   ├── CausalTraceBuilder.ts
│   │   └── ProposalStore.ts
│   ├── events/eventBus.ts     # In-process event bus
│   └── types/index.ts         # Shared TypeScript types
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                # Seed user dev
│   └── migrations/
└── firebase-service-account.json
```

---

## Lưu ý quan trọng

- `firebase-service-account.json` chứa credentials thật — **không commit lên public repo**
- Database chạy trên port **5433** (không phải 5432 mặc định)
- Preference service dùng Prisma **5.x**, backend dùng Prisma **7.x** — không hoán đổi
- `lat`/`lng` trong bảng `place` là generated columns từ PostGIS — không INSERT trực tiếp, dùng `ST_GeogFromText` hoặc `ST_MakePoint`
