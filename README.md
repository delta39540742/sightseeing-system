# ✈️ TravelSystem – Hệ thống Gợi ý Du lịch Thông minh

Hệ thống lập kế hoạch & tái lập kế hoạch du lịch tự động, sử dụng **Beam Search**, **Multi-Armed Bandit**, và **Semantic Embedding** để đề xuất lịch trình tối ưu cho người dùng.

---

## 📑 Mục lục

1. [Kiến trúc tổng quan](#-kiến-trúc-tổng-quan)
2. [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
3. [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống)
4. [Cài đặt & Chạy dự án](#-cài-đặt--chạy-dự-án)
   - [Bước 1 – Clone repository](#bước-1--clone-repository)
   - [Bước 2 – Khởi động Database (Docker)](#bước-2--khởi-động-database-docker)
   - [Bước 3 – Cài đặt Backend](#bước-3--cài-đặt-backend)
   - [Bước 4 – Cài đặt Frontend](#bước-4--cài-đặt-frontend)
   - [Bước 5 – Cài đặt Preference Service (tuỳ chọn)](#bước-5--cài-đặt-preference-service-tuỳ-chọn)
5. [Chạy dự án](#-chạy-dự-án)
6. [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
7. [API Endpoints chính](#-api-endpoints-chính)
8. [Chạy Tests](#-chạy-tests)
9. [Các lệnh hữu ích](#-các-lệnh-hữu-ích)
10. [Xử lý lỗi thường gặp](#-xử-lý-lỗi-thường-gặp)

---

## 🏗 Kiến trúc tổng quan

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────────────┐
│   Frontend   │────▶│     Backend      │────▶│  PostgreSQL 15               │
│  (Vite+React)│     │   (Fastify)      │     │  + PostGIS 3.3 + pgvector    │
│  port: 5173  │     │   port: 3000     │     │  port: 5433                  │
└──────────────┘     └──────────────────┘     └──────────────────────────────┘
                            │
                            ▼
                     ┌──────────────────┐
                     │Preference Service│  (tuỳ chọn)
                     │  (Fastify)       │
                     │  port: 3001      │
                     └──────────────────┘
```

- **Frontend** gọi API qua Vite proxy (`/api` → `localhost:3000`, `/pref` → `localhost:3001`).
- **Backend** xử lý logic lập kế hoạch, replanning (Beam Search), xác thực Firebase Auth.
- **Database** sử dụng PostgreSQL + PostGIS (dữ liệu địa lý) + pgvector (semantic search).

---

## 🛠 Công nghệ sử dụng

### Backend (`backend/`)

| Công nghệ                | Phiên bản  | Mục đích                                         |
| ------------------------- | ---------- | ------------------------------------------------ |
| **Node.js**               | ≥ 18       | Runtime                                          |
| **TypeScript**            | ^6.0       | Ngôn ngữ chính                                   |
| **Fastify**               | ^5.8       | HTTP framework (thay thế Express, hiệu năng cao) |
| **Prisma ORM**            | ^7.7       | ORM & migration cho PostgreSQL                   |
| **PostgreSQL**            | 15         | Cơ sở dữ liệu quan hệ                           |
| **PostGIS**               | 3.3        | Extension GIS (truy vấn không gian, khoảng cách) |
| **pgvector**              | —          | Extension vector embedding (semantic search)     |
| **Firebase Admin SDK**    | ^13.8      | Xác thực người dùng (server-side)                |
| **@xenova/transformers**  | ^2.17      | Chạy mô hình embedding (all-MiniLM-L6-v2)       |
| **node-cron**             | ^4.2       | Lập lịch tác vụ nền                              |
| **Axios**                 | ^1.15      | HTTP client (gọi API thời tiết, NLU)             |
| **pg**                    | ^8.20      | PostgreSQL driver (dùng với Prisma adapter)      |
| **Vitest**                | ^3.2       | Unit testing                                     |
| **nodemon**               | ^3.1       | Hot-reload khi dev                               |

### Frontend (`frontend/`)

| Công nghệ                | Phiên bản  | Mục đích                                       |
| ------------------------- | ---------- | ---------------------------------------------- |
| **React**                 | ^18.3      | UI library                                     |
| **TypeScript**            | ^5.5       | Ngôn ngữ chính                                 |
| **Vite**                  | ^5.4       | Build tool & dev server                        |
| **TailwindCSS**           | ^3.4       | Utility-first CSS framework                    |
| **React Router DOM**      | ^6.26      | Client-side routing                            |
| **TanStack React Query**  | ^5.56      | Server-state management & caching              |
| **Zustand**               | ^5.0       | Client-state management (nhẹ hơn Redux)        |
| **Leaflet + React-Leaflet** | ^1.9 / ^4.2 | Bản đồ tương tác                            |
| **Firebase (Web SDK)**    | ^10.12     | Xác thực người dùng (client-side)              |
| **Lucide React**          | ^0.441     | Icon library                                   |
| **@dnd-kit**              | ^6.1       | Drag & Drop (kéo thả sắp xếp lịch trình)      |
| **date-fns**              | ^3.6       | Xử lý ngày tháng                               |
| **react-hook-form**       | ^7.53      | Quản lý form                                   |
| **qrcode.react**          | ^4.1       | Tạo mã QR cho trip                             |

### Preference Service (`preference-service/`) — Tuỳ chọn

| Công nghệ         | Phiên bản | Mục đích                             |
| ------------------ | --------- | ------------------------------------ |
| **Fastify**        | ^5.8      | HTTP framework                       |
| **Prisma**         | ^5.14     | ORM                                  |
| **node-cron**      | ^3.0      | Lập lịch tính toán recommendation    |
| **ts-node-dev**    | ^2.0      | Hot-reload khi dev                   |

### Hạ tầng

| Công nghệ          | Mục đích                                     |
| ------------------- | -------------------------------------------- |
| **Docker Compose**  | Containerize PostgreSQL + PostGIS + pgvector  |
| **Firebase**        | Authentication (Google Sign-In, Email/Pass)   |

---

## 📋 Yêu cầu hệ thống

Trước khi bắt đầu, hãy đảm bảo máy bạn đã cài:

| Phần mềm           | Phiên bản tối thiểu | Kiểm tra bằng lệnh          |
| ------------------- | -------------------- | ---------------------------- |
| **Node.js**         | 18.x                 | `node -v`                    |
| **npm**             | 9.x                  | `npm -v`                     |
| **Docker Desktop**  | 4.x                  | `docker --version`           |
| **Docker Compose**  | 2.x (bundled)        | `docker compose version`     |
| **Git**             | 2.x                  | `git --version`              |

> **💡 Ghi chú:** Docker Desktop trên Windows/macOS đã bao gồm Docker Compose v2. Không cần cài riêng `docker-compose`.

---

## 🚀 Cài đặt & Chạy dự án

### Bước 1 – Clone repository

```bash
git clone https://github.com/<your-username>/TravelSystem.git
cd TravelSystem
```

---

### Bước 2 – Khởi động Database (Docker)

Dự án sử dụng PostgreSQL 15 + PostGIS + pgvector chạy trong Docker container.

```bash
cd backend
docker compose up -d
```

> **Chờ khoảng 30-60 giây** để container build image (lần đầu) và PostgreSQL sẵn sàng.

**Kiểm tra database đã hoạt động:**

```bash
docker compose ps
```

Bạn sẽ thấy container `postgres` ở trạng thái **running**. Database sẽ nghe trên **port 5433** (host) → 5432 (container).

**Thông tin kết nối mặc định:**

| Thuộc tính   | Giá trị          |
| ------------ | ---------------- |
| Host         | `localhost`      |
| Port         | `5433`           |
| User         | `tdtt_user`      |
| Password     | `tdtt_password`  |
| Database     | `tdtt_db`        |

> **⚠️ Lưu ý:** Nếu port `5433` đã bị chiếm, hãy sửa mapping port trong `backend/docker-compose.yml` (dòng `ports`).

---

### Bước 3 – Cài đặt Backend

#### 3.1. Cài dependencies

```bash
# Đảm bảo đang ở thư mục backend/
cd backend
npm install
```

#### 3.2. Tạo file `.env`

Sao chép file mẫu và điền giá trị:

```bash
cp .env.example .env
```

Mở file `backend/.env` và cập nhật:

```env
# ── Database ──────────────────────────────────────
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
DB_USER=tdtt_user
DB_PASSWORD=tdtt_password
DB_HOST=localhost
DB_PORT=5433
DB_NAME=tdtt_db

# ── Port backend ──────────────────────────────────
PORT=3000

# ── NLU Service (Colab) ──────────────────────────
# Nếu chưa có, để trống — tính năng NLU sẽ không hoạt động
COLAB_NLU_URL=

# ── Firebase Admin SDK ────────────────────────────
# Lấy từ Firebase Console → Project Settings → Service accounts → Generate new private key
FIREBASE_PROJECT_ID=<YOUR_PROJECT_ID>
FIREBASE_PRIVATE_KEY_ID=<YOUR_PRIVATE_KEY_ID>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=<YOUR_CLIENT_EMAIL>
FIREBASE_CLIENT_ID=<YOUR_CLIENT_ID>

# ── OpenWeather API (tuỳ chọn) ───────────────────
# Đăng ký miễn phí tại https://openweathermap.org/api
OPENWEATHER_API_KEY=<YOUR_API_KEY>

# ── Environment ──────────────────────────────────
NODE_ENV=development
```

> **🔑 Hướng dẫn lấy Firebase Service Account:**
> 1. Truy cập [Firebase Console](https://console.firebase.google.com/)
> 2. Chọn project của bạn (hoặc tạo mới)
> 3. Vào **Project Settings** (⚙️) → **Service accounts**
> 4. Click **Generate new private key** → Tải file JSON
> 5. Lấy các giá trị `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id` từ file JSON đó điền vào `.env`

#### 3.3. Tạo Prisma Client & chạy Migration

```bash
# Generate Prisma Client (tạo type-safe query builder)
npx prisma generate

# Chạy migration để tạo bảng trong database
npx prisma migrate deploy
```

> **💡 Nếu bạn muốn đồng bộ schema mà không cần migration files (dev nhanh):**
> ```bash
> npx prisma db push
> ```

#### 3.4. Seed dữ liệu mẫu (tuỳ chọn)

```bash
# Seed user mẫu cơ bản
npm run seed

# Seed dữ liệu địa điểm (places)
npm run seed:places

# Seed dữ liệu giả lập đầy đủ (trips, slots, events...)
npm run seed:fake

# Backfill vector embeddings cho các địa điểm (semantic search)
npm run backfill:embeddings
```

---

### Bước 4 – Cài đặt Frontend

#### 4.1. Cài dependencies

```bash
# Quay lại thư mục gốc rồi vào frontend
cd ../frontend
npm install
```

#### 4.2. Tạo file `.env`

```bash
cp .env.example .env
```

Mở file `frontend/.env` và cập nhật:

```env
# Firebase Web Client (Vite — tất cả biến phải có prefix VITE_)
# Lấy từ Firebase Console → Project Settings → Your apps → Web app → SDK setup
VITE_FIREBASE_API_KEY=<YOUR_API_KEY>
VITE_FIREBASE_AUTH_DOMAIN=<YOUR_PROJECT_ID>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<YOUR_PROJECT_ID>
VITE_FIREBASE_STORAGE_BUCKET=<YOUR_PROJECT_ID>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<YOUR_MESSAGING_SENDER_ID>
VITE_FIREBASE_APP_ID=<YOUR_APP_ID>
```

> **🔑 Hướng dẫn lấy Firebase Web Config:**
> 1. Truy cập [Firebase Console](https://console.firebase.google.com/)
> 2. Chọn project → **Project Settings** (⚙️)
> 3. Kéo xuống phần **Your apps** → Nếu chưa có Web app, click **Add app** → chọn Web (</>) 
> 4. Đặt tên app → **Register app**
> 5. Copy các giá trị `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` vào file `.env`

> **⚠️ Quan trọng:** Đảm bảo Firebase project đã bật **Authentication** với các phương thức đăng nhập cần thiết (Email/Password, Google).

---

### Bước 5 – Cài đặt Preference Service (tuỳ chọn)

Service này cung cấp tính năng recommendation engine. Nếu không cần, bạn có thể bỏ qua bước này.

```bash
cd ../preference-service
npm install
cp .env.example .env
```

Chỉnh sửa `preference-service/.env`:

```env
DATABASE_URL="postgresql://tdtt_user:tdtt_password@localhost:5433/tdtt_db"
PORT=3001
NODE_ENV=development
```

Tạo Prisma Client:

```bash
npx prisma generate
```

---

## 🏃 Chạy dự án

Mở **3 terminal riêng biệt** (hoặc dùng split terminal trong VS Code):

### Terminal 1 – Database (nếu chưa chạy)

```bash
cd backend
docker compose up -d
```

### Terminal 2 – Backend

```bash
cd backend
npm run dev
```

Bạn sẽ thấy log:

```
▶  TDTT Backend  http://localhost:3000
   /health  /api/trips  /api/plan/generate  ...
```

### Terminal 3 – Frontend

```bash
cd frontend
npm run dev
```

Bạn sẽ thấy log:

```
  VITE v5.4.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

### Terminal 4 – Preference Service (tuỳ chọn)

```bash
cd preference-service
npm run dev
```

---

**🎉 Mở trình duyệt truy cập: [http://localhost:5173](http://localhost:5173)**

---

## 📁 Cấu trúc thư mục

```
TravelSystem/
├── backend/                    # API Server (Fastify + TypeScript)
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema definition
│   │   ├── migrations/         # SQL migration files
│   │   └── seed.ts             # Seed script cơ bản
│   ├── src/
│   │   ├── server.ts           # Entry point — khởi tạo Fastify server
│   │   ├── api/                # API route handlers (plan, replan, demo)
│   │   ├── routes/             # Route plugins (places, trips, auth, nlu...)
│   │   ├── replanner/          # Engine replanning (BeamSearch, MutationOps...)
│   │   ├── services/           # Business logic (embedding, weather...)
│   │   ├── middlewares/        # Auth middleware, validation
│   │   ├── lib/                # Prisma client, shared utilities
│   │   ├── config/             # App configuration
│   │   ├── events/             # Internal event bus
│   │   ├── scripts/            # Data seeding scripts
│   │   └── types/              # TypeScript type definitions
│   ├── __tests__/              # Unit tests (Vitest)
│   ├── scripts/                # Data fetching & transformation scripts
│   ├── docker-compose.yml      # PostgreSQL + PostGIS + pgvector
│   ├── Dockerfile.postgres     # Custom Postgres image (PostGIS + pgvector)
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── frontend/                   # Web Client (React + Vite)
│   ├── src/
│   │   ├── main.tsx            # Entry point — ReactDOM.createRoot
│   │   ├── App.tsx             # Root component + routing
│   │   ├── pages/              # Page components (Home, Dashboard, TripDetail...)
│   │   ├── components/         # Reusable UI components
│   │   ├── hooks/              # Custom React hooks
│   │   ├── services/           # API client (axios)
│   │   ├── store/              # Zustand stores (auth, toast...)
│   │   ├── config/             # Firebase config
│   │   ├── types/              # TypeScript types
│   │   └── utils/              # Utility functions
│   ├── index.html              # HTML entry point
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── preference-service/         # Recommendation Engine (tuỳ chọn)
│   ├── src/
│   │   ├── app.ts              # Entry point
│   │   ├── routes/             # API routes
│   │   ├── services/           # Recommendation logic
│   │   ├── jobs/               # Cron jobs
│   │   └── lib/                # Prisma client
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
│
├── scripts/                    # Data collection scripts (OSM, amenities)
├── docker-compose.yml          # Docker Compose gốc (legacy)
└── README.md                   # 📖 File này
```

---

## 🌐 API Endpoints chính

Sau khi backend chạy, bạn có thể kiểm tra tại `http://localhost:3000`:

| Method | Endpoint                              | Mô tả                                 |
| ------ | ------------------------------------- | -------------------------------------- |
| GET    | `/health`                             | Kiểm tra server hoạt động             |
| GET    | `/api/places`                         | Danh sách địa điểm                    |
| GET    | `/api/trips`                          | Danh sách chuyến đi của user          |
| POST   | `/api/plan/generate`                  | Tạo lịch trình du lịch mới            |
| GET    | `/api/trips/:tripId`                  | Chi tiết một chuyến đi                |
| POST   | `/api/trips/:tripId/replan/trigger`   | Kích hoạt replanning                  |
| GET    | `/api/trips/:tripId/replan/pending`   | Xem đề xuất replan đang chờ           |
| POST   | `/api/auth/verify`                    | Xác thực Firebase token               |
| POST   | `/api/nlu/parse`                      | Phân tích câu lệnh tự nhiên (NLU)     |
| GET    | `/api/landmark`                       | Nhận diện địa danh                     |
| GET    | `/api/monitor/*`                      | Giám sát hệ thống                     |

---

## 🧪 Chạy Tests

```bash
cd backend

# Chạy tất cả tests một lần
npm test

# Chạy tests ở chế độ watch (tự chạy lại khi code thay đổi)
npm run test:watch
```

---

## 📌 Các lệnh hữu ích

### Database

```bash
# Khởi động PostgreSQL container
cd backend && docker compose up -d

# Dừng PostgreSQL container
cd backend && docker compose down

# Dừng + xoá toàn bộ dữ liệu (volume)
cd backend && docker compose down -v

# Mở Prisma Studio (GUI quản lý database trên trình duyệt)
cd backend && npx prisma studio

# Tạo migration mới sau khi sửa schema.prisma
cd backend && npx prisma migrate dev --name <tên_migration>

# Reset database (xoá tất cả + chạy lại migration + seed)
cd backend && npx prisma migrate reset
```

### Build production

```bash
# Build backend
cd backend && npm run build
# Chạy production
cd backend && npm start

# Build frontend
cd frontend && npm run build
# Preview production build
cd frontend && npm run preview
```

---

## ❗ Xử lý lỗi thường gặp

### 1. Lỗi `ECONNREFUSED` khi backend kết nối database

**Nguyên nhân:** Docker container chưa chạy hoặc chưa sẵn sàng.

```bash
# Kiểm tra container
cd backend && docker compose ps

# Nếu không chạy, khởi động lại
docker compose up -d

# Xem log container
docker compose logs postgres
```

### 2. Lỗi `P1001: Can't reach database server`

**Nguyên nhân:** Port 5433 bị chiếm hoặc DATABASE_URL sai.

```bash
# Kiểm tra port 5433
# Windows:
netstat -ano | findstr :5433
# macOS/Linux:
lsof -i :5433
```

Nếu port bị chiếm, sửa port trong `backend/docker-compose.yml` và `backend/.env`.

### 3. Lỗi `prisma generate` hoặc `Cannot find module '.prisma/client'`

```bash
cd backend
npx prisma generate
```

### 4. Lỗi `firebase-admin` — thiếu credentials

Đảm bảo `backend/.env` có đầy đủ các biến `FIREBASE_*`. Nếu chỉ muốn dev nhanh không cần auth, có thể comment các route liên quan đến auth.

### 5. Lỗi `VITE_FIREBASE_*` undefined trên frontend

Đảm bảo:
- File `frontend/.env` tồn tại (không bị `.gitignore` ignore nhầm)
- Tất cả biến đều có prefix `VITE_`
- **Restart** Vite dev server sau khi sửa `.env` (biến env chỉ được đọc khi Vite khởi động)

### 6. Docker build image quá lâu (lần đầu)

Lần đầu Docker sẽ build custom image `tdtt-postgres-pgvector:15-3.3` (cài PostGIS + pgvector). Quá trình này tải packages từ internet, có thể mất **3-5 phút**. Các lần sau sẽ dùng cache nên rất nhanh.

### 7. Lỗi `@xenova/transformers` tải model chậm

Lần chạy đầu tiên, backend sẽ tải mô hình embedding `all-MiniLM-L6-v2` (~80MB). Quá trình này diễn ra ở background và sẽ log thông báo. Request đầu tiên liên quan đến semantic search có thể chậm ~30 giây.

---

## 📄 License

ISC

---

> **Cần hỗ trợ?** Tạo Issue trên GitHub hoặc liên hệ team phát triển.
