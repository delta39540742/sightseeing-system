-- Enable pgvector. Image postgis-pgvector đã có binary; chỉ cần CREATE EXTENSION.
CREATE EXTENSION IF NOT EXISTS vector;

-- Cột embedding cho mô tả + tags. 384 chiều khớp model
-- Xenova/paraphrase-multilingual-MiniLM-L12-v2.
ALTER TABLE place ADD COLUMN IF NOT EXISTS description_embedding vector(384);

-- HNSW index cho ANN search bằng cosine. m + ef_construction để default (16/64).
-- Index chỉ build cho các row đã có embedding (NOT NULL) để tiết kiệm khi backfill chưa xong.
CREATE INDEX IF NOT EXISTS idx_place_embedding_hnsw
  ON place USING hnsw (description_embedding vector_cosine_ops)
  WHERE description_embedding IS NOT NULL;
