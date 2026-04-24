# 🛰️ Module Giám Sát Chuyến Đi - Người 5

## 🛠️ Cài đặt
1. Cài đặt thư viện: `npm install express axios node-cron`
2. Chạy module: `node monitor.js`
3. Truy cập Dashboard: `http://localhost:3000`

## 📋 Chức năng đã hoàn thành
- **Ngày 1:** Cron Job 30p tự động quét thời tiết từ API thực.
- **Ngày 2:** 4 bộ thu thập tín hiệu (Mưa, Kẹt xe, Đóng cửa, Sức khỏe).
- **Ngày 3:** Module tính tầm ảnh hưởng lọc ID địa điểm bị tác động.
- **Ngày 4:** Giao diện giả lập sự cố phục vụ Demo.
- **Ngày 5:** API Polling sẵn sàng kết nối với Module Re-plan của Người 6.

## 🔌 API Endpoint (Dành cho Người 6)
`GET http://localhost:3000/api/check-incident`







## 🛠️ HƯỚNG DẪN KIỂM THỬ (DEBUG & TEST GUIDE)

Dành cho người kiểm thử hoặc phát triển muốn kiểm tra logic hệ thống mà không cần đợi điều kiện thực tế. Thực hiện các thay đổi nhỏ sau trong file `monitor.js`:

### 1. Kiểm tra "Giác quan" Thời tiết (Weather Impact)
* **Vị trí:** Trong hàm `collectWeatherData()`.
* **Thao tác:** Bỏ dấu comment `//` ở dòng `rain = 10;`.
* **Mục tiêu:** Ép hệ thống tin rằng đang mưa cực lớn để kiểm tra khả năng tự động lọc các địa điểm ngoài trời (`S1`, `S2`).

### 2. Kiểm tra "Giác quan" Thời gian (Closing Soon)
* **Vị trí:** Trong mảng `currentTrip.slots`.
* **Thao tác:** Sửa `closeTime` của một địa điểm (ví dụ Ngũ Hành Sơn) thành một con số nhỏ hơn giờ hiện tại (ví dụ: `8`).
* **Mục tiêu:** Kiểm tra xem hệ thống có phát hiện địa điểm đã đóng cửa ngay khi khởi động hay không.

### 3. Kiểm tra "Giác quan" Giao thông (Traffic/Delay)
* **Vị trí:** Trong biến `currentState`.
* **Thao tác:** Sửa `plannedArrivalTime` thành một giờ rất sớm (ví dụ: `8`).
* **Mục tiêu:** Khi chạy code vào buổi chiều, hệ thống tính toán độ trễ lớn và tự động kích hoạt trạng thái "Kẹt xe" cùng hiệu ứng Domino ảnh hưởng toàn bộ lịch trình.

### 4. Kiểm tra "Giác quan" Sức khỏe (Fatigue Heuristic)
* **Vị trí:** Trong biến `currentState`.
* **Thao tác:** Thay đổi `currentSlotIndex` từ `1` lên `3`.
* **Mục tiêu:** Kiểm tra thuật toán Heuristic. Khi ở cuối lịch trình, chỉ số mệt mỏi sẽ tự động tăng cao hơn so với khi ở đầu lịch trình.

---
**Lưu ý:** Sau khi kiểm thử xong, vui lòng hoàn tác (Undo) các thay đổi hoặc tải lại file gốc để hệ thống quay về chế độ thu thập dữ liệu thực tế.