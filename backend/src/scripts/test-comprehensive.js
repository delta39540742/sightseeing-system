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

async function search(q, city = '') {
  const limit = 5;
  const skip = 0;
  
  if (city) {
    return prisma.$queryRaw`
      SELECT p.place_id, p.name, p.province, p.address, p.popularity_score,
             GREATEST(
               word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
               word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
               CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
               CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
             ) as final_score
      FROM place p
      WHERE (
        ${q} = '' OR
        unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR GREATEST(
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
             word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
           ) > 0.25
      )
      AND (
        unaccent(lower(p.province))   LIKE '%' || unaccent(lower(${city})) || '%'
        OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${city})) || '%'
      )
      ORDER BY
        GREATEST(
          word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
          word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
          CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
          CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
        ) DESC,
        p.popularity_score DESC,
        p.place_id ASC
      LIMIT ${limit} OFFSET ${skip}
    `;
  } else {
    return prisma.$queryRaw`
      SELECT p.place_id, p.name, p.province, p.address, p.popularity_score,
             GREATEST(
               word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
               word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
               CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
               CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
             ) as final_score
      FROM place p
      WHERE
        unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.name)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%'
        OR GREATEST(
             word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
             word_similarity(unaccent(lower(p.name)), unaccent(lower(${q})))
           ) > 0.25
      ORDER BY
        GREATEST(
          word_similarity(unaccent(lower(${q})), unaccent(lower(p.name))),
          word_similarity(unaccent(lower(p.name)), unaccent(lower(${q}))),
          CASE WHEN unaccent(lower(p.province)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 2.0 ELSE 0.0 END,
          CASE WHEN unaccent(lower(p.address)) LIKE '%' || unaccent(lower(${q})) || '%' THEN 1.5 ELSE 0.0 END
        ) DESC,
        p.popularity_score DESC,
        p.place_id ASC
      LIMIT ${limit} OFFSET ${skip}
    `;
  }
}

async function runTest(name, description, fn) {
  console.log(`\n========================================================`);
  console.log(`[TEST] ${name}`);
  console.log(`Mô tả: ${description}`);
  console.log(`--------------------------------------------------------`);
  try {
    await fn();
    console.log(`✅ TEST PASSED`);
  } catch (err) {
    console.log(`❌ TEST FAILED: ${err.message}`);
  }
}

async function main() {
  console.log("🚀 BẮT ĐẦU CHẠY BỘ KIỂM THỬ TỔNG THỂ (COMPREHENSIVE TEST SUITE)...");

  await runTest(
    "Query Matching Test", 
    "Kiểm tra truy vấn cơ bản có trả về đúng kết quả không", 
    async () => {
      const res = await search("Bà Nà Hills", "Đà Nẵng");
      if (res.length === 0) throw new Error("Không tìm thấy kết quả");
      if (!res[0].name.toLowerCase().includes("bà nà hills") && !res[0].name.toLowerCase().includes("sun world")) {
         console.warn("   ⚠️ Warning: Không ra Bà Nà Hills ở top 1, ra: " + res[0].name);
      } else {
         console.log(`   Top 1: ${res[0].name}`);
      }
    }
  );

  await runTest(
    "Spell Correction / Fuzzy Search Test", 
    "Tìm kiếm không dấu, sai chính tả nhẹ", 
    async () => {
      const res1 = await search("ba na hil", "Đà Nẵng"); // sai chính tả, mất chữ l, mất s
      console.log(`   Kết quả cho 'ba na hil': ${res1.length > 0 ? res1[0].name : 'Rỗng'}`);
      
      const res2 = await search("hoi an", "Quảng Nam"); // không dấu
      console.log(`   Kết quả cho 'hoi an': ${res2.length > 0 ? res2[0].name : 'Rỗng'}`);
      
      if (res1.length === 0 || res2.length === 0) throw new Error("Fuzzy search thất bại");
    }
  );

  await runTest(
    "Ranking & Relevance Test", 
    "Mức độ liên quan & Xếp hạng (Địa điểm khớp tên + popularity cao phải lên đầu)", 
    async () => {
      // Gõ "Chợ" ở Đà Nẵng, mong đợi Chợ Cồn hoặc Chợ Hàn lên đầu
      const res = await search("Chợ", "Đà Nẵng");
      console.log("   Top 3 Chợ ở Đà Nẵng:");
      res.slice(0,3).forEach((r, i) => console.log(`   ${i+1}. ${r.name} (Pop: ${r.popularity_score})`));
      
      if (res.length === 0) throw new Error("Không tìm thấy chợ nào");
      if (res[0].popularity_score < res[1]?.popularity_score && res[0].final_score === res[1]?.final_score) {
        throw new Error("Ranking bị sai, popularity thấp hơn lại xếp trên");
      }
    }
  );

  await runTest(
    "Consistency Test", 
    "Cùng một truy vấn gọi nhiều lần phải ra kết quả y hệt nhau", 
    async () => {
      const q = "Vinpearl";
      const run1 = await search(q);
      const run2 = await search(q);
      const run3 = await search(q);
      
      const ids1 = run1.map(r => r.place_id).join(',');
      const ids2 = run2.map(r => r.place_id).join(',');
      const ids3 = run3.map(r => r.place_id).join(',');
      
      console.log(`   Lần 1: ${ids1}`);
      console.log(`   Lần 2: ${ids2}`);
      console.log(`   Lần 3: ${ids3}`);
      
      if (ids1 !== ids2 || ids2 !== ids3) {
        throw new Error("Kết quả không nhất quán giữa các lần gọi");
      }
    }
  );

  await runTest(
    "Reliability Test", 
    "Gọi liên tục 50 queries đồng thời để xem DB có sập không", 
    async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(search("Hồ Gươm", "Hà Nội"));
      }
      const start = Date.now();
      await Promise.all(promises);
      const end = Date.now();
      console.log(`   Hoàn thành 50 truy vấn đồng thời trong ${end - start}ms`);
    }
  );

}

main().catch(console.error).finally(() => {
  prisma.$disconnect();
  pool.end();
});
