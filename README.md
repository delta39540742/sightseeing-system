# TravelSystem — Hệ thống Lập lịch Du lịch Thông minh

Hệ thống gợi ý và lập lịch trình du lịch thông minh với replanning động, tích hợp NLU, nhận diện địa danh, định tuyến đường bộ thực tế (OSRM), tối ưu lộ trình thông minh, và học sở thích người dùng theo thời gian thực.

## Kiến trúc tổng quan

```
TravelSystem/
├── backend/            # Fastify API (port 3000) — core service
├── frontend/           # React + Vite (port 5173) — giao diện người dùng
├── preference-service/ # Fastify API (port 3001) — UCB1 bandit, survey, incremental learning
├── danang_places.json  # Dữ liệu 94 địa điểm Đà Nẵng
└── docker-compose.yml  # PostgreSQL + PostGIS
```

## Công nghệ sử dụng

| Tầng | Công nghệ |
|------|-----------|
| Backend | Fastify 5, TypeScript, Prisma 7, PostgreSQL + PostGIS |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Leaflet, Zustand, React Query |
| Preference Service | Fastify 5, Prisma 5, UCB1 Bandit, Incremental Vector Learning, node-cron |
| Auth | Firebase Admin (backend) + Firebase Client (frontend) |
| NLU | Google Colab (external endpoint qua `COLAB_NLU_URL`) |
| Infrastructure | Docker Compose, PostgreSQL 15 + PostGIS 3.3 |

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

Tạo file `backend/.env` (xem `backend/.env.example` để tham khảo):
```env
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
DB_USER=tdtt_user
DB_PASSWORD=tdtt_password
DB_HOST=localhost
DB_PORT=5433
DB_NAME=tdtt_db
PORT=3000

# URL của Colab NLU server (thay bằng URL ngrok/pinggy hiện tại)
COLAB_NLU_URL=https://<your-tunnel-url>

# URL preference-service (mặc định localhost nếu không set)
PREFERENCE_SERVICE_URL=http://localhost:3001

# Firebase Admin SDK
FIREBASE_PROJECT_ID=<your-project-id>
FIREBASE_PRIVATE_KEY_ID=<your-private-key-id>
FIREBASE_PRIVATE_KEY=<your-private-key>
FIREBASE_CLIENT_EMAIL=<your-client-email>
FIREBASE_CLIENT_ID=<your-client-id>
```

> **Lưu ý:** `COLAB_NLU_URL` phải trỏ đến tunnel đang chạy Colab NLU. Nếu không set, endpoint `/api/nlu/*` sẽ trả lỗi 503.  
> Thay vì set từng biến Firebase, có thể để nguyên file `firebase-service-account.json` trong thư mục `backend/`.

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

# Seed dữ liệu fake (trips, slots, interactions) để test
npm run seed:fake
```

> **Seed bandit arms** (chạy 1 lần sau khi migration):
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

Tạo file `preference-service/.env`:
```env
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
PORT=3001
NODE_ENV=development
```

Generate Prisma client:
```bash
npm run db:generate
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

## 4. Cài đặt Frontend

Tạo file `frontend/.env` (xem `frontend/.env.example`):
```env
VITE_FIREBASE_API_KEY=<your-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<your-project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<your-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<your-project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<your-messaging-sender-id>
VITE_FIREBASE_APP_ID=<your-app-id>
```

> Vite proxy tự động chuyển `/api/*` → `http://localhost:3000` và `/pref/*` → `http://localhost:3001`.

Mở terminal mới:

```bash
cd frontend
npm install
npm run dev
```

Truy cập: `http://localhost:5173`

---

## 5. API Reference

Lấy `<USER_ID>` (UUID) từ lệnh:
```bash
docker exec $(docker ps -q) psql -U tdtt_user -d tdtt_db -c "SELECT user_id FROM app_user WHERE firebase_uid = 'seed-dev-user';"
```

### Backend API (port 3000)

