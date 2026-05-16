// Thư viện queries chuẩn OSM cho khu vực TP Hồ Chí Minh và các tỉnh thành khác

// Bounding box cho trung tâm/phạm vi TP HCM (có thể điều chỉnh)
// Dạng: (south, west, north, east)
const HCMC_BBOX = "10.700,106.600,10.900,106.850"; 

// Bounding box cho tỉnh Khánh Hòa
const KHANH_HOA_BBOX = "11.7139,108.6758,12.8708,109.4653";

// Bounding box cho tỉnh An Giang
const AN_GIANG_BBOX = "10.175,104.767,10.95,105.586";

// Bounding box cho Vũng Tàu (Thành phố)
const VUNG_TAU_BBOX = "10.30,107.00,10.55,107.25";

// Bounding box cho tỉnh Bắc Giang
const BAC_GIANG_BBOX = "21.15,106.10,21.75,107.05";




const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Query lấy dữ liệu Du lịch (Tham quan) và Ăn uống
// tourism=museum, attraction, viewpoint, zoo, theme_park, gallery
// amenity=restaurant, cafe, food_court
// Chỉ lấy NWS (node, way, relation), out center để tự động tính trọng tâm cho way/relation
const getQuery = (bbox) => `
[out:json][timeout:180];
(
  // Tham quan (Tourism)
  node["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](${bbox});
  way["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](${bbox});
  relation["tourism"~"museum|attraction|viewpoint|zoo|theme_park|gallery"](${bbox});
  
  node["historic"](${bbox}); // Di tích lịch sử
  way["historic"](${bbox});
  
  // Công viên, khu vui chơi
  node["leisure"~"park|water_park|nature_reserve"](${bbox});
  way["leisure"~"park|water_park|nature_reserve"](${bbox});
  
  // Quán ăn (Food/Beverage)
  node["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](${bbox});
  way["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](${bbox});
  relation["amenity"~"restaurant|cafe|food_court|fast_food|bar|pub"](${bbox});
  
  // Tiệm bánh (Bread/Bakery like Bánh mì Huỳnh Hoa)
  node["shop"~"bakery|pastry"](${bbox});
  way["shop"~"bakery|pastry"](${bbox});
  
  // Các địa danh cụ thể nổi tiếng (fallback)
  node["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|VinWonders|Ponagar|Hòn Chồng",i](${bbox});
  way["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|VinWonders|Ponagar|Hòn Chồng",i](${bbox});
  relation["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|VinWonders|Ponagar|Hòn Chồng",i](${bbox});
);
out center;
`;

module.exports = {
    HCMC_BBOX,
    KHANH_HOA_BBOX,
    AN_GIANG_BBOX,
    VUNG_TAU_BBOX,
    BAC_GIANG_BBOX,
    OVERPASS_URL,
    getQuery
};
