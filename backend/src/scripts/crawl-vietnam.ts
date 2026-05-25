import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Overpass has multiple mirror endpoints. We rotate through them on failure since any one
// can return 504 "server too busy" under load.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const PROGRESS_FILE = path.resolve(__dirname, '../../../.seed-progress');
const DATA_DIR = path.resolve(__dirname, '../../../data');

// Canonical list of 34 Vietnamese administrative units (post-1/7/2025 merger).
// Source of truth: OSM admin_level=4 boundaries inside Vietnam, verified via diagnose-osm-vn.ts.
// Slug is the deterministic output of slugify(name).
const CANONICAL_PROVINCES: { name: string; slug: string }[] = [
  { name: 'An Giang', slug: 'an_giang' },
  { name: 'Bắc Ninh', slug: 'bac_ninh' },
  { name: 'Cà Mau', slug: 'ca_mau' },
  { name: 'Cần Thơ', slug: 'can_tho' },
  { name: 'Cao Bằng', slug: 'cao_bang' },
  { name: 'Đà Nẵng', slug: 'da_nang' },
  { name: 'Đắk Lắk', slug: 'dak_lak' },
  { name: 'Điện Biên', slug: 'dien_bien' },
  { name: 'Đồng Nai', slug: 'dong_nai' },
  { name: 'Đồng Tháp', slug: 'dong_thap' },
  { name: 'Gia Lai', slug: 'gia_lai' },
  { name: 'Hà Nội', slug: 'ha_noi' },
  { name: 'Hà Tĩnh', slug: 'ha_tinh' },
  { name: 'Hải Phòng', slug: 'hai_phong' },
  { name: 'Hồ Chí Minh', slug: 'ho_chi_minh' },
  { name: 'Huế', slug: 'hue' },
  { name: 'Hưng Yên', slug: 'hung_yen' },
  { name: 'Khánh Hòa', slug: 'khanh_hoa' },
  { name: 'Lai Châu', slug: 'lai_chau' },
  { name: 'Lâm Đồng', slug: 'lam_dong' },
  { name: 'Lạng Sơn', slug: 'lang_son' },
  { name: 'Lào Cai', slug: 'lao_cai' },
  { name: 'Nghệ An', slug: 'nghe_an' },
  { name: 'Ninh Bình', slug: 'ninh_binh' },
  { name: 'Phú Thọ', slug: 'phu_tho' },
  { name: 'Quảng Ngãi', slug: 'quang_ngai' },
  { name: 'Quảng Ninh', slug: 'quang_ninh' },
  { name: 'Quảng Trị', slug: 'quang_tri' },
  { name: 'Sơn La', slug: 'son_la' },
  { name: 'Tây Ninh', slug: 'tay_ninh' },
  { name: 'Thái Nguyên', slug: 'thai_nguyen' },
  { name: 'Thanh Hóa', slug: 'thanh_hoa' },
  { name: 'Tuyên Quang', slug: 'tuyen_quang' },
  { name: 'Vĩnh Long', slug: 'vinh_long' },
];

// Alternate OSM name spellings that should resolve to a canonical slug.
// Key = OSM-side slug after slugify, Value = canonical slug.
const OSM_NAME_ALIASES: Record<string, string> = {
  thanh_pho_ho_chi_minh: 'ho_chi_minh',
  tp_ho_chi_minh: 'ho_chi_minh',
  sai_gon: 'ho_chi_minh',
  thua_thien_hue: 'hue', // legacy name still occasionally appears
};

interface Province {
  name: string;
  slug: string;
  osmRelationId: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// Normalize Vietnamese names into a stable slug. Strips "Tỉnh"/"Thành phố" prefixes and diacritics.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/tỉnh|thành phố/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Reads .seed-progress. Each line is an exact filename (e.g. "places_an_giang.json") OR an exact slug.
// Match is EXACT — no substring, no synonym guessing. That was the source of the cross-province confusion.
function loadCompletedSlugs(): Set<string> {
  if (!fs.existsSync(PROGRESS_FILE)) return new Set();
  const content = fs.readFileSync(PROGRESS_FILE, 'utf-8');
  const slugs = new Set<string>();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Accept "places_<slug>.json" or bare "<slug>"
    const m = line.match(/^places_([a-z0-9_]+)\.json$/i);
    if (m) {
      slugs.add(m[1].toLowerCase());
    } else {
      slugs.add(line.replace(/\.json$/i, '').toLowerCase());
    }
  }
  return slugs;
}

function appendProgress(slug: string): void {
  fs.appendFileSync(PROGRESS_FILE, `places_${slug}.json\n`, 'utf-8');
}

