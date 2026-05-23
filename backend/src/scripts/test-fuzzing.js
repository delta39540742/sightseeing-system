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

async function runEdgeCase(name, q, city) {
  console.log(`\n▶ [TEST]: ${name}`);
  console.log(`  Query: "${q}", City: "${city}"`);

  const limit = 5;
  const skip = 0;

  try {
    let rows;
    if (city) {
      rows = await prisma.$queryRaw`
        SELECT p.place_id, p.name, p.province
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
        SELECT p.place_id, p.name, p.province
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
    
    // Check for logical bugs (e.g. returning all rows when searching for special chars)
    if (rows.length > 0 && (q === "%" || q === "_")) {
      console.log(`  ❌ LỖI LOGIC: Cú pháp LIKE nhận diện '%', '_' là ký tự đại diện (wildcard) nên trả về kết quả rác!`);
      return false;
    }
    
    console.log(`  ✅ Thành công (Trả về ${rows.length} kết quả)`);
    return true;
  } catch (err) {
    console.log(`  ❌ LỖI HỆ THỐNG: Mệnh đề SQL bị vỡ hoặc từ chối thực thi!`);
    console.log(`  Chi tiết: ${err.message.split('\\n')[0]}`);
    return false;
  }
}

async function main() {
  console.log("ĐANG CHẠY BỘ TEST TÌM LỖI (FUZZING / EDGE CASES)...\n");

  const tests = [
    { name: "Không dấu, chữ thường", q: "nha trang", city: "" },
    { name: "In hoa toàn bộ", q: "KHÁNH HÒA", city: "" },
    { name: "SQL Injection cổ điển", q: "' OR 1=1; DROP TABLE place; --", city: "" },
    { name: "Ký tự Wildcard (Phần trăm)", q: "%", city: "" },
    { name: "Ký tự Wildcard (Gạch dưới)", q: "_", city: "" },
    { name: "Chuỗi rỗng", q: "", city: "" },
    { name: "Dấu gạch chéo", q: "\\\\", city: "" },
    { name: "Ký tự Emoji", q: "🏖️", city: "" },
    { name: "City là chuỗi Wildcard", q: "Vinpearl", city: "%" },
    { name: "Khoảng trắng siêu dài", q: "          ", city: "" },
    { name: "Ký tự null byte", q: "Nha\0Trang", city: "" }
  ];

  for (const t of tests) {
    const success = await runEdgeCase(t.name, t.q, t.city);
    if (!success) {
      console.log(`\n🛑 PHÁT HIỆN LỖI TẠI TEST CASE: [${t.name}]`);
      console.log("Dừng test để báo cáo lỗi!");
      break;
    }
  }
}

main().finally(() => {
  prisma.$disconnect();
  pool.end();
});
