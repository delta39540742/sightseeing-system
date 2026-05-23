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

async function evaluateSearch(name, q, city) {
  console.log(`\n========================================================`);
  console.log(`🔍 [ĐÁNH GIÁ CHẤT LƯỢNG]: ${name}`);
  console.log(`   - Từ khóa (q) : "${q}"`);
  console.log(`   - Bộ lọc tỉnh : "${city || 'Không'}"`);
  console.log(`--------------------------------------------------------`);

  // Giả lập sanitize
  const sanitize = (str) => (str || '').replace(/[%_\\]/g, '\\$&');
  q = sanitize(q);
  city = sanitize(city);

  const limit = 5;
  const skip = 0;

  let rows;
  if (city) {
    rows = await prisma.$queryRaw`
      SELECT p.place_id, p.name, p.province, p.popularity_score,
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) as sim_score
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
      SELECT p.place_id, p.name, p.province, p.popularity_score,
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))) as sim_score
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

  if (rows.length === 0) {
    console.log("   ❌ Không tìm thấy kết quả nào. (Cần kiểm tra lại thuật toán/dữ liệu)");
  } else {
    rows.forEach((r, idx) => {
      console.log(`   ${idx + 1}. [${r.province}] ${r.name}`);
      console.log(`      * Độ khớp từ (Sim): ${Number(r.sim_score || 0).toFixed(2)} | Độ phổ biến: ${Number(r.popularity_score || 0).toFixed(2)}`);
    });
    
    // Simple evaluation
    const topResult = rows[0];
    if (Number(topResult.sim_score) < 0.3) {
      console.log(`\n   ⚠️ Cảnh báo chất lượng: Kết quả top 1 có độ khớp từ vựng thấp (${Number(topResult.sim_score).toFixed(2)}). Có thể do lỗi đánh máy quá nặng hoặc thuật toán chưa tối ưu.`);
    } else {
      console.log(`\n   ✅ Đánh giá: Xếp hạng hợp lý. Kết quả có độ liên quan cao được đưa lên đầu.`);
    }
  }
}

async function main() {
  console.log("TIẾN HÀNH KIỂM THỬ CHẤT LƯỢNG THUẬT TOÁN TÌM KIẾM (SEARCH QUALITY EVALUATION)...\n");

  const tests = [
    { name: "Tìm kiếm chính xác tên nổi tiếng", q: "Chợ Bến Thành", city: "Hồ Chí Minh" },
    { name: "Tìm kiếm sai chính tả nhẹ (Typos)", q: "vinpeal nha trang", city: "Khánh Hòa" },
    { name: "Tìm kiếm thiếu dấu", q: "nui lang biang", city: "Lâm Đồng" },
    { name: "Tìm kiếm chung chung (Danh mục)", q: "bún bò", city: "Hà Nội" },
    { name: "Tìm kiếm chéo tỉnh (Tên 1 nơi, Tỉnh 1 nẻo - Kỳ vọng fail hoặc ra kết quả ảo)", q: "Chợ Bến Thành", city: "Khánh Hòa" },
    { name: "Tìm kiếm tên quán quá phổ thông", q: "Cafe", city: "Đà Nẵng" },
    { name: "Gõ sai chính tả nặng (Fuzzy matching threshold)", q: "bhn tay ho", city: "Hà Nội" } // Hồ Tây, Bánh tôm hồ tây?
  ];

  for (const t of tests) {
    await evaluateSearch(t.name, t.q, t.city);
  }
}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
