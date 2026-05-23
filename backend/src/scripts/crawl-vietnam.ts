import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const PROGRESS_FILE = path.resolve(__dirname, '../../../.seed-progress');
const DATA_DIR = path.resolve(__dirname, '../../../data');

// Known mappings between OSM province names (slugified) and their existing json filenames/keywords
const SYNONYM_MAP: Record<string, string[]> = {
  'ho_chi_minh': ['hcmc', 'ho_chi_minh'],
  'lam_dong': ['dalat', 'lam_dong'],
  'binh_thuan': ['phanthiet', 'binh_thuan'],
  'kien_giang': ['phuquoc', 'kien_giang'],
  'ba_ria_vung_tau': ['vung_tau', 'ba_ria_vung_tau'],
  'thua_thien_hue': ['hue', 'thua_thien_hue'],
  'binh_dinh': ['binh-dinh', 'binh_dinh'],
  'dong_thap': ['dongthap', 'dongthap_places_clean', 'dong_thap'],
  'da_nang': ['danang', 'da_nang'],
  'ha_noi': ['hanoi', 'ha_noi'],
  'hai_phong': ['haiphong', 'hai_phong']
};

interface Province {
  id: number;
  name: string;
  slug: string;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// Normalize Vietnamese province names into a standardized slug format
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/tỉnh|thành phố/g, '') // remove "Tỉnh" and "Thành phố"
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[đĐ]/g, 'd')
    .trim()
    .replace(/[^a-z0-9]+/g, '_') // replace spaces and special chars with underscore
    .replace(/^_+|_+$/g, '');
}

// Reads .seed-progress to get a set of already completed/seeded keywords or file names
function loadCompletedKeywords(): Set<string> {
  if (!fs.existsSync(PROGRESS_FILE)) return new Set();
  const content = fs.readFileSync(PROGRESS_FILE, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  
  const keywords = new Set<string>();
  for (const line of lines) {
    // extract base name, e.g., "places_an_giang.json" -> "places_an_giang"
    const base = line.replace(/\.json$/, '');
    keywords.add(base);
    // add slug version of it too
    const slug = slugify(base);
    keywords.add(slug);
  }
  return keywords;
}

// Checks if a province is already considered completed based on seed progress
function isProvinceSeeded(province: Province, completedKeywords: Set<string>): boolean {
  // Direct match on slug
  if (completedKeywords.has(province.slug)) return true;
  if (completedKeywords.has(`places_${province.slug}`)) return true;

  // Check synonyms
  const synonyms = SYNONYM_MAP[province.slug] || [];
  for (const syn of synonyms) {
    if (completedKeywords.has(syn) || completedKeywords.has(`places_${syn}`) || completedKeywords.has(`${syn}_places`)) {
      return true;
    }
  }

  // Also check if any completed keyword contains the province slug as a substring, or vice versa
  for (const kw of completedKeywords) {
    if (kw.includes(province.slug) || province.slug.includes(kw)) {
      return true;
    }
  }

  return false;
}

// Fetch all provinces (admin_level=4 administrative boundaries) in Vietnam
async function fetchAllProvinces(): Promise<Province[]> {
  const query = `
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]["admin_level"="2"]->.vietnam;
    relation["boundary"="administrative"]["admin_level"="4"](area.vietnam);
    out tags;
  `;

  console.log('[CRAWLER] Đang tải danh sách các tỉnh thành từ Overpass API...');
  const response = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TravelSystemCrawler/1.0'
    },
    timeout: 90000
  });

  if (!response.data || !response.data.elements) {
    throw new Error('Overpass API returned empty list of provinces.');
  }

  const provinces: Province[] = response.data.elements
    .filter((el: any) => el.tags && el.tags.name)
    .map((el: any) => {
      const name = el.tags.name;
      return {
        id: el.id,
        name,
        slug: slugify(name)
      };
    });

  console.log(`[CRAWLER] Tìm thấy tổng cộng ${provinces.length} tỉnh thành trong OSM.`);
  return provinces;
}

