require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const rawUrl = process.env.DATABASE_URL ?? '';
const pool = new pg.Pool({ 
  connectionString: rawUrl.replace(/[?&]sslmode=\w+/g, ''),
  ssl: rawUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined 
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function runPaginationTest() {
  console.log(`\n========================================================`);
  console.log(`🌀 [PAGINATION LOGIC TEST]: Lỗ hổng Trùng lặp Trang (Unstable Pagination Bug)`);
  console.log(`--------------------------------------------------------`);
  
  const q = "Tiệm Trà Đá";
  const city = "";
  
  // Lấy Trang 1 (Limit 3, Skip 0)
  const page1 = await prisma.$queryRaw`
    SELECT p.place_id, p.name, p.popularity_score,
           GREATEST(
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
             CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
             CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
           ) as final_score
    FROM place p
    WHERE
      unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
    ORDER BY
      GREATEST(
        word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
        CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
        CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
      ) DESC,
      p.popularity_score DESC
    LIMIT 3 OFFSET 0
  `;

  // Lấy Trang 2 (Limit 3, Skip 3)
  const page2 = await prisma.$queryRaw`
    SELECT p.place_id, p.name, p.popularity_score,
           GREATEST(
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
             CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
             CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
           ) as final_score
    FROM place p
    WHERE
      unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
      OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
    ORDER BY
      GREATEST(
        word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
        CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
        CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
      ) DESC,
      p.popularity_score DESC
    LIMIT 3 OFFSET 3
  `;

  console.log("=> KẾT QUẢ TRANG 1:");
  page1.forEach((r, i) => console.log(`   ${i+1}. [ID: ${r.place_id}] ${r.name} (Score: ${Number(r.final_score).toFixed(2)} - Pop: ${Number(r.popularity_score).toFixed(2)})`));

  console.log("\n=> KẾT QUẢ TRANG 2:");
  page2.forEach((r, i) => console.log(`   ${i+1}. [ID: ${r.place_id}] ${r.name} (Score: ${Number(r.final_score).toFixed(2)} - Pop: ${Number(r.popularity_score).toFixed(2)})`));

  // Kiểm tra trùng lặp ID giữa 2 trang
  const idsPage1 = page1.map(p => p.place_id);
  const duplicates = page2.filter(p => idsPage1.includes(p.place_id));

  if (duplicates.length > 0) {
    console.log(`\n❌ LỖI LOGIC: Có ${duplicates.length} địa điểm bị trùng lặp hiển thị ở cả Trang 1 và Trang 2!`);
    console.log(`   Lý do: PostgreSQL không đảm bảo thứ tự các row nếu 'final_score' và 'popularity_score' bằng nhau (Non-deterministic sorting).`);
  } else {
    console.log(`\n✅ Trùng hợp là không có lỗi trùng lặp (hoặc dữ liệu mồi chưa đủ lớn để bộc lộ lỗi Non-deterministic sorting). Nhưng về mặt lý thuyết SQL, việc thiếu Tie-breaker chắc chắn sẽ sinh ra lỗi này trên production!`);
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST KIỂM TRA TÍNH ỔN ĐỊNH CỦA PHÂN TRANG (PAGINATION STABILITY)...\n");

  // Bơm 5 địa điểm giống hệt nhau về cả độ tương đồng lẫn độ phổ biến
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor, popularity_score)
    VALUES 
    ('Tiệm Trà Đá A', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'outdoor', 0.5),
    ('Tiệm Trà Đá B', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'outdoor', 0.5),
    ('Tiệm Trà Đá C', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'outdoor', 0.5),
    ('Tiệm Trà Đá D', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'outdoor', 0.5),
    ('Tiệm Trà Đá E', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'outdoor', 0.5)
  `;

  await runPaginationTest();

  // Dọn dẹp
  await prisma.$executeRaw`DELETE FROM place WHERE name LIKE 'Tiệm Trà Đá%'`;
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
