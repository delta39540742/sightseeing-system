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

async function runLongQueryTest(q, name) {
  console.log(`\n========================================================`);
  console.log(`🔍 [LONG QUERY TEST]: Tên Địa Điểm: "${name}"`);
  console.log(`--------------------------------------------------------`);
  
  const sanitize = (str) => (str || '').replace(/[%_\\]/g, '\\$&');
  q = sanitize(q);

  try {
    const rows = await prisma.$queryRaw`
      SELECT p.place_id, p.name,
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) as sim_q_to_name,
             word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))) as sim_name_to_q
      FROM place p
      WHERE p.name = ${name}
    `;

    if (rows.length === 0) {
      console.log("   (Không tìm thấy địa điểm mồi)");
    } else {
      rows.forEach(r => {
        console.log(`   Từ khóa (q)       : "${q}"`);
        console.log(`   Điểm (q -> name)  : ${Number(r.sim_q_to_name).toFixed(4)}  <-- Đang dùng trong hệ thống (sẽ tạch nếu q quá dài)`);
        console.log(`   Điểm (name -> q)  : ${Number(r.sim_name_to_q).toFixed(4)}  <-- Nếu đảo ngược lại`);
      });
    }
  } catch (err) {
    console.log(`   ❌ DATABASE CRASH! Chi tiết: ${err.message.split('\n')[0]}`);
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST ĐỂ TÌM LỖI LOGIC: CÂU TRUY VẤN DÀI HƠN TÊN QUÁN (LONG QUERY BUG)...\n");

  const dummyName = 'Bún Chả Hương Liên';

  // Tạo dữ liệu mồi
  await prisma.$executeRaw`
    INSERT INTO place (name, province, address, description, geom, price_type, avg_visit_duration_min, indoor_outdoor, popularity_score)
    VALUES (${dummyName}, 'Hà Nội', 'Hà Nội', '', ST_MakePoint(105, 21)::geography, 'unknown', 30, 'indoor', 0.9)
  `;

  // Test 1: Query ngắn, Tên dài -> Hệ thống hoạt động tốt
  await runLongQueryTest("Hương Liên", dummyName);

  // Test 2: Query cực dài, Tên ngắn -> Hệ thống hiện tại sẽ TẠCH hoàn toàn
  await runLongQueryTest("cho mình hỏi đường đi tới quán bún chả hương liên ở đâu vậy", dummyName);

  // Dọn dẹp mồi
  await prisma.$executeRaw`DELETE FROM place WHERE name = ${dummyName}`;
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
