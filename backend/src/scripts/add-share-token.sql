-- Thêm cột share_token + share_expires_at cho bảng trip
-- Cách chạy:
--   psql -h localhost -p 5433 -U <user> -d <db> -f backend/src/scripts/add-share-token.sql
-- Hoặc sau khi đã cập nhật schema.prisma:
--   cd backend && npx prisma db push

ALTER TABLE trip
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS trip_share_token_key
  ON trip (share_token)
  WHERE share_token IS NOT NULL;
