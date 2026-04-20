// Thư viện queries chuẩn OSM cho khu vực TP Hồ Chí Minh

// Bounding box cho trung tâm/phạm vi TP HCM (có thể điều chỉnh)
// Dạng: (south, west, north, east)
const HCMC_BBOX = "10.700,106.600,10.900,106.850"; 

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Query lấy dữ liệu Du lịch (Tham quan) và Ăn uống
// tourism=museum, attraction, viewpoint, zoo, theme_park, gallery
// amenity=restaurant, cafe, food_court
// Chỉ lấy NWS (node, way, relation), out center để tự động tính trọng tâm cho way/relation
const getQuery = (bbox) => `
[out:json][timeout:120];
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
  
  // Bắt buộc lấy các địa danh cụ thể nổi tiếng nếu tag bị lọt (fallback)
  node["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|Huỳnh Hoa",i](${bbox});
  way["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|Huỳnh Hoa",i](${bbox});
  relation["name"~"Landmark 81|Bitexco|Bến Thành|Đức Bà|Suối Tiên|Đầm Sen|Huỳnh Hoa",i](${bbox});
);
out center;
`;

module.exports = {
    HCMC_BBOX,
    OVERPASS_URL,
    getQuery
};
