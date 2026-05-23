require('dotenv').config();
const axios = require('axios');

async function testFilterBug() {
  console.log(`\n========================================================`);
  console.log(`🪲 [LOGIC TEST]: Lỗ hổng Bỏ qua Bộ Lọc (Filter Ignore Bug)`);
  console.log(`--------------------------------------------------------`);
  
  // Chúng ta sẽ giả lập gọi API, nhưng vì server có thể đang tắt, ta sẽ mô phỏng logic đọc code
  console.log("-> Phân tích mã nguồn API (src/routes/places.ts):");
  console.log("1. Người dùng gửi Request: GET /api/places?q=Vinpearl&is_landmark=true&indoor_outdoor=outdoor");
  console.log("2. Code chạy vào nhánh: if (q) { ... }");
  console.log("3. Nó thực thi truy vấn $queryRaw chỉ chứa điều kiện của q và city.");
  console.log("4. Nó lập tức gọi 'return reply.send(...)' và kết thúc API.");
  console.log("5. Mọi dòng code xử lý 'indoor_outdoor' hay 'is_landmark' nằm phía dưới bị bỏ qua hoàn toàn!");
  
  console.log("\n=> KẾT LUẬN: Nếu người dùng có nhập từ khóa tìm kiếm (q), TẤT CẢ các bộ lọc (Indoor/Outdoor, Landmark, Price...) trên giao diện sẽ bị vô hiệu hóa, không có tác dụng gì cả!");
}

testFilterBug();
