const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '..', 'data', 'seed_tien_ich_cong_cong.sql');
const lines = fs.readFileSync(sqlPath, 'utf8').split('\n');
const newLines = [];

// Đếm số lượng thay đổi để hiển thị cho user
let removedAtms = 0;
let restoredNames = 0;

lines.forEach(l => {
    if (!l.startsWith('INSERT')) {
        newLines.push(l);
        return;
    }
    
    const typeMatch = l.match(/'(atm|fuel|toilets|parking)'/);
    const loai = typeMatch ? typeMatch[1] : '';
    
    // Kiểm tra xem trường tên có đang là NULL không
    const isNull = l.includes(', NULL, ');
    
    if (isNull) {
        if (loai === 'atm') {
            // Bỏ qua (xóa) cây ATM không có tên ngân hàng
            removedAtms++;
            return;
        } else {
            // Đặt lại tên bình thường cho các loại khác
            let generic = 'Tiện ích';
            if (loai === 'fuel') generic = 'Trạm xăng';
            if (loai === 'parking') generic = 'Bãi đỗ xe';
            if (loai === 'toilets') generic = 'Nhà vệ sinh công cộng';
            
            const newlyFormattedLine = l.replace(', NULL, ', `, '${generic}', `);
            newLines.push(newlyFormattedLine);
            restoredNames++;
        }
    } else {
        // Trường hợp tên bình thường (hoặc ATM có tên ngân hàng) -> giữ nguyên
        // Nhưng cần check luôn phòng hờ trường hợp còn sót chữ 'ATM' (viết hoa/viết thường)
        if (loai === 'atm') {
            const nameMatch = l.match(/VALUES \('[^']+', '([^']+)'/);
            if (nameMatch && nameMatch[1].trim() === 'ATM') {
                removedAtms++;
                return;
            }
        }
        newLines.push(l);
    }
});

fs.writeFileSync(sqlPath, newLines.join('\n'));
console.log(`Đã xử lý xong!`);
console.log(`- Xóa ${removedAtms} cây ATM nội bộ vô danh.`);
console.log(`- Trả lại tên mặc định cho ${restoredNames} tiện ích (Xăng, Bãi đỗ xe, Nhà vệ sinh).`);
console.log(`- Tổng số lệnh INSERT còn lại: ${newLines.filter(x => x.startsWith('INSERT')).length}`);