#### Auth
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/auth/login` | Đăng nhập / đăng ký qua Firebase token |

#### Trips
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/trips` | Danh sách trips của user hiện tại |
| GET | `/api/trips/:tripId` | Chi tiết trip kèm slots |
| POST | `/api/trips` | Tạo trip draft mới |
| PATCH | `/api/trips/:tripId` | Cập nhật thông tin trip |
| DELETE | `/api/trips/:tripId` | Xoá trip |
| POST | `/api/trips/:tripId/slots` | Thêm địa điểm vào trip |
| PATCH | `/api/trips/:tripId/slots/:slotId` | Cập nhật trạng thái slot (VD: `completed`) |

#### Planning
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/plan/candidates` | Lấy danh sách địa điểm phù hợp (lọc + score) |
| POST | `/api/plan/generate` | Tạo lịch trình Greedy + 2-opt tối ưu |

#### Replan
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/trips/:tripId/replan` | Tạo replan proposal (BeamSearch) |
| GET | `/api/trips/:tripId/replan/pending` | Lấy proposal đang chờ duyệt |
| POST | `/api/trips/:tripId/replan/:pid/accept` | Chấp nhận proposal |
| POST | `/api/trips/:tripId/replan/:pid/reject` | Từ chối proposal |

#### Places & Landmark
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/places` | Danh sách tất cả địa điểm |
| GET | `/api/places/:id` | Chi tiết địa điểm |
| POST | `/api/landmark/recognize` | Nhận diện địa danh từ ảnh |
| GET | `/api/landmark/recognition/:recognitionId` | Kết quả nhận diện |
| POST | `/api/landmark/:recognitionId/add-to-trip` | Thêm địa danh nhận diện vào trip |

#### NLU & Monitor
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/nlu/parse` | Phân tích câu nhập tự nhiên (cần `COLAB_NLU_URL`) |
| POST | `/api/monitor/sync-trip` | Đồng bộ trạng thái trip từ bên ngoài |
| GET | `/api/monitor/check-incident` | Kiểm tra sự cố Weather/Traffic hiện tại |
| POST | `/api/monitor/mock-incident` | **(Dev-only)** Giả lập sự cố để test replan |

**Ví dụ tạo trip:**
```bash
curl -X POST http://localhost:3000/api/trips \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<FIREBASE_UID>","destination_city":"Da Nang","start_date":"2026-05-01","end_date":"2026-05-03","budget_total":5000000}'
```

**Ví dụ tạo lịch trình:**
```bash
curl -X POST http://localhost:3000/api/plan/generate \
  -H "Content-Type: application/json" \
  -d '{"destinationCity":"Da Nang","startDate":"2026-05-01","endDate":"2026-05-03","budgetTotal":5000000}'
```

**Ví dụ replan:**
```bash
# 1. Chuyển trip sang active
docker exec $(docker ps -q) psql -U tdtt_user -d tdtt_db \
  -c "UPDATE trip SET status='active' WHERE trip_id='<TRIP_ID>';"

# 2. Tạo proposal
curl -X POST http://localhost:3000/api/trips/<TRIP_ID>/replan \
  -H "Content-Type: application/json" \
  -d '{"replanScope":"remaining_trip"}'

# 3. Accept proposal
curl -X POST http://localhost:3000/api/trips/<TRIP_ID>/replan/<PROPOSAL_ID>/accept
```

**Ví dụ đánh dấu slot hoàn thành:**
```bash
curl -X PATCH http://localhost:3000/api/trips/<TRIP_ID>/slots/<SLOT_ID> \
  -H "Authorization: Bearer <FIREBASE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}'
```

---

### Preference Service API (port 3001)

Tất cả endpoints (trừ `/health` và `/internal/*`) đều cần header:
```
x-user-id: <USER_ID>   # UUID từ bảng app_user
```

#### Survey
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/preferences/survey/status` | Kiểm tra đã làm survey chưa |
| POST | `/api/preferences/survey` | Lưu kết quả survey lần đầu |
| PATCH | `/api/preferences/survey` | Cập nhật sở thích |

#### Weights & Similarity
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/preferences/weights` | Lấy objective weights hiện tại (UCB1 bandit) |
| GET | `/api/preferences/similar-users` | Danh sách user có sở thích tương đồng |