// Sleeps for specified milliseconds
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch raw OSM data for a specific province area using its relation ID
async function fetchProvinceOSMData(province: Province, retries = 3): Promise<OverpassElement[]> {
  const areaId = 3600000000 + province.id;
  const query = `
    [out:json][timeout:180];
    area(${areaId})->.searchArea;
    (
      node["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](area.searchArea);
      way["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](area.searchArea);
      relation["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](area.searchArea);
      
      node["historic"](area.searchArea);
      way["historic"](area.searchArea);
      relation["historic"](area.searchArea);
      
      node["leisure"~"park|water_park|nature_reserve"](area.searchArea);
      way["leisure"~"park|water_park|nature_reserve"](area.searchArea);
      relation["leisure"~"park|water_park|nature_reserve"](area.searchArea);
      
      node["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](area.searchArea);
      way["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](area.searchArea);
      relation["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](area.searchArea);
      
      node["shop"~"bakery|pastry"](area.searchArea);
      way["shop"~"bakery|pastry"](area.searchArea);
    );
    out center;
  `;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[CRAWLER]   Đang gửi request cho ${province.name} (Lần thử ${attempt}/${retries})...`);
      const response = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TravelSystemCrawler/1.0'
        },
        timeout: 240000 // 4 minutes timeout per query
      });

      return response.data?.elements || [];
    } catch (err: any) {
      console.error(`[CRAWLER]   [Lỗi] Lần thử ${attempt} thất bại: ${err.message}`);
      if (attempt === retries) {
        throw err;
      }
      const waitTime = attempt * 10000; // Exponential backoff (10s, 20s)
      console.log(`[CRAWLER]   Đợi ${waitTime / 1000} giây trước khi thử lại...`);
      await sleep(waitTime);
    }
  }

  return [];
}

// Helpers for simulation values matching transform_osm2json.js
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFloat(min: number, max: number, decimals = 1): number {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

// Process raw OSM elements into standard Place JSON format
function transformElements(elements: OverpassElement[], province: Province): any[] {
  const results: any[] = [];
  const foodAmenities = ['restaurant', 'cafe', 'food_court', 'fast_food', 'bar', 'pub'];
  const tourismTags = ['museum', 'attraction', 'viewpoint', 'zoo', 'theme_park', 'gallery'];

  for (const el of elements) {
    if (!el.tags || !el.tags.name) continue;

    // 1. Basic Info
    const id = `osm_${el.id}`;
    const name = el.tags.name;
    const lat = el.lat || (el.center && el.center.lat);
    const lng = el.lon || (el.center && el.center.lon);
    if (!lat || !lng) continue;

    // 2. Category Mapping
    let category = 'other';
    if (el.tags.amenity && foodAmenities.includes(el.tags.amenity)) {
      category = el.tags.amenity === 'cafe' ? 'cafe' : 'restaurant';
    } else if (el.tags.tourism || el.tags.historic) {
      category = 'attraction';
    } else if (el.tags.leisure && ['park', 'water_park'].includes(el.tags.leisure)) {
      category = 'attraction';
    } else if (el.tags.shop && ['bakery', 'pastry'].includes(el.tags.shop)) {
      category = 'restaurant'; // bakery categorized as restaurant/food
    }

    // 3. Tags
    const tags: string[] = [];
    if (category === 'restaurant' || category === 'cafe') {
      tags.push('food');
      if (el.tags.cuisine) tags.push('local_food');
    } else if (category === 'attraction') {
      tags.push('tourism');
      if (el.tags.historic) tags.push('culture');
      if (el.tags.leisure === 'park') tags.push('nature');
    }

    // 4. Simulated Prices & Costs
    let price_min = 0;
    let price_max = 0;
    if (category === 'restaurant' || category === 'cafe') {
      price_min = 30000;
      price_max = 200000;
    } else if (category === 'attraction') {
      price_min = 0;
      price_max = 150000;
    }
    const visit_cost = getRandomInt(price_min, price_max || 50000);

    // 5. Opening Hours
    let open = "08:00";
    let close = "22:00";
    if (el.tags.opening_hours) {
      const match = el.tags.opening_hours.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (match) {
        open = match[1];
        close = match[2];
      }
    } else if (category === 'restaurant' || category === 'cafe') {
      open = "10:00";
      close = "22:00";
    }

    // 6. Visit Duration
    let duration_minutes = 60;
    if (category === 'restaurant') duration_minutes = 90;
    if (category === 'cafe') duration_minutes = 45;
    if (category === 'attraction') duration_minutes = 120;

    // 7. Simulated Metadata
    const is_indoor = el.tags.indoor === 'yes' || ['restaurant', 'cafe', 'museum'].includes(el.tags.amenity || el.tags.tourism || '');
    const popularity = getRandomInt(10, 100);
    const rating = getRandomFloat(3.5, 4.9);
    
    // Stable dummy image of beautiful Vietnam travel scene
    const image = 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=800&q=80';

    results.push({
      id,
      name,
      lat,
      lng,
      category,
      tags,
      price_min,
      price_max,
      visit_cost,
      opening_hours: { open, close },
      duration_minutes,
      is_indoor,
      popularity,
      rating,
      image,
      address: province.name, // E.g., "Tỉnh Hà Nam" or "Thành phố Hồ Chí Minh"
      created_at: new Date().toISOString()
    });
  }

  return results;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  try {
    const allProvinces = await fetchAllProvinces();
    const completedKeywords = loadCompletedKeywords();
    
    // Filter out already crawled/seeded ones
    const pending = allProvinces.filter(p => !isProvinceSeeded(p, completedKeywords));

    console.log(`\n[CRAWLER] ==================================================`);
    console.log(`[CRAWLER] Tổng số tỉnh thành: ${allProvinces.length}`);
    console.log(`[CRAWLER] Đã hoàn thành (seed progress): ${allProvinces.length - pending.length}`);
    console.log(`[CRAWLER] Còn lại cần cào: ${pending.length}`);
    console.log(`[CRAWLER] ==================================================\n`);

    if (pending.length === 0) {
      console.log('[CRAWLER] Tất cả các tỉnh thành đã được cào và seed xong!');
      return;
    }

    let crawledCount = 0;
    
    for (const province of pending) {
      console.log(`[CRAWLER] (${++crawledCount}/${pending.length}) Đang cào dữ liệu cho: ${province.name} (slug: ${province.slug})...`);
      
      try {
        const elements = await fetchProvinceOSMData(province);
        console.log(`[CRAWLER]   Đã tải ${elements.length} elements từ OSM.`);

        if (elements.length === 0) {
          console.log(`[CRAWLER]   [Cảnh báo] Không tìm thấy địa điểm nào cho ${province.name}. Bỏ qua.`);
          continue;
        }

        const transformed = transformElements(elements, province);
        console.log(`[CRAWLER]   Đã convert thành công ${transformed.length} địa điểm chuẩn schema.`);

        if (transformed.length === 0) {
          console.log(`[CRAWLER]   [Cảnh báo] Không có địa điểm hợp lệ sau khi filter. Bỏ qua.`);
          continue;
        }

        // Save file in data folder, name convention: places_<normalized_slug>.json
        const filename = `places_${province.slug}.json`;
        const filePath = path.join(DATA_DIR, filename);
        
        fs.writeFileSync(filePath, JSON.stringify(transformed, null, 2), 'utf-8');
        console.log(`[CRAWLER]   [Lưu file] Thành công -> ${filePath}`);

      } catch (err: any) {
        console.error(`[CRAWLER]   [Lỗi nghiêm trọng] Lỗi khi cào ${province.name}: ${err.message}`);
        console.error('[CRAWLER]   Tiếp tục cào tỉnh tiếp theo...');
      }

      // Add a polite delay of 3 seconds between crawls to prevent IP/rate limit blocks on Overpass API
      console.log(`[CRAWLER]   Nghỉ 3 giây trước tỉnh thành tiếp theo...`);
      await sleep(3000);
    }

    console.log('\n[CRAWLER] Hoàn tất quá trình cào dữ liệu cho tất cả các tỉnh thành còn lại!');
  } catch (error: any) {
    console.error('[CRAWLER] [Lỗi hệ thống] Quá trình cào gặp lỗi nghiêm trọng:', error.message);
  }
}

main();