// Wipe all crawler outputs and progress for a fully fresh run.
function wipeExistingData(): void {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('[CRAWLER] Đã xoá .seed-progress');
  }
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.json'));
    for (const f of files) {
      fs.unlinkSync(path.join(DATA_DIR, f));
    }
    console.log(`[CRAWLER] Đã xoá ${files.length} file json cũ trong data/`);
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Submit an Overpass QL query, rotating mirrors on 504/timeout and applying exponential backoff.
// Treats any non-2xx as a retryable failure.
async function overpassQuery(query: string, opts: { timeoutMs?: number; maxAttempts?: number; label?: string } = {}): Promise<OverpassElement[]> {
  const timeoutMs = opts.timeoutMs ?? 120000;
  const maxAttempts = opts.maxAttempts ?? 8;
  const label = opts.label ?? 'query';

  let lastErr: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = OVERPASS_URLS[(attempt - 1) % OVERPASS_URLS.length];
    try {
      const response = await axios.post(url, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'TravelSystemCrawler/1.0',
        },
        timeout: timeoutMs,
        validateStatus: s => s >= 200 && s < 300,
      });
      return response.data?.elements || [];
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status || err?.code || 'ERR';
      console.error(`[CRAWLER]   [${label}] thử ${attempt}/${maxAttempts} ${url} -> ${status}`);
      if (attempt === maxAttempts) break;
      const wait = Math.min(60000, 5000 * attempt); // 5s, 10s, 15s, ... cap 60s
      console.log(`[CRAWLER]   Đợi ${wait / 1000}s rồi đổi mirror...`);
      await sleep(wait);
    }
  }
  throw lastErr ?? new Error(`Overpass query "${label}" thất bại sau ${maxAttempts} lần`);
}

// Fetch all admin_level=4 boundaries in Vietnam and return a slug -> {osmRelationId, osmName} map.
async function fetchOSMProvinceMap(): Promise<Map<string, { osmRelationId: number; osmName: string }>> {
  const query = `
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]["admin_level"="2"]->.vietnam;
    relation["boundary"="administrative"]["admin_level"="4"](area.vietnam);
    out tags;
  `;

  console.log('[CRAWLER] Đang tải danh sách boundary admin_level=4 tại Việt Nam từ Overpass...');
  const elements = await overpassQuery(query, { timeoutMs: 90000, label: 'province-list' });
  const map = new Map<string, { osmRelationId: number; osmName: string }>();

  for (const el of elements) {
    if (!el.tags || !el.tags.name) continue;
    const rawSlug = slugify(el.tags.name);
    const canonicalSlug = OSM_NAME_ALIASES[rawSlug] || rawSlug;
    if (!map.has(canonicalSlug)) {
      map.set(canonicalSlug, { osmRelationId: el.id, osmName: el.tags.name });
    }
  }

  console.log(`[CRAWLER] OSM trả về ${elements.length} boundary, dedupe còn ${map.size} slug.`);
  return map;
}

// Some provinces may be missing in admin_level=4 (e.g., after 2025 merger). Search OSM directly by name.
async function findProvinceByName(name: string): Promise<{ osmRelationId: number; osmName: string } | null> {
  const query = `
    [out:json][timeout:60];
    area["ISO3166-1"="VN"]->.vn;
    (
      relation["boundary"="administrative"]["admin_level"~"^[4-6]$"]["name"="${name}"](area.vn);
    );
    out tags;
  `;
  try {
    const els = await overpassQuery(query, { timeoutMs: 60000, maxAttempts: 4, label: `fallback:${name}` });
    if (els.length === 0) return null;
    // Prefer the lowest admin_level (i.e. largest unit) if multiple matches
    els.sort((a, b) => Number(a.tags?.admin_level || 9) - Number(b.tags?.admin_level || 9));
    const chosen = els[0];
    return { osmRelationId: chosen.id, osmName: chosen.tags!.name };
  } catch (err: any) {
    console.error(`[CRAWLER]   [Lỗi fallback] Không query được "${name}": ${err.message}`);
    return null;
  }
}

