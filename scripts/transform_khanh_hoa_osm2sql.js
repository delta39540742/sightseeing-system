const fs = require('fs');
const path = require('path');

const RAW_FILE = path.join(__dirname, '..', 'data', 'raw_khanh_hoa_osm.json');
const OUT_FILE = path.join(__dirname, '..', 'data', 'seed_khanh_hoa_osm.sql');

// Helper escape SQL strings (' -> '')
function escapeSql(str) {
    if (!str) return 'NULL';
    return "'" + str.replace(/'/g, "''") + "'";
}

function processElements(elements) {
    let sqlStatements = [];

    // Tạo bảng nếu chưa có (theo travel_schema.md)
    sqlStatements.push(`
-- Khởi tạo bảng dia_diem
CREATE TABLE IF NOT EXISTS dia_diem (
    ma_dia_diem VARCHAR(100) PRIMARY KEY,
    ten VARCHAR(255),
    kinh_do DECIMAL(10, 7),
    vi_do DECIMAL(10, 7),
    loai_dia_diem VARCHAR(50),
    thoi_gian_mo TIME NULL,
    thoi_gian_dong TIME NULL,
    dac_trung_dia_diem TEXT[],
    thoi_diem_ghi_nhan TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

`);

    // INSERT statements
    let count = 0;
    elements.forEach(el => {
        if (!el.tags) return;
        
        // Cần có tên để hiển thị
        if (!el.tags.name) return;

        // Mã địa điểm (Prefix osm_node_ / osm_way_ để ko trùng)
        const id = `osm_${el.type}_${el.id}`;
        
        // Tọa độ
        const lat = el.lat || (el.center && el.center.lat) || null;
        const lon = el.lon || (el.center && el.center.lon) || null;
        if (!lat || !lon) return;

        // Phân loại (Tham Quan vs Ăn Uống)
        let type = 'khac';
        
        // Define known amenities
        const foodAmenities = ['restaurant', 'cafe', 'food_court', 'fast_food', 'bar', 'pub'];
        const tourismTags = ['museum', 'attraction', 'viewpoint', 'zoo', 'theme_park', 'gallery'];
        
        if (el.tags.amenity && foodAmenities.includes(el.tags.amenity)) {
            type = 'an_uong';
        } else if (el.tags.shop && ['bakery', 'pastry'].includes(el.tags.shop)) {
            type = 'an_uong';
        } else if (el.tags.tourism || el.tags.historic || (el.tags.leisure && ['park', 'water_park', 'nature_reserve'].includes(el.tags.leisure))) {
            type = 'tham_quan';
        } else {
            // Fallback for hardcoded famous landmarks in Khanh Hoa
            const nameLower = el.tags.name.toLowerCase();
            if (nameLower.includes('ponagar') || nameLower.includes('vinwonders') || nameLower.includes('hòn chồng') || nameLower.includes('chùa long sơn') || nameLower.includes('tháp bà') || nameLower.includes('bãi dài') || nameLower.includes('nha trang beach')) {
                 type = 'tham_quan';
            } else if (nameLower.includes('nem nướng') || nameLower.includes('bún chả cá') || nameLower.includes('hải sản')) {
                 type = 'an_uong';
            }
        }

        // Tags bổ sung thành array (PostgreSQL format: ARRAY['tag1', 'tag2'])
        let dacTrung = [];
        if (el.tags.cuisine) dacTrung.push('cuisine:' + el.tags.cuisine);
        if (el.tags.historic) dacTrung.push('historic:' + el.tags.historic);
        if (el.tags.tourism) dacTrung.push('tourism:' + el.tags.tourism);
        if (el.tags.amenity) dacTrung.push('amenity:' + el.tags.amenity);
        if (el.tags.leisure) dacTrung.push('leisure:' + el.tags.leisure);
        if (el.tags.shop) dacTrung.push('shop:' + el.tags.shop);
        
        const dacTrungSql = dacTrung.length > 0 
            ? "ARRAY[" + dacTrung.map(t => escapeSql(t)).join(', ') + "]::TEXT[]" 
            : 'NULL';

        const nameSql = escapeSql(el.tags.name);
        
        let thoiGianMoSql = 'NULL';
        let thoiGianDongSql = 'NULL';

        sqlStatements.push(`INSERT INTO dia_diem (ma_dia_diem, ten, kinh_do, vi_do, loai_dia_diem, thoi_gian_mo, thoi_gian_dong, dac_trung_dia_diem) VALUES ('${id}', ${nameSql}, ${lon}, ${lat}, '${type}', ${thoiGianMoSql}, ${thoiGianDongSql}, ${dacTrungSql}) ON CONFLICT (ma_dia_diem) DO NOTHING;`);
        count++;
    });

    console.log(`Generated ${count} INSERT statements.`);
    return sqlStatements.join('\n');
}

function main() {
    console.log("Reading raw Khanh Hoa data...");
    if (!fs.existsSync(RAW_FILE)) {
        console.error("raw_khanh_hoa_osm.json not found! Please run fetch_osm_khanh_hoa.js first.");
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
    
    if (!rawData.elements || rawData.elements.length === 0) {
        console.error("No elements found in raw data.");
        return;
    }

    console.log("Transforming Khanh Hoa data to SQL...");
    const sqlContent = processElements(rawData.elements);

    fs.writeFileSync(OUT_FILE, sqlContent, 'utf8');
    console.log(`Successfully generated PostgreSQL script at: ${OUT_FILE}`);
}

main();
