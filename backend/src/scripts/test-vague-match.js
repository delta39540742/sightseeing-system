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

async function runVagueTest(q) {
  console.log(`\n========================================================`);
  console.log(`🔍 [VAGUE MATCH TEST]: Từ khóa: "${q}"`);
  console.log(`--------------------------------------------------------`);
  
  const sanitize = (str) => (str || '').replace(/[%_\\]/g, '\\$&');
  q = sanitize(q);

  try {
    const rows = await prisma.$queryRaw`
      SELECT p.place_id, p.name,
             GREATEST(
               word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
               word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
             ) as sim_score
      FROM place p
      WHERE
        unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR GREATEST(
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
             word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
           ) > 0.25
      ORDER BY sim_score DESC
      LIMIT 5
    `;

    if (rows.length === 0) {
      console.log("   ❌ Trả về: KHÔNG CÓ KẾT QUẢ NÀO! (Thuật toán đã thất bại trong việc hiểu ý định)");
    } else {
      rows.forEach(r => {
        console.log(`   Tìm thấy: "${r.name}" (Điểm khớp ký tự: ${Number(r.sim_score).toFixed(4)})`);
      });
    }
  } catch (err) {
    console.log(`   ❌ DATABASE CRASH! ${err.message}`);
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST TỪ KHÓA MƠ HỒ (VAGUE/SEMANTIC MATCHING)...\n");

  // Tạo dữ liệu mồi
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor, popularity_score)
    VALUES 
    ('Bãi Biển Mỹ Khê', 'Đà Nẵng', 'Đà Nẵng', 'Bãi biển đẹp nhất, cát trắng nắng vàng, thích hợp để tắm biển', ST_MakePoint(105, 21)::geography, 'free', 120, 'outdoor', 0.9),
    ('Khu Vui Chơi VinWonders', 'Khánh Hòa', 'Nha Trang', 'Khu giải trí dành cho trẻ em và gia đình', ST_MakePoint(105, 21)::geography, 'entry_fee', 240, 'outdoor', 0.9)
  `;

  // Từ khóa 1: Có nhắc tới bãi biển nhưng gõ khác với tên quán
  await runVagueTest("chỗ tắm biển cát trắng");

  // Từ khóa 2: Ý định dẫn gia đình đi chơi
  await runVagueTest("nơi dẫn trẻ em đi chơi");
  
  // Từ khóa 3: Tìm quán cà phê nhưng không gõ chữ 'cà phê'
  await runVagueTest("uống nước giải khát");

  // Dọn dẹp mồi
  await prisma.$executeRaw`DELETE FROM place WHERE name IN ('Bãi Biển Mỹ Khê', 'Khu Vui Chơi VinWonders')`;
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
