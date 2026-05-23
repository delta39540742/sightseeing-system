// Singleton embedding pipeline offloaded to Hugging Face Inference API.
// Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dim, hỗ trợ tiếng Việt).
// Rendering Node.js Server RAM is conserved since model runs on Hugging Face.

export const EMBEDDING_DIM = 384;

// Disable embedding entirely if needed (e.g. for testing)
const EMBEDDING_ENABLED = process.env.EMBEDDING_ENABLED !== 'false';

// Sử dụng model gốc trên Hugging Face
const HF_MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
const HF_API_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || '';

async function callHuggingFace(texts: string | string[]): Promise<number[][]> {
  if (!HUGGINGFACE_API_KEY) {
    console.warn('[embedding] Thiếu HUGGINGFACE_API_KEY trong .env! Chức năng Semantic Search sẽ bị vô hiệu hóa.');
    return Array.isArray(texts) ? texts.map(() => new Array(EMBEDDING_DIM).fill(0)) : [new Array(EMBEDDING_DIM).fill(0)];
  }

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
    },
    body: JSON.stringify({ inputs: texts }),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face API trả về lỗi ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  
  // HF Feature Extraction pipeline for this model usually returns shape [batch_size, sequence_length, embedding_dim] or [batch_size, embedding_dim]
  // With `sentence-transformers`, it usually returns [batch_size, embedding_dim] directly or a flat array for single string
  // Let's normalize it to number[][]
  let vectors: number[][] = [];
  if (Array.isArray(texts)) {
    vectors = data;
  } else {
    vectors = [data];
  }
  
  return vectors;
}

/**
 * Embed một text → vector 384 chiều.
 */
export async function embedText(text: string): Promise<number[]> {
  if (!EMBEDDING_ENABLED || !text || !text.trim()) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  
  try {
    const vectors = await callHuggingFace(text);
    return vectors[0];
  } catch (err) {
    console.error('[embedding] embedText failed:', err);
    return new Array(EMBEDDING_DIM).fill(0);
  }
}

/**
 * Batch embed — truyền mảng Text cho API tính 1 lần.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!EMBEDDING_ENABLED || texts.length === 0) return texts.map(() => new Array(EMBEDDING_DIM).fill(0));
  
  try {
    return await callHuggingFace(texts);
  } catch (err) {
    console.error('[embedding] embedTexts failed:', err);
    return texts.map(() => new Array(EMBEDDING_DIM).fill(0));
  }
}

/**
 * Format vector → literal pgvector để truyền qua raw SQL: '[0.1,0.2,...]'
 */
export function vectorToSqlLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Warm up model ngay khi server khởi động — tránh user đầu tiên phải chờ 30s.
 * Gọi không-await trong server bootstrap.
 */
export async function warmUpEmbedding(): Promise<void> {
  if (!EMBEDDING_ENABLED) return;
  try {
    await embedText('khởi tạo model embedding');
  } catch (err) {
    // Không block server nếu warmup fail; sẽ retry lần gọi đầu thật sự.
    console.warn('[embedding] warmup failed:', (err as Error).message);
  }
}