#### Tương tác
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/preferences/favorite` | Thêm địa điểm vào yêu thích |
| DELETE | `/api/preferences/favorite/:placeId` | Xoá khỏi yêu thích |
| POST | `/api/preferences/rating` | Ghi nhận đánh giá địa điểm sau chuyến đi (rating 1–5) |

#### Internal (Backend → Preference Service)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/preferences/internal/reward` | Nhận event từ backend để cập nhật bandit + preference vector |

**Ví dụ survey:**
```bash
curl -X POST http://localhost:3001/api/preferences/survey \
  -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" \
  -d '{"primaryPurpose":"leisure","pace":0.6,"dailyScheduleType":"morning","budgetPerDayMin":200000,"budgetPerDayMax":800000,"groupType":"couple","preferredTagIds":[1,2,3],"foodPreferences":["local"],"mobilityRestrictions":[]}'
```

**Ví dụ đánh giá địa điểm:**
```bash
curl -X POST http://localhost:3001/api/preferences/rating \
  -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" \
  -d '{"placeId":1,"rating":5,"tripId":"<TRIP_ID>"}'
```

---

## 6. Chạy Tests

```bash
cd backend
npm test
# 100 tests pass
```

---

## 7. Cấu trúc thư mục

### Backend

```
backend/
├── src/
│   ├── server.ts              # Entry point Fastify
│   ├── lib/prisma.ts          # Prisma client singleton
│   ├── config/firebase.ts     # Firebase Admin SDK
│   ├── middlewares/           # Auth middleware (verifyToken)
│   ├── routes/                # auth, trips, places, landmark, nlu, monitor, internalEvents
│   ├── services/
│   │   └── nluService.ts      # Gọi Colab NLU qua COLAB_NLU_URL
│   ├── api/
│   │   ├── plan/              # Greedy planner + 2-opt optimizer
│   │   └── replan/            # BeamSearch replanner + accept/reject handlers
│   ├── replanner/             # Core replanning engine
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
│   ├── seed.ts
│   └── migrations/
└── firebase-service-account.json  # KHÔNG commit lên repo
```

### Frontend

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── Welcome.tsx        # Landing page
│   │   ├── Home.tsx           # Trang chủ sau đăng nhập
│   │   ├── Dashboard.tsx      # Dashboard chuyến đi
│   │   ├── PlanTrip.tsx       # Wizard lập lịch (bước 1)
│   │   ├── PlanDestinations.tsx # Chọn địa điểm (bước 2)
│   │   ├── PlanRoute.tsx      # Tối ưu & xác nhận lộ trình (bước 3)
│   │   │                      #   → OSRM routing, detour detection, multi-day,
│   │   │                      #     starting-point picker, rest-stop suggestions
│   │   ├── TripDetail.tsx     # Chi tiết trip (timeline + bản đồ)
│   │   ├── TripTracking.tsx   # Live tracking (slot hiện tại + replan)
│   │   ├── ReplanPage.tsx     # Xem và duyệt replan proposal
│   │   ├── Places.tsx         # Danh sách địa điểm
│   │   ├── Destinations.tsx   # Danh sách điểm đến
│   │   ├── Events.tsx         # Sự kiện du lịch
│   │   ├── About.tsx          # Giới thiệu hệ thống
│   │   ├── LandmarkPage.tsx   # Nhận diện địa danh qua camera/upload
│   │   ├── Preferences.tsx    # Cài đặt sở thích (survey)
│   │   └── Profile.tsx        # Trang cá nhân + đánh giá sau chuyến
│   ├── components/
│   │   ├── planning/          # NLPInput, PlanForm, FilterBar, ComparisonPanel,
│   │   │                      #   DestinationDetailPanel, PlaceOrderStep, NLPChat
│   │   ├── timeline/          # Timeline, SlotCard, DayGroup, ConflictBanner
│   │   ├── map/               # TripMap (Leaflet + OSRM polyline)
│   │   ├── places/            # PlaceCard, PlacePopup
│   │   ├── auth/              # LoginDrawer, ProtectedRoute
│   │   └── ui/                # Modal, Toast, Spinner, Button, Badge, Card
│   ├── services/              # API clients (axios):
│   │   ├── tripService.ts     #   Quản lý chuyến đi
│   │   ├── placeService.ts    #   CRUD địa điểm
│   │   ├── routingService.ts  #   OSRM driving route (external API)
│   │   ├── preferenceService.ts # Sở thích người dùng
│   │   ├── destinationService.ts # Điểm đến, gợi ý
│   │   ├── monitorService.ts  #   Giám sát sự cố
│   │   ├── landmarkService.ts #   Nhận diện địa danh
│   │   ├── nluService.ts      #   Phân tích ngôn ngữ tự nhiên
│   │   └── api.ts             #   Axios instance base
│   ├── store/                 # Zustand stores: authStore, tripStore, toastStore
│   ├── hooks/                 # React Query hooks: useFavorites, ...
│   ├── types/                 # TypeScript types chung
│   └── config/firebase.ts     # Firebase client config
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

