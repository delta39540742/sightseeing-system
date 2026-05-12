-- Add soft-delete support to trip table
ALTER TABLE trip ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trip_deleted ON trip (user_id, deleted_at) WHERE deleted_at IS NOT NULL;
