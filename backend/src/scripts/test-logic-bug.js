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

async function runLogicTest(name, q, city) {
  console.log(`\n========================================================`);
  console.log(`🕵️ [LOGIC TEST]: ${name}`);
  console.log(`   - Từ khóa (q) : "${q}"`);
  console.log(`   - Bộ lọc tỉnh : "${city || 'Không'}"`);
  console.log(`--------------------------------------------------------`);

  const sanitize = (str) => (str || '').replace(/[%_\\]/g, '\\$&');
  q = sanitize(q);
  city = sanitize(city);

  const limit = 5;
  const skip = 0;

  try {
    let rows;
    if (city) {
      rows = await prisma.$queryRaw`
        SELECT p.place_id, p.name, p.province, p.address, p.popularity_score,
               GREATEST(
                 word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                 CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                 CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
               ) as sim_score
        FROM place p
        WHERE (
          ${q} = '' OR
          unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
        )
        AND (
          unaccent(lower(p.province))   LIKE '%' || unaccent(lower(${city})) || '%'
          OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${city})) || '%'
        )
        ORDER BY
          GREATEST(
            word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
            CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
            CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
          ) DESC,
          p.popularity_score DESC
        LIMIT ${limit} OFFSET ${skip}
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT p.place_id, p.name, p.province, p.address, p.popularity_score,
               GREATEST(
                 word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
                 CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
                 CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
               ) as sim_score
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
        LIMIT ${limit} OFFSET ${skip}
      `;
    }

    if (rows.length === 0) {
      console.log("   (Không có kết quả nào)");
    } else {
      rows.forEach((r, idx) => {
        console.log(`   ${idx + 1}. Tên: ${r.name}`);
        console.log(`      Tỉnh: ${r.province} | Sim_Score: ${Number(r.sim_score||0).toFixed(2)} | Độ phổ biến: ${Number(r.popularity_score||0).toFixed(2)}`);
      });
    }
    return rows;
  } catch (err) {
    console.log(`   ❌ DATABASE CRASH! Chi tiết: ${err.message.split('\n')[0]}`);
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST ĐỂ TÌM LỖI LOGIC Ở CẤP ĐỘ Ý ĐỊNH NGƯỜI DÙNG (INTENT LOGIC)...\n");

  // Tạo dữ liệu mồi để khai thác lỗ hổng "Đánh cắp ý định địa lý" (Geographical Name Stealing)
  console.log("-> Bơm 1 dữ liệu mồi: Một quán kem nhỏ ở Hà Nội tên là 'Kem Bơ Đà Lạt' (Popularity rất thấp: 0.1)");
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor, popularity_score)
    VALUES ('Quán Kem Bơ Đà Lạt', 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'indoor', 0.1)
  `;

  console.log("-> Bơm 1 dữ liệu mồi: Một địa điểm cực kỳ nổi tiếng ở Đà Lạt nhưng tên KHÔNG có chữ 'Đà Lạt' (Popularity: 0.99)");
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor, popularity_score)
    VALUES ('Thung Lũng Tình Yêu Vĩnh Cửu', 'Lâm Đồng', 'Đà Lạt, Lâm Đồng', '', ST_MakePoint(108, 11)::geography, 'unknown', 120, 'outdoor', 0.99)
  `;

  // Test 1: Lỗ hổng Ý định Địa lý
  // Người dùng gõ "Đà Lạt" vào ô tìm kiếm tự do (không chọn filter city).
  // Ý định: Xem các danh lam thắng cảnh ở Đà Lạt.
  // Kết quả kỳ vọng của người dùng: Ra Thung Lũng Tình Yêu (Lâm Đồng - Đà Lạt) trước.
  await runLogicTest("Lỗ hổng Ý định Địa lý (Geographical Name Stealing)", "Đà Lạt", "");

  // Dọn dẹp mồi
  await prisma.$executeRaw`DELETE FROM place WHERE name = 'Quán Kem Bơ Đà Lạt'`;
  await prisma.$executeRaw`DELETE FROM place WHERE name = 'Thung Lũng Tình Yêu Vĩnh Cửu'`;
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
