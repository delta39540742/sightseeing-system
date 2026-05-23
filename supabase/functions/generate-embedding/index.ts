import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0';

// Khởi tạo Pipeline ở global scope để Deno cache nó trên mây (giữ model trên RAM của Supabase)
let generateEmbedding: any = null;

serve(async (req) => {
  // Bỏ qua CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    } });
  }

  try {
    const { input } = await req.json();
    
    if (!input) {
      return new Response(JSON.stringify({ error: 'Missing input text' }), { 
        status: 400, 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } 
      });
    }

    if (!generateEmbedding) {
      // Sử dụng model cũ để tương thích 100% với Vector 384 chiều tiếng Việt đã có trong DB
      generateEmbedding = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    }

    // Nếu input là mảng thì xử lý hàng loạt, nếu là string thì xử lý đơn
    const texts = Array.isArray(input) ? input : [input];
    
    // Tính toán Vector
    const output = await generateEmbedding(texts, { pooling: 'mean', normalize: true });
    
    // Convert Float32Array sang mảng 2 chiều để trả về JSON
    const dims = output.dims;
    const batch = dims[0];
    const dim = dims[1];
    const result = [];
    for (let i = 0; i < batch; i++) {
      result.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
    }

    return new Response(
      JSON.stringify({ embeddings: result }),
      { 
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        status: 200 
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
