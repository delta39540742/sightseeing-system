require('dotenv').config();
const { embedText } = require('../services/embeddingService');

async function testEdge() {
  console.log("Đang gọi Hugging Face API để nhúng văn bản...");
  const start = Date.now();
  const vector = await embedText("chỗ tắm biển cát trắng");
  const end = Date.now();
  
  console.log(`Hoàn thành trong ${end - start}ms!`);
  console.log(`Độ dài Vector nhận được: ${vector.length}`);
  console.log(`5 chiều đầu tiên: ${vector.slice(0, 5).map(n => n.toFixed(4)).join(', ')}`);
  
  if (vector.length === 384 && vector[0] !== 0) {
    console.log("✅ HUGGING FACE API ĐANG HOẠT ĐỘNG HOÀN HẢO!");
  } else {
    console.log("❌ HUGGING FACE API KHÔNG HOẠT ĐỘNG HOẶC TRẢ VỀ TOÀN SỐ 0");
  }
}

testEdge().catch(console.error);
