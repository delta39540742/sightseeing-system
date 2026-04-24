const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
const port = 3000;

app.use(express.json()); // Để nhận dữ liệu JSON từ các module khác

// ==========================================
// 1. CẤU HÌNH MẶC ĐỊNH (PHỤC VỤ TEST 1 MÌNH)
// ==========================================
const API_KEY = 'b040ba7e9a429e01a4b3ba506dfc3ed5'; 
let LAT = 16.047079; 
let LON = 108.206230;

let currentTrip = {
    tripId: "SAMPLE_TRIP_DN",
    slots: [
        { id: "S1", name: "Bãi biển Mỹ Khê", type: "outdoor", closeTime: 18 },
        { id: "S2", name: "Ngũ Hành Sơn", type: "outdoor", closeTime: 17 },
        { id: "S3", name: "Bảo tàng 3D", type: "indoor", closeTime: 21 },
        { id: "S4", name: "Ăn tối", type: "indoor", closeTime: 22 }
    ]
};

let currentState = {
    currentSlotIndex: 1, 
    plannedArrivalTime: 17 
};

let lastAlert = null;

// ==========================================
// 2. API ĐỂ LINH ĐỘNG (DÙNG CHO DỰ ÁN THẬT)
// ==========================================

// Endpoint để Người 1 hoặc Người 4 cập nhật lịch trình bất kỳ lúc nào
app.post('/api/sync-trip', (req, res) => {
    const { tripData, state, location } = req.body;
    
    if (tripData) currentTrip = tripData;
    if (state) currentState = state;
    if (location) {
        LAT = location.lat;
        LON = location.lon;
    }

    console.log("🔄 [Hệ thống] Đã đồng bộ dữ liệu mới. Bắt đầu giám sát...");
    runMonitoring(); // Chạy quét ngay lập tức khi có dữ liệu mới
    res.json({ message: "Đồng bộ thành công", monitoring: currentTrip.tripId });
});

// ==========================================
// 3. LOGIC GIÁM SÁT & PHÂN TÍCH
// ==========================================

function analyzeImpact(type, reason, severity) {
    const futureSlots = currentTrip.slots.slice(currentState.currentSlotIndex);
    let affectedIds = [];

    switch (type) {
        case 'rain_heavy':
            affectedIds = futureSlots.filter(s => s.type === 'outdoor').map(s => s.id);
            break;
        case 'traffic_jam':
            affectedIds = futureSlots.map(s => s.id);
            break;
        case 'closing_soon':
            if (futureSlots.length > 0) affectedIds = [futureSlots[0].id];
            break;
        case 'user_tired':
            affectedIds = futureSlots.slice(0, 2).map(s => s.id);
            break;
    }

    lastAlert = {
        type,
        reason,
        severity: parseFloat(severity.toFixed(2)),
        affectedSlotIds: affectedIds,
        timestamp: new Date().toLocaleString('vi-VN')
    };
    console.log(`⚠️  PHÁT HIỆN SỰ CỐ: [${type.toUpperCase()}] - ${reason}`);
}

// --- Các hàm thu thập dữ liệu ---

async function collectWeatherData() {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&appid=${API_KEY}&units=metric`;
        const res = await axios.get(url);
        let rain = res.data.rain ? res.data.rain['1h'] : 0;
        
        console.log(`[Weather] 🌧️ Kiểm tra mưa: ${rain}mm/h (Tọa độ: ${LAT.toFixed(2)}, ${LON.toFixed(2)})`);
        if (rain >= 5) analyzeImpact('rain_heavy', `Mưa lớn thực tế: ${rain}mm/h`, 0.8);
    } catch (e) { console.log("⚠️ [Weather] Lỗi API"); }
}

function collectTrafficData(isManual = false) {
    const now = new Date().getHours();
    const delay = now - currentState.plannedArrivalTime;
    // Nếu trễ quá 12h (ví dụ đang đêm check lịch chiều) thì coi như không trễ để tránh báo ảo
    const realDelay = (delay > -12 && delay < 12) ? delay : 0; 
    
    console.log(`[Traffic] 🚗 Kiểm tra trễ: ${isManual ? '45' : (realDelay * 60).toFixed(0)} phút`);
    if (isManual || realDelay > 0.5) {
        analyzeImpact('traffic_jam', `Trễ lịch trình: ${isManual ? '45' : (realDelay * 60).toFixed(0)} phút`, 0.7);
    }
}

function collectClosingData() {
    const now = new Date().getHours();
    const nextSlot = currentTrip.slots[currentState.currentSlotIndex];
    
    if (nextSlot) {
        console.log(`[Status] 🕒 Kiểm tra đóng cửa: ${nextSlot.name} (${nextSlot.closeTime}h). Hiện tại: ${now}h`);
        // Chỉ báo nếu sắp đóng (trong vòng 1h tới) và chưa qua giờ đóng
        if (now < nextSlot.closeTime && (now + 1) >= nextSlot.closeTime) {
            analyzeImpact('closing_soon', `${nextSlot.name} sắp đóng cửa!`, 0.9);
        }
    }
}

function runMonitoring() {
    console.log("\n--- 🛰️ ĐANG QUÉT HỆ THỐNG (" + new Date().toLocaleTimeString() + ") ---");
    collectWeatherData();
    collectTrafficData();
    collectClosingData();
    if (!lastAlert) console.log("✅ Trạng thái: Hệ thống ổn định.");
}

// ==========================================
// 4. API ĐIỀU KHIỂN & DEMO
// ==========================================

app.get('/api/trigger', (req, res) => {
    const { action } = req.query;
    if (action === 'mua') analyzeImpact('rain_heavy', "Giả lập cảm biến báo mưa 10mm/h", 0.8);
    if (action === 'tre') collectTrafficData(true);
    if (action === 'clear') { lastAlert = null; console.log("🔄 Reset hệ thống."); }
    res.send("OK");
});

app.get('/api/check-incident', (req, res) => res.json(lastAlert || { status: "Ổn định" }));

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

cron.schedule('*/30 * * * *', runMonitoring);

app.listen(port, () => {
    console.log(`🚀 MODULE NGƯỜI 5 ĐANG CHẠY TẠI PORT ${port}`);
    runMonitoring();
});