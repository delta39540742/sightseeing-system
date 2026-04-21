import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Bắt đầu quá trình seeding dữ liệu Địa điểm Đà Nẵng...');

  // 1. Đọc file JSON một cách an toàn
  const filePath = path.join(__dirname, '../danang_places.json');
  let rawData = '';

  try {
    rawData = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Lỗi: Không thể tìm thấy hoặc đọc file danang_places.json', err);
    process.exit(1);
  }

  let places = [];
  try {
    places = JSON.parse(rawData);
  } catch (err) {
    console.error('Lỗi: File JSON không đúng định dạng', err);
    process.exit(1);
  }

  console.log(`Đã đọc thành công ${places.length} bản ghi từ file JSON.`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // 2. Map (ánh xạ) cấu trúc JSON sang dữ liệu của Prisma và Execute raw
  for (const item of places) {
    try {
      // 3. Skip Duplicates: Kiểm tra trùng lặp (giả sử tên địa điểm là yếu tố kiểm tra)
      const existingPlace: any[] = await prisma.$queryRaw`
        SELECT 1 FROM "place" WHERE name = ${item.name} LIMIT 1
      `;

      if (existingPlace.length > 0) {
        skipCount++;
        continue;
      }

      // Xử lý các logic ánh xạ cơ bản
      const priceMin = item.price_min || 0;
      const priceMax = Math.max((item.price_max || 0), priceMin);

      // Map price_type theo constraint: 'entry_fee' | 'avg_meal' | 'reference_total' | 'free'
      let priceType: string;
      if (priceMax === 0) {
        priceType = 'free';
      } else if (['restaurant', 'cafe', 'food', 'bar'].includes(item.category)) {
        priceType = 'avg_meal';
      } else if (['attraction', 'landmark', 'museum', 'theme_park'].includes(item.category)) {
        priceType = 'entry_fee';
      } else {
        priceType = 'reference_total';
      }

      const isIndoor = item.is_indoor ? 'indoor' : 'outdoor';
      const durationMin = item.duration_minutes || 60;
      const popularity = Math.min((item.popularity || 0) / 100, 1.0);

      // 4. LƯU Ý QUAN TRỌNG: Insert với tọa độ dạng PostGIS ST_SetSRID
      // Bắt buộc sử dụng $executeRaw thay vì createMany hoặc create do geom thuộc kiểu Unsupported
      await prisma.$executeRaw`
        INSERT INTO "place" (
          "name", 
          "description", 
          "min_price", 
          "max_price", 
          "price_type", 
          "avg_visit_duration_min", 
          "indoor_outdoor", 
          "popularity_score", 
          "address", 
          "geom"
        ) VALUES (
          ${item.name}, 
          ${item.category}, 
          ${priceMin}, 
          ${priceMax}, 
          ${priceType},
          ${durationMin},
          ${isIndoor},
          ${popularity},
          ${item.address},
          ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography
        )
      `;

      successCount++;
    } catch (err) {
      console.error(`-> Lỗi khi lưu địa điểm "${item.name}":`, err instanceof Error ? err.message : err);
      errorCount++;
    }
  }

  // 5. Console.log báo cáo kết quả
  console.log('\n--- BÁO CÁO KẾT QUẢ SEEDING ---');
  console.log(`- Tổng số bản ghi trong JSON: ${places.length}`);
  console.log(`- Số bản ghi chèn THÀNH CÔNG:  ${successCount}`);
  console.log(`- Số bản ghi ĐÃ BỎ QUA:       ${skipCount}`);
  console.log(`- Số bản ghi LỖI:             ${errorCount}`);
  console.log('-------------------------------\n');
}

main()
  .catch((e) => {
    console.error('Lỗi khi chạy Seeder:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('Đã đóng kết nối Database.');
  });
