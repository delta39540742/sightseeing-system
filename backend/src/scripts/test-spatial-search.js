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

async function runTestCase(name, q, city) {
  console.log(`\n=================================================`);
  console.log(`[TEST CASE]: ${name}`);
  console.log(`- Query (q)   : "${q}"`);
  console.log(`- City filter : "${city || 'Không có'}"`);
  console.log(`-------------------------------------------------`);

  const limit = 5;
  const skip = 0;

  let rows;
  if (city) {
    rows = await prisma.$queryRaw`
      SELECT p.place_id, p.name, p.address, p.province, p.popularity_score
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
      SELECT p.place_id, p.name, p.address, p.province, p.popularity_score
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

  console.log(`=> TÌM THẤY ${rows.length} KẾT QUẢ TỐT NHẤT:`);
  if (rows.length === 0) {
    console.log("   (Không có kết quả nào)");
  } else {
    rows.forEach((r, idx) => {
      console.log(`   ${idx + 1}. ${r.name}`);
      console.log(`      Tỉnh      : ${r.province || 'NULL'}`);
      console.log(`      Địa chỉ cũ: ${r.address || 'NULL'}`);
    });
  }
}

async function main() {
  console.log("BẮT ĐẦU CHẠY CÁC TEST CASE (Do AI sinh ra để kiểm chứng API Spatial Search)\n");

  // Trường hợp 1: Người dùng gõ "Khánh Hòa" vào ô tìm kiếm tự do (không có bộ lọc city)
  await runTestCase(
    "Gõ tên Tỉnh 'Khánh Hòa' vào ô tìm kiếm tự do",
    "Khánh Hòa",
    ""
  );

  // Trường hợp 2: Gõ tên một địa điểm cụ thể "Vinpearl" và có truyền thêm city="Khánh Hòa"
  await runTestCase(
    "Tìm 'Vinpearl' với bộ lọc city='Khánh Hòa'",
    "Vinpearl",
    "Khánh Hòa"
  );

  // Trường hợp 3: Người dùng gõ tên tỉnh "Lâm Đồng"
  await runTestCase(
    "Gõ tên Tỉnh 'Lâm Đồng' vào ô tìm kiếm",
    "Lâm Đồng",
    ""
  );

  // Trường hợp 4: Tìm tên một món ăn "Bún cá" ở "Khánh Hòa"
  await runTestCase(
    "Tìm món 'Bún cá' ở 'Khánh Hòa'",
    "Bún cá",
    "Khánh Hòa"
  );
}

main()
  .catch(console.error)
  .finally(() => {
    prisma.$disconnect();
    pool.end();
  });
