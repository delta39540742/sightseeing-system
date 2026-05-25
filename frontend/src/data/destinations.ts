/**
 * Single source of truth for tourist destinations the user can pick.
 *
 * Two kinds of entries:
 *   1) Province-level (radiusKm undefined)  — match all places inside that province
 *      (e.g. "Sơn La" → province = "Sơn La", any place inside the province boundary)
 *   2) Sub-province destinations (radiusKm defined) — match places inside the province
 *      AND within radiusKm km of (lat,lng). Used for famous tourism clusters that span
 *      multiple xã/phường after the 1/7/2025 administrative restructure
 *      (e.g. "Mộc Châu" cao nguyên spans many wards in Sơn La province).
 *
 * `province` MUST match the value stored in DB's `place.province` column exactly,
 * which is the canonical Vietnamese name with diacritics
 * (see backend/src/scripts/crawl-vietnam.ts CANONICAL_PROVINCES).
 */
export interface Destination {
  slug: string;
  name: string;          // Display name (Vietnamese, with diacritics)
  province: string;      // Canonical province name (matches DB)
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

// 34 provinces (post-1/7/2025 merger) — radius undefined → whole-province match
const PROVINCES: Destination[] = [
  { slug: 'an_giang',    name: 'An Giang',    province: 'An Giang' },
  { slug: 'bac_ninh',    name: 'Bắc Ninh',    province: 'Bắc Ninh' },
  { slug: 'ca_mau',      name: 'Cà Mau',      province: 'Cà Mau' },
  { slug: 'can_tho',     name: 'Cần Thơ',     province: 'Cần Thơ' },
  { slug: 'cao_bang',    name: 'Cao Bằng',    province: 'Cao Bằng' },
  { slug: 'da_nang',     name: 'Đà Nẵng',     province: 'Đà Nẵng' },
  { slug: 'dak_lak',     name: 'Đắk Lắk',     province: 'Đắk Lắk' },
  { slug: 'dien_bien',   name: 'Điện Biên',   province: 'Điện Biên' },
  { slug: 'dong_nai',    name: 'Đồng Nai',    province: 'Đồng Nai' },
  { slug: 'dong_thap',   name: 'Đồng Tháp',   province: 'Đồng Tháp' },
  { slug: 'gia_lai',     name: 'Gia Lai',     province: 'Gia Lai' },
  { slug: 'ha_noi',      name: 'Hà Nội',      province: 'Hà Nội' },
  { slug: 'ha_tinh',     name: 'Hà Tĩnh',     province: 'Hà Tĩnh' },
  { slug: 'hai_phong',   name: 'Hải Phòng',   province: 'Hải Phòng' },
  { slug: 'ho_chi_minh', name: 'Hồ Chí Minh', province: 'Hồ Chí Minh' },
  { slug: 'hue',         name: 'Huế',         province: 'Huế' },
  { slug: 'hung_yen',    name: 'Hưng Yên',    province: 'Hưng Yên' },
  { slug: 'khanh_hoa',   name: 'Khánh Hòa',   province: 'Khánh Hòa' },
  { slug: 'lai_chau',    name: 'Lai Châu',    province: 'Lai Châu' },
  { slug: 'lam_dong',    name: 'Lâm Đồng',    province: 'Lâm Đồng' },
  { slug: 'lang_son',    name: 'Lạng Sơn',    province: 'Lạng Sơn' },
  { slug: 'lao_cai',     name: 'Lào Cai',     province: 'Lào Cai' },
  { slug: 'nghe_an',     name: 'Nghệ An',     province: 'Nghệ An' },
  { slug: 'ninh_binh',   name: 'Ninh Bình',   province: 'Ninh Bình' },
  { slug: 'phu_tho',     name: 'Phú Thọ',     province: 'Phú Thọ' },
  { slug: 'quang_ngai',  name: 'Quảng Ngãi',  province: 'Quảng Ngãi' },
  { slug: 'quang_ninh',  name: 'Quảng Ninh',  province: 'Quảng Ninh' },
  { slug: 'quang_tri',   name: 'Quảng Trị',   province: 'Quảng Trị' },
  { slug: 'son_la',      name: 'Sơn La',      province: 'Sơn La' },
  { slug: 'tay_ninh',    name: 'Tây Ninh',    province: 'Tây Ninh' },
  { slug: 'thai_nguyen', name: 'Thái Nguyên', province: 'Thái Nguyên' },
  { slug: 'thanh_hoa',   name: 'Thanh Hóa',   province: 'Thanh Hóa' },
  { slug: 'tuyen_quang', name: 'Tuyên Quang', province: 'Tuyên Quang' },
  { slug: 'vinh_long',   name: 'Vĩnh Long',   province: 'Vĩnh Long' },
];

// Famous sub-province tourism clusters. lat/lng = rough centroid of the destination,
// radiusKm sized to cover the whole tourism area (not just one ward).
const SUB_AREAS: Destination[] = [
  { slug: 'moc_chau',    name: 'Mộc Châu',    province: 'Sơn La',      lat: 20.84, lng: 104.63, radiusKm: 30 },
  { slug: 'sa_pa',       name: 'Sa Pa',       province: 'Lào Cai',     lat: 22.34, lng: 103.84, radiusKm: 20 },
  { slug: 'hoi_an',      name: 'Hội An',      province: 'Đà Nẵng',     lat: 15.88, lng: 108.34, radiusKm: 10 },
  { slug: 'vung_tau',    name: 'Vũng Tàu',    province: 'Hồ Chí Minh', lat: 10.35, lng: 107.08, radiusKm: 15 },
  { slug: 'phu_quoc',    name: 'Phú Quốc',    province: 'An Giang',    lat: 10.22, lng: 103.96, radiusKm: 30 },
  { slug: 'da_lat',      name: 'Đà Lạt',      province: 'Lâm Đồng',    lat: 11.94, lng: 108.45, radiusKm: 15 },
  { slug: 'nha_trang',   name: 'Nha Trang',   province: 'Khánh Hòa',   lat: 12.24, lng: 109.20, radiusKm: 15 },
  { slug: 'ha_long',     name: 'Hạ Long',     province: 'Quảng Ninh',  lat: 20.96, lng: 107.05, radiusKm: 20 },
  { slug: 'cat_ba',      name: 'Cát Bà',      province: 'Hải Phòng',   lat: 20.73, lng: 107.05, radiusKm: 15 },
  { slug: 'tam_dao',     name: 'Tam Đảo',     province: 'Phú Thọ',     lat: 21.46, lng: 105.64, radiusKm: 10 },
  { slug: 'mai_chau',    name: 'Mai Châu',    province: 'Phú Thọ',     lat: 20.66, lng: 105.07, radiusKm: 15 },
  { slug: 'ha_giang',    name: 'Hà Giang',    province: 'Tuyên Quang', lat: 22.83, lng: 104.98, radiusKm: 40 },
  { slug: 'dong_van',    name: 'Đồng Văn',    province: 'Tuyên Quang', lat: 23.27, lng: 105.36, radiusKm: 20 },
  { slug: 'con_dao',     name: 'Côn Đảo',     province: 'Hồ Chí Minh', lat: 8.69,  lng: 106.61, radiusKm: 15 },
  { slug: 'mui_ne',      name: 'Mũi Né',      province: 'Lâm Đồng',    lat: 10.95, lng: 108.29, radiusKm: 10 },
  { slug: 'phong_nha',   name: 'Phong Nha',   province: 'Quảng Trị',   lat: 17.59, lng: 106.28, radiusKm: 20 },
];

export const DESTINATIONS: Destination[] = [...PROVINCES, ...SUB_AREAS];

// Used by the NLU slot editor's autocomplete datalist.
export const DESTINATION_NAMES: string[] = DESTINATIONS.map((d) => d.name);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve a free-text city string the user typed into a structured destination.
// Exact (normalized) name match wins; otherwise null. The backend will fall back
// to its legacy address-text filter when this returns null.
export function findDestination(query: string): Destination | null {
  if (!query) return null;
  const q = normalize(query);
  return DESTINATIONS.find((d) => normalize(d.name) === q) ?? null;
}

// Helper for constructing the destination-related fields of PlanRequest. If `city` resolves
// to a known destination, returns the structured fields so the backend can filter by
// `place.province` (and optional radius). Otherwise returns just destinationCity.
export function destinationFieldsFor(city: string): {
  destinationCity: string;
  destinationProvince?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationRadiusKm?: number;
} {
  const hit = findDestination(city);
  if (!hit) return { destinationCity: city };
  return {
    destinationCity: hit.name,
    destinationProvince: hit.province,
    destinationLat: hit.lat,
    destinationLng: hit.lng,
    destinationRadiusKm: hit.radiusKm,
  };
}

// Variant for ParsedNLPResult — prefers the NLU's structured province/kind output
// (Option B). Falls back to fuzzy name lookup when those fields are absent (local
// fallback parser, legacy stored trips). Lat/lng/radius always come from the local
// destinations table since the backend NLU doesn't return coordinates.
export function destinationFieldsFromParsed(parsed: {
  destinationCity: string;
  destinationProvince?: string | null;
  destinationKind?: 'province' | 'subArea' | null;
}): {
  destinationCity: string;
  destinationProvince?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationRadiusKm?: number;
} {
  const fromName = findDestination(parsed.destinationCity);
  // If frontend table resolves the city → trust it fully (canonical name + coords).
  if (fromName) {
    return {
      destinationCity: fromName.name,
      destinationProvince: fromName.province,
      destinationLat: fromName.lat,
      destinationLng: fromName.lng,
      destinationRadiusKm: fromName.radiusKm,
    };
  }
  // Otherwise, use NLU-provided province if any (no coords available).
  if (parsed.destinationProvince) {
    return {
      destinationCity: parsed.destinationCity,
      destinationProvince: parsed.destinationProvince,
    };
  }
  return { destinationCity: parsed.destinationCity };
}