### Preference Service

```
preference-service/
├── src/
│   ├── app.ts                 # Entry point Fastify
│   ├── lib/prisma.ts          # Prisma client singleton
│   ├── middleware/auth.ts     # requireAuth (kiểm tra x-user-id header)
│   ├── routes/
│   │   ├── survey.routes.ts   # /api/preferences/survey/*
│   │   ├── preferences.routes.ts  # /api/preferences/weights, /similar-users, /rating
│   │   ├── favorite.routes.ts # /api/preferences/favorite/*
│   │   └── internal.routes.ts # /api/preferences/internal/reward
│   ├── services/
│   │   ├── survey.service.ts  # CRUD survey + tính base weights
│   │   ├── weights.service.ts # UCB1 bandit — chọn arm + cập nhật reward
│   │   ├── interaction.service.ts  # Xử lý các loại interaction
│   │   └── learning.service.ts    # Incremental preference vector learning
│   └── jobs/
│       └── similarity.job.ts  # Cosine similarity job (chạy 03:00 mỗi đêm)
└── prisma/
    └── schema.prisma
```

---

## 8. Tính năng Tối ưu Lộ trình (PlanRoute)

Trang `PlanRoute.tsx` cung cấp bộ công cụ thông minh giúp người dùng tối ưu hóa lộ trình trước khi lưu:

### 8.1 Routing đường bộ thực tế (OSRM)
- Sử dụng [OSRM](https://project-osrm.org/) public API để tính khoảng cách và thời gian di chuyển thực tế giữa các điểm (không dùng đường chim bay).
- Tuyến đường hiển thị trên bản đồ bám sát đường bộ thật sự.
- Service: `frontend/src/services/routingService.ts`

> **Lưu ý:** OSRM public API có rate-limit. Nếu triển khai production, nên dùng OSRM self-hosted hoặc Google Maps / Mapbox.

### 8.2 Chọn điểm xuất phát
- Người dùng chọn điểm xuất phát từ dropdown **"Vị trí xuất phát của bạn"** hoặc nhấn icon cờ (🚩) trên từng thẻ địa điểm.
- Điểm xuất phát được hiển thị nổi bật với badge xanh lá `ĐIỂM XUẤT PHÁT`.

### 8.3 Phát hiện cặp điểm xung đột (Detour Detection)
- Hệ thống tự động phát hiện các **cặp điểm liền kề** cách nhau >20 phút di chuyển.
- Hiển thị 1 thẻ cảnh báo duy nhất cho mỗi cặp (không tách riêng từng điểm), cho phép:
  - **Bỏ điểm A** hoặc **Bỏ điểm B** — xóa 1 trong 2
  - **Giữ cả hai** — đánh dấu `mustVisit`, cảnh báo biến mất

### 8.4 Cảnh báo vượt thời gian & Hỗ trợ đa ngày
- Nếu tổng thời gian (tham quan + di chuyển) vượt quỹ thời gian trong ngày (12h × số ngày), hiện cảnh báo kèm 2 nút:
  - **"Kéo dài thành X ngày"** — hệ thống tự tính số ngày phù hợp
  - **"Bỏ 1 điểm ở cuối"** — giảm tải lộ trình
- Trường `Số ngày` trên form cho phép điều chỉnh tay.
- Khi lưu, `endDate` tự động tính theo `startDate + (tripDays - 1)`.

### 8.5 Gợi ý điểm dừng chân (Rest Stops)
- Khi có đoạn đường >15km giữa 2 điểm liền kề, hệ thống gợi ý bật AI.
- AI tìm điểm dừng chân ở giữa đoạn xa (bán kính 5km quanh midpoint), hiển thị kèm nút "Chèn vào giữa".

### 8.6 Đánh dấu bắt buộc đi (Must Visit)
- Icon ghim (📌) trên mỗi thẻ cho phép pin điểm là "bắt buộc".
- Điểm `mustVisit` không bị đề xuất xóa bởi detour detection.

### 8.7 Tối ưu thứ tự tự động
- Nút **"Tối ưu thứ tự"** dùng thuật toán nearest-neighbor TSP.
- Giữ nguyên điểm xuất phát, sắp xếp lại các điểm còn lại theo khoảng cách gần nhất.

### 8.8 Xem thông tin chi tiết địa điểm
- Click icon MapPin trên thẻ địa điểm → mở panel chi tiết bên phải.
- Hiển thị ảnh, rating, tags, giờ mở cửa (gộp thông minh, highlight ngày hôm nay), giá vé, mô tả.

---

## 9. Testing & Mocking (Chỉ dành cho Dev)

### 9.1 Giả lập sự cố ngoại cảnh (Test Replan)

```bash
curl -X POST http://localhost:3000/api/monitor/mock-incident \
  -H "Content-Type: application/json" \
  -d '{
    "type": "rain_heavy",
    "reason": "Mưa lớn giả lập để test Replan",
    "severity": 0.9,
    "affectedSlotIds": ["<SLOT_ID>"]
  }'
```

*Endpoint này chỉ hoạt động khi `NODE_ENV !== production`.*

### 9.2 Giả lập Nhận diện địa danh

Khi upload ảnh trong trang Landmark, hệ thống nhận diện dựa trên tên file:
- File chứa `cau.rong` → Cầu Rồng
- File chứa `ba.na` → Bà Nà Hills
- File chứa `my.khe` → Bãi biển Mỹ Khê

### 9.3 Seed dữ liệu fake để test

```bash
cd backend
npm run seed:fake
```

Tạo users, trips, slots và interaction logs mẫu để test UI mà không cần tự tạo tay.

---

## 10. Lưu ý quan trọng

- `firebase-service-account.json` chứa credentials thật — **không commit lên public repo**
- Database chạy trên port **5433** (không phải 5432 mặc định) để tránh xung đột với PostgreSQL cài local
- Preference service dùng Prisma **5.x**, backend dùng Prisma **7.x** — không hoán đổi schema/migration giữa hai service
- `lat`/`lng` trong bảng `place` là generated columns từ PostGIS — không INSERT trực tiếp, dùng `ST_GeogFromText` hoặc `ST_MakePoint`
- NLU service (`/api/nlu/parse`) phụ thuộc Colab đang chạy — nếu tunnel hết hạn, cập nhật `COLAB_NLU_URL` trong `backend/.env`
- Preference service nhận event từ backend qua HTTP POST (`/api/preferences/internal/reward`), không qua shared EventEmitter
- Khi chạy toàn bộ hệ thống cần **3 terminal riêng**: backend, preference-service, frontend
- OSRM routing dùng public demo server (`router.project-osrm.org`) — chỉ phù hợp cho dev/demo, không dùng cho production
- `PlanRoute.tsx` tính toán detour/overrun client-side dựa trên OSRM + haversine fallback — cần internet để OSRM hoạt động