// Fetch all POI elements within a given province's admin boundary.
async function fetchProvinceOSMData(province: Province): Promise<OverpassElement[]> {
  const areaId = 3600000000 + province.osmRelationId;
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

  return overpassQuery(query, { timeoutMs: 240000, maxAttempts: 6, label: `poi:${province.slug}` });
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getRandomFloat(min: number, max: number, decimals = 1): number {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

// Convert raw OSM elements into the Place schema used by seed-places.
function transformElements(elements: OverpassElement[], province: Province): any[] {
  const results: any[] = [];
  const foodAmenities = ['restaurant', 'cafe', 'food_court', 'fast_food', 'bar', 'pub'];

  for (const el of elements) {
    if (!el.tags || !el.tags.name) continue;

    const id = `osm_${el.id}`;
    const name = el.tags.name;
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    let category = 'other';
    if (el.tags.amenity && foodAmenities.includes(el.tags.amenity)) {
      category = el.tags.amenity === 'cafe' ? 'cafe' : 'restaurant';
    } else if (el.tags.tourism || el.tags.historic) {
      category = 'attraction';
    } else if (el.tags.leisure && ['park', 'water_park'].includes(el.tags.leisure)) {
      category = 'attraction';
    } else if (el.tags.shop && ['bakery', 'pastry'].includes(el.tags.shop)) {
      category = 'restaurant';
    }

    const tags: string[] = [];
    if (category === 'restaurant' || category === 'cafe') {
      tags.push('food');
      if (el.tags.cuisine) tags.push('local_food');
    } else if (category === 'attraction') {
      tags.push('tourism');
      if (el.tags.historic) tags.push('culture');
      if (el.tags.leisure === 'park') tags.push('nature');
    }

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

    let open = '08:00';
    let close = '22:00';
    if (el.tags.opening_hours) {
      const match = el.tags.opening_hours.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (match) {
        open = match[1];
        close = match[2];
      }
    } else if (category === 'restaurant' || category === 'cafe') {
      open = '10:00';
      close = '22:00';
    }

    let duration_minutes = 60;
    if (category === 'restaurant') duration_minutes = 90;
    if (category === 'cafe') duration_minutes = 45;
    if (category === 'attraction') duration_minutes = 120;

    const is_indoor =
      el.tags.indoor === 'yes' ||
      ['restaurant', 'cafe', 'museum'].includes(el.tags.amenity || el.tags.tourism || '');
    const popularity = getRandomInt(10, 100);
    const rating = getRandomFloat(3.5, 4.9);
    const image =
      'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=800&q=80';

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
      province: province.name,
      province_slug: province.slug,
      address: province.name,
      created_at: new Date().toISOString(),
    });
  }

  return results;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const fresh = args.has('--fresh');

  if (fresh) {
    console.log('[CRAWLER] === CHẾ ĐỘ --fresh: xoá toàn bộ data cũ trước khi cào ===');
    wipeExistingData();
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const osmMap = await fetchOSMProvinceMap();
  const completedSlugs = loadCompletedSlugs();

  // Resolve canonical province list → concrete OSM relation IDs (with fallback for missing entries)
  const resolved: Province[] = [];
  const missing: string[] = [];

  for (const canon of CANONICAL_PROVINCES) {
    const hit = osmMap.get(canon.slug);
    if (hit) {
      resolved.push({ name: canon.name, slug: canon.slug, osmRelationId: hit.osmRelationId });
    } else {
      missing.push(canon.name);
    }
  }

  // Fallback: try direct name search for the ones missing from admin_level=4
  if (missing.length > 0) {
    console.log(`[CRAWLER] ${missing.length} tỉnh không có trong admin_level=4, thử fallback theo tên...`);
    for (const name of missing) {
      const canon = CANONICAL_PROVINCES.find(c => c.name === name)!;
      const hit = await findProvinceByName(name);
      if (hit) {
        console.log(`[CRAWLER]   ✓ Fallback OK: ${name} → relation ${hit.osmRelationId} (OSM name: "${hit.osmName}")`);
        resolved.push({ name: canon.name, slug: canon.slug, osmRelationId: hit.osmRelationId });
      } else {
        console.warn(`[CRAWLER]   ✗ Không tìm thấy ${name} trên OSM. Sẽ bỏ qua.`);
      }
      await sleep(1500);
    }
  }

  const pending = resolved.filter(p => !completedSlugs.has(p.slug));

  console.log('\n[CRAWLER] ==================================================');
  console.log(`[CRAWLER] Canonical: ${CANONICAL_PROVINCES.length} tỉnh thành`);
  console.log(`[CRAWLER] Resolved: ${resolved.length}`);
  console.log(`[CRAWLER] Đã seed (skip): ${resolved.length - pending.length}`);
  console.log(`[CRAWLER] Sẽ cào: ${pending.length}`);
  console.log('[CRAWLER] ==================================================\n');

  if (pending.length === 0) {
    console.log('[CRAWLER] Tất cả các tỉnh thành đã được cào và seed xong!');
    return;
  }

  let i = 0;
  for (const province of pending) {
    i += 1;
    console.log(`[CRAWLER] (${i}/${pending.length}) ${province.name} (slug: ${province.slug}, osm: ${province.osmRelationId})`);

    try {
      const elements = await fetchProvinceOSMData(province);
      console.log(`[CRAWLER]   Đã tải ${elements.length} elements từ OSM.`);

      if (elements.length === 0) {
        console.log(`[CRAWLER]   [Cảnh báo] Không có địa điểm nào cho ${province.name}. Bỏ qua.`);
        continue;
      }

      const transformed = transformElements(elements, province);
      console.log(`[CRAWLER]   Đã convert ${transformed.length} địa điểm.`);
      if (transformed.length === 0) continue;

      const filename = `places_${province.slug}.json`;
      const filePath = path.join(DATA_DIR, filename);
      fs.writeFileSync(filePath, JSON.stringify(transformed, null, 2), 'utf-8');
      appendProgress(province.slug);
      console.log(`[CRAWLER]   [OK] -> ${filePath}`);
    } catch (err: any) {
      console.error(`[CRAWLER]   [Lỗi] ${province.name}: ${err.message}`);
      console.error('[CRAWLER]   Tiếp tục tỉnh tiếp theo...');
    }

    console.log('[CRAWLER]   Nghỉ 3s...');
    await sleep(3000);
  }

  console.log('\n[CRAWLER] Hoàn tất.');
}

main().catch(err => {
  console.error('[CRAWLER] [Lỗi hệ thống]', err);
  process.exit(1);
});
