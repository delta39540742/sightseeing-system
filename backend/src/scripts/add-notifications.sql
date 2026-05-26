-- Thêm bảng notification để lưu lịch sử thông báo per-user
-- Cách chạy:
--   psql -h localhost -p 5433 -U <user> -d <db> -f backend/src/scripts/add-notifications.sql
-- Hoặc sau khi đã cập nhật schema.prisma:
--   cd backend && npx prisma db push

CREATE TABLE IF NOT EXISTS notification (
  notification_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  trip_id         UUID,
  type            TEXT         NOT NULL,
  title           TEXT         NOT NULL,
  message         TEXT         NOT NULL,
  data            JSONB,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_user
  ON notification (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_unread
  ON notification (user_id, read_at)
  WHERE read_at IS NULL;
