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

async function runExtremeTestCase(name, q, city) {
  console.log(`\n========================================================`);
  console.log(`🔥 [EXTREME TEST]: ${name}`);
  console.log(`   - Query (q) : "${q}"`);
  console.log(`   - City      : "${city || 'Không'}"`);
  console.log(`--------------------------------------------------------`);

  const sanitize = (str) => (str || '').replace(/[%_\\]/g, '\\$&');
  q = sanitize(q);
  city = sanitize(city);

  const limit = 5;
  const skip = 0;

  try {
    let rows;
    const startTime = Date.now();
    if (city) {
      rows = await prisma.$queryRaw`
        SELECT p.place_id, p.name, p.province, p.address, p.description, p.popularity_score
        FROM place p
        WHERE (
          unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
        )
        AND (
          unaccent(lower(p.province))     LIKE '%' || unaccent(lower(${city})) || '%'
          OR unaccent(lower(p.address))   LIKE '%' || unaccent(lower(${city})) || '%'
          OR unaccent(lower(p.name))      LIKE '%' || unaccent(lower(${city})) || '%'
          OR unaccent(lower(COALESCE(p.description, ''))) LIKE '%' || unaccent(lower(${city})) || '%'
        )
        ORDER BY
          word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) DESC,
          p.popularity_score DESC
        LIMIT ${limit} OFFSET ${skip}
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT p.place_id, p.name, p.province, p.address, p.description, p.popularity_score
        FROM place p
        WHERE
          unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
          OR word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) > 0.25
        ORDER BY
          word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) DESC,
          p.popularity_score DESC
        LIMIT ${limit} OFFSET ${skip}
      `;
    }
    const duration = Date.now() - startTime;

    console.log(`   ⏱️ Thời gian phản hồi: ${duration}ms`);
    
    if (rows.length === 0) {
      console.log("   (Không có kết quả nào)");
    } else {
      rows.forEach((r, idx) => {
        console.log(`   ${idx + 1}. Tên: ${r.name}`);
        console.log(`      Tỉnh: ${r.province} | Địa chỉ: ${r.address}`);
        // Kiem tra loi logic
        if (city && r.province !== city && r.province !== null && !r.address?.includes(city)) {
          console.log(`      ⚠️ LỖI LOGIC: Địa điểm này ở tỉnh [${r.province}] nhưng lại lọt vào danh sách tìm kiếm của thành phố [${city}]!`);
        }
      });
    }
    return rows;
  } catch (err) {
    console.log(`   ❌ DATABASE CRASH HOẶC TIMEOUT!`);
    console.log(`   Chi tiết: ${err.message.split('\n')[0]}`);
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST CỰC ĐOAN TÌM LỖI LOGIC...\n");

  // Tạo một địa điểm rác để test rò rỉ địa lý
  console.log("-> Bơm 1 dữ liệu mồi: Một quán ở Cà Mau nhưng có chữ 'Hà Nội' trong Description...");
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor)
    VALUES ('Bún cá cô Ba', 'Cà Mau', 'Cà Mau', 'Ngon chuẩn vị Hà Nội', ST_MakePoint(105, 9)::geography, 'unknown', 60, 'indoor')
  `;

  // Test 1: Lỗ hổng City Filter (Rò rỉ địa lý qua Description hoặc Name)
  await runExtremeTestCase("Lỗ hổng Rò rỉ Địa lý (Cross-province Leakage)", "Bún cá", "Hà Nội");

  // Xóa mồi
  await prisma.$executeRaw`DELETE FROM place WHERE name = 'Bún cá cô Ba'`;

  // Test 2: Từ khóa cực ngắn (Performance & Noise)
  await runExtremeTestCase("Từ khóa cực ngắn (Tấn công rác kết quả)", "a", "");

  // Test 3: DoS bằng chuỗi cực dài để đánh sập thuật toán Trigram
  const massiveString = "a".repeat(15000);
  await runExtremeTestCase("Tấn công hiệu năng bằng chuỗi khổng lồ (DoS Trigram)", massiveString, "");

}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
