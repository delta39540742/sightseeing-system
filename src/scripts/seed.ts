import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dataSource = process.env.DATA_SOURCE || 'danang';
  console.log(`[SEED] DATA_SOURCE is set to '${dataSource}'`);

  if (dataSource === 'danang') {
    console.log(`[SEED] Cleaning up existing 'place' data via TRUNCATE CASCADE...`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE place CASCADE;`);
    // NOTE: TRUNCATE CASCADE will automatically delete places and their relations in place_tag_map, place_image, etc.

    const danangPlaces = [
      {
        name: 'Cầu Rồng', 
        description: 'Cầu biểu tượng Đà Nẵng, phun lửa nước tối cuối tuần',
        lng: 108.2273, lat: 16.0614, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 45, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 1,
        terrain_easiness: 0.95, road_access_score: 1.0, spaciousness_1km: 0.8, popularity_score: 0.95,
        address: 'Quận Hải Châu, Đà Nẵng'
      },
      {
        name: 'Bà Nà Hills', 
        description: 'Khu du lịch núi Bà Nà, có Cầu Vàng',
        lng: 108.0299, lat: 15.9977, min_price: 850000, max_price: 1000000, price_type: 'entry_fee',
        avg_visit_duration_min: 300, indoor_outdoor: 'mixed', is_landmark: true, landmark_class_id: 2,
        terrain_easiness: 0.6, road_access_score: 0.7, spaciousness_1km: 0.5, popularity_score: 0.9,
        address: 'Hòa Vang, Đà Nẵng'
      },
      {
        name: 'Ngũ Hành Sơn', 
        description: 'Núi đá vôi linh thiêng, có chùa và động',
        lng: 108.2621, lat: 16.0036, min_price: 40000, max_price: 100000, price_type: 'entry_fee',
        avg_visit_duration_min: 120, indoor_outdoor: 'mixed', is_landmark: true, landmark_class_id: 3,
        terrain_easiness: 0.55, road_access_score: 0.9, spaciousness_1km: 0.7, popularity_score: 0.85,
        address: 'Ngũ Hành Sơn, Đà Nẵng'
      },
      {
        name: 'Chợ Cồn', 
        description: 'Chợ truyền thống lớn nhất Đà Nẵng',
        lng: 108.2186, lat: 16.0650, min_price: 20000, max_price: 200000, price_type: 'avg_meal',
        avg_visit_duration_min: 90, indoor_outdoor: 'mixed', is_landmark: true, landmark_class_id: 4,
        terrain_easiness: 0.95, road_access_score: 1.0, spaciousness_1km: 0.4, popularity_score: 0.8,
        address: 'Hải Châu, Đà Nẵng'
      },
      {
        name: 'Chùa Linh Ứng Bãi Bụt', 
        description: 'Tượng Phật Bà cao 67m, bán đảo Sơn Trà',
        lng: 108.2818, lat: 16.0992, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 90, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 5,
        terrain_easiness: 0.75, road_access_score: 0.8, spaciousness_1km: 0.8, popularity_score: 0.88,
        address: 'Sơn Trà, Đà Nẵng'
      },
      {
        name: 'Cầu Vàng', 
        description: 'Cây cầu độc đáo bởi bàn tay khổng lồ, ở Bà Nà Hills',
        lng: 108.0188, lat: 15.9956, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 60, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 6,
        terrain_easiness: 0.8, road_access_score: 0.6, spaciousness_1km: 0.3, popularity_score: 0.98,
        address: 'Trong Bà Nà Hills'
      },
      {
        name: 'Bãi biển Mỹ Khê', 
        description: 'Một trong những bãi biển đẹp nhất hành tinh',
        lng: 108.2486, lat: 16.0617, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 120, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 7,
        terrain_easiness: 1.0, road_access_score: 1.0, spaciousness_1km: 0.6, popularity_score: 0.95,
        address: 'Sơn Trà / Ngũ Hành Sơn'
      },
      {
        name: 'Hải Vân Quan', 
        description: 'Cổng di tích lịch sử đèo Hải Vân',
        lng: 108.1833, lat: 16.2000, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 60, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 8,
        terrain_easiness: 0.7, road_access_score: 0.5, spaciousness_1km: 0.9, popularity_score: 0.75,
        address: 'Đèo Hải Vân, Đà Nẵng'
      },
      {
        name: 'Bảo tàng Điêu khắc Chăm', 
        description: 'Bộ sưu tập điêu khắc Chăm lớn nhất',
        lng: 108.2235, lat: 16.0603, min_price: 60000, max_price: 60000, price_type: 'entry_fee',
        avg_visit_duration_min: 90, indoor_outdoor: 'indoor', is_landmark: true, landmark_class_id: 9,
        terrain_easiness: 1.0, road_access_score: 1.0, spaciousness_1km: 0.7, popularity_score: 0.7,
        address: 'Hải Châu, Đà Nẵng'
      },
      {
        name: 'Bán đảo Sơn Trà', 
        description: 'Khu bảo tồn thiên nhiên, ngắm voọc chà vá',
        lng: 108.2936, lat: 16.1189, min_price: 0, max_price: 0, price_type: 'free',
        avg_visit_duration_min: 180, indoor_outdoor: 'outdoor', is_landmark: true, landmark_class_id: 10,
        terrain_easiness: 0.5, road_access_score: 0.6, spaciousness_1km: 0.95, popularity_score: 0.78,
        address: 'Sơn Trà, Đà Nẵng'
      }
    ];

    console.log(`[SEED] Seeding 10 Da Nang locations in secure UTF-8 format...`);

    for (const p of danangPlaces) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO place (
          name, description, geom, min_price, max_price, price_type,
          avg_visit_duration_min, indoor_outdoor, is_landmark, landmark_class_id,
          terrain_easiness, road_access_score, spaciousness_1km, popularity_score,
          address
        ) VALUES (
          $1, $2, ST_GeogFromText('SRID=4326;POINT(' || $3 || ' ' || $4 || ')'), 
          $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
      `, 
        p.name, 
        p.description || null,
        p.lng, 
        p.lat, 
        p.min_price || 0,
        p.max_price || 0,
        p.price_type || 'free',
        p.avg_visit_duration_min || 60,
        p.indoor_outdoor || 'outdoor',
        p.is_landmark || false,
        p.landmark_class_id || null,
        p.terrain_easiness || 0,
        p.road_access_score || 0,
        p.spaciousness_1km || 0,
        p.popularity_score || 0,
        p.address || null
      );
    }
    console.log(`[SEED] Success: 10 Da Nang locations injected correctly!`);

  } else {
    // Other JSON handling like "hcm"
    const filePath = path.join(__dirname, `../../data/${dataSource}.json`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`[SEED-WARN] File ${filePath} does not exist. Skipping custom JSON seed.`);
      return;
    }

    const fileData = fs.readFileSync(filePath, 'utf-8');
    const places = JSON.parse(fileData);

    console.log(`[SEED] Found ${places.length} places in ${dataSource}.json, starting insertion...`);

    for (const p of places) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO place (
          name, description, geom, min_price, max_price, price_type,
          avg_visit_duration_min, indoor_outdoor, address
        ) VALUES (
          $1, $2, ST_GeogFromText('SRID=4326;POINT(' || $3 || ' ' || $4 || ')'), 
          $5, $6, $7, $8, $9, $10
        )
      `, 
        p.name, 
        p.description || null,
        p.lng, 
        p.lat, 
        p.min_price || 0,
        p.max_price || 0,
        p.price_type || 'free',
        p.avg_visit_duration_min || 60,
        p.indoor_outdoor || 'outdoor',
        p.address || null
      );
    }
    console.log(`[SEED] Success: Data injected for ${dataSource}!`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
