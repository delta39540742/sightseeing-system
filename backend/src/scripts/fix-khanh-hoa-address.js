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

async function main() {
  console.log('Đang cập nhật địa chỉ cho các địa điểm nằm trong khu vực Khánh Hòa...');
  
  // Bounding box tương đối của Khánh Hòa:
  // Vĩ độ (lat): từ 11.7 (Cam Ranh) đến 12.9 (Vạn Ninh)
  // Kinh độ (lng): từ 108.7 (Khánh Vĩnh) đến 109.5 (Nha Trang/Biển)
  
  const updated = await prisma.$executeRaw`
    UPDATE place
    SET address = CASE 
                    WHEN address IS NULL OR address = '' THEN 'Khánh Hòa'
                    WHEN address NOT ILIKE '%Khánh Hòa%' THEN address || ', Khánh Hòa'
                    ELSE address
                  END
    WHERE lat >= 11.7 AND lat <= 12.9 
      AND lng >= 108.7 AND lng <= 109.5
      AND (address IS NULL OR address NOT ILIKE '%Khánh Hòa%')
  `;
  
  console.log(`Đã cập nhật thành công địa chỉ cho ${updated} địa điểm trong khu vực Khánh Hòa.`);
}

main()
  .catch((e) => {
    console.error('Lỗi khi cập nhật:', e);
  })
  .finally(() => {
    prisma.$disconnect();
    pool.end();
  });
