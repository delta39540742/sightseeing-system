import 'dotenv/config';
import { pool } from '../lib/prisma';
import { embedTexts, vectorToSqlLiteral, EMBEDDING_DIM } from '../services/embeddingService';

// Backfill description_embedding cho tất cả place.
// Usage:
//   npm run backfill:embeddings        -> chỉ embed các place chưa có
//   npm run backfill:embeddings -- --force  -> embed lại tất cả

const BATCH_SIZE = 16;

interface PlaceRow {
  place_id: string; // BigInt as string từ pg
  name: string;
  description: string | null;
  tag_names: string[] | null;
}

function composeText(p: PlaceRow): string {
  const parts: string[] = [p.name];
  if (p.description) parts.push(p.description);
  if (p.tag_names && p.tag_names.length > 0) parts.push(p.tag_names.join(', '));
  return parts.join('. ');
}

async function main() {
  const force = process.argv.includes('--force');
  console.log(`[backfill] mode=${force ? 'force (re-embed all)' : 'incremental (chỉ NULL)'}`);

  const whereClause = force ? '' : 'WHERE p.description_embedding IS NULL';
  const { rows } = await pool.query<PlaceRow>(`
    SELECT
      p.place_id::text AS place_id,
      p.name,
      p.description,
      COALESCE(
        ARRAY_AGG(pt.display_name) FILTER (WHERE pt.display_name IS NOT NULL),
        '{}'
      ) AS tag_names
    FROM place p
    LEFT JOIN place_tag_map ptm ON ptm.place_id = p.place_id
    LEFT JOIN place_tag pt ON pt.tag_id = ptm.tag_id
    ${whereClause}
    GROUP BY p.place_id
    ORDER BY p.place_id
  `);

  if (rows.length === 0) {
    console.log('[backfill] không có place nào cần embed.');
    await pool.end();
    return;
  }

  console.log(`[backfill] sẽ embed ${rows.length} place, batch=${BATCH_SIZE}, dim=${EMBEDDING_DIM}`);
  const t0 = Date.now();
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(composeText);
    const vectors = await embedTexts(texts);

    // UPDATE từng row trong 1 transaction nhỏ — pgvector không hỗ trợ COPY,
    // và batch UPDATE bằng UNNEST + cast vector phức tạp; vòng lặp đơn giản đủ nhanh.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let j = 0; j < batch.length; j++) {
        await client.query(
          `UPDATE place SET description_embedding = $1::vector WHERE place_id = $2::bigint`,
          [vectorToSqlLiteral(vectors[j]), batch[j].place_id],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    done += batch.length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`\r[backfill] ${done}/${rows.length} (${elapsed}s)`);
  }

  console.log(`\n[backfill] xong sau ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
