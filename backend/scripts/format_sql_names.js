const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '..', 'data', 'seed_tien_ich_cong_cong.sql');
let sql = fs.readFileSync(sqlPath, 'utf8');
const lines = sql.split('\n');
const newLines = [];

// Các tên bị coi là chung chung, sẽ bị set thành NULL
const genericNames = [
    'ATM',
    'Trạm xăng',
    'Bãi đỗ xe',
    'Bãi đỗ xe ngầm',
    'Bãi đỗ xe nhiều tầng',
    'Bãi đỗ xe tầng thượng',
    'Nhà vệ sinh công cộng',
    'Nhà vệ sinh (dành cho khách)',
    'Nhà vệ sinh',
    'Cửa hàng Xăng dầu'
];

lines.forEach(l => {
    if (!l.startsWith('INSERT')) {
        newLines.push(l);
        return;
    }

    // Lấy ID
    const pkMatch = l.match(/'osm_[a-z]+_[0-9]+'/);
    if (!pkMatch) {
        newLines.push(l);
        return;
    }
    const pk = pkMatch[0].replace(/'/g, '');

    // Lấy loại tiện ích (atm/fuel/toilets/parking)
    const typeMatch = l.match(/'(atm|fuel|toilets|parking)'/);
    const loai = typeMatch ? typeMatch[1] : '';

    // Lấy tọa độ cuối cùng xuất hiện trong chuỗi (đề phòng có nhiều tọa độ bị double)
    const coordsMatches = l.match(/([0-9]+\.[0-9]+), ([0-9]+\.[0-9]+)/g);
    let lon = '', lat = '';
    if (coordsMatches) {
        const parts = coordsMatches[coordsMatches.length - 1].split(', ');
        lon = parts[0];
        lat = parts[1];
    }

    // Trích xuất Tên (giữa ID và loai), lấy cụm '' hoặc NULL
    let ten = 'NULL';
    const nameMatch = l.match(/VALUES \([^,]+, (?:'((?:[^']|'')*)'|NULL)/);
    if (nameMatch && nameMatch[1]) {
        ten = nameMatch[1].replace(/''/g, "'");
        
        // Loại bỏ phần địa chỉ sau dấu ' - '
        if (ten.includes(' - ')) {
            ten = ten.split(' - ')[0].trim();
        }
        
        // Kiểm tra xem tên có bị trùng tên chung chung hay không
        if (genericNames.includes(ten) || ten.toLowerCase() === 'xăng' || ten.toLowerCase() === 'wc') {
            ten = 'NULL';
        }
    }

    // Format lại tên cho SQL
    let pTen = ten === 'NULL' ? 'NULL' : "'" + ten.replace(/'/g, "''") + "'";

    newLines.push(`INSERT INTO tien_ich_cong_cong (id, ten, loai_tien_ich, kinh_do, vi_do) VALUES ('${pk}', ${pTen}, '${loai}', ${lon}, ${lat}) ON CONFLICT (id) DO NOTHING;`);
});

fs.writeFileSync(sqlPath, newLines.join('\n'));
console.log('Fixed SQL file perfectly! Total lines:', newLines.length);
