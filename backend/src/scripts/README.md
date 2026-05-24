# Backend Scripts

Scripts chạy trực tiếp bằng `ts-node`, không qua HTTP server. Dùng cho seeding, debug, và test thủ công trên production.

## Cách chạy (chung)

```bash
cd backend
DATABASE_URL="postgres://..." npx ts-node src/scripts/<tên-script>.ts
```

Với production (Render dùng self-signed TLS cert), thêm `NODE_TLS_REJECT_UNAUTHORIZED=0`:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 DATABASE_URL="postgres://..." npx ts-node src/scripts/<tên-script>.ts
```

---

## pump-rain-vietnam.ts

Bơm sự kiện `rain_heavy` vào **tất cả trip active/confirmed** trên hệ thống, bán kính 1500km phủ toàn Việt Nam. Dùng để test luồng replan khi có thời tiết xấu trên production mà không cần bật endpoint dev-only.

**Khi nào dùng:** Test replanning flow, demo tính năng thời tiết, kiểm tra frontend hiển thị incident.

```bash
cd backend
NODE_TLS_REJECT_UNAUTHORIZED=0 \
DATABASE_URL="postgres://user:pass@host:5433/dbname?sslmode=require" \
npx ts-node src/scripts/pump-rain-vietnam.ts
```

**Tham số cứng trong file (chỉnh nếu cần):**

| Biến | Giá trị mặc định | Ý nghĩa |
|------|-----------------|---------|
| `ANCHOR_LAT/LON` | 16.5, 107.0 | Tâm vùng mưa (Quảng Trị) |
| `RADIUS_KM` | 1500 | Phủ toàn quốc |
| `DURATION_HOURS` | 24 | Thời gian event tồn tại |
| `SEVERITY` | 0.9 | Mức độ nghiêm trọng (0–1) |

**Guard:** Không tạo trùng nếu trip đã có event `rain_heavy` open hoặc đã dismissed/resolved trong 6h gần nhất.

**Kiểm tra kết quả:** Sau khi chạy, frontend gọi `GET /api/monitor/check-incident?tripId=<id>` sẽ trả về event và trigger replan flow.

---

## seed.ts

Seed dev user vào DB.

```bash
cd backend && npm run seed
```

## seed-places.ts

Seed 94 địa danh Đà Nẵng vào bảng `place`.

```bash
cd backend && npm run seed:places
```

## seed-fake.ts

Seed mock trips, slots, và interaction data để test.

```bash
cd backend && npm run seed:fake
```

## backfill-embeddings.ts

Tạo vector embedding cho tất cả place chưa có (dùng cho semantic search).

```bash
cd backend && npm run backfill:embeddings
```

## revert-trip.ts / revert-to-v5.ts

Revert trip về version cũ hơn. Dùng khi cần rollback dữ liệu trip cụ thể sau khi test.

```bash
cd backend
DATABASE_URL="..." npx ts-node src/scripts/revert-trip.ts
```

## check-trip-events.ts

Xem tất cả `trip_event` trong DB, hữu ích để xác nhận pump-rain đã tạo event thành công.

```bash
cd backend
DATABASE_URL="..." npx ts-node src/scripts/check-trip-events.ts
```
