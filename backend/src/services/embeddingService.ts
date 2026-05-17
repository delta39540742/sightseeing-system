// Singleton embedding pipeline dùng @xenova/transformers (ONNX runtime, không cần Python).
// Model: paraphrase-multilingual-MiniLM-L12-v2 (384 dim, ~120MB, hỗ trợ tiếng Việt).
//
// Lazy-load ở lần gọi đầu tiên: tải model về cache (~30s lần đầu), sau đó embed
// một câu < 50ms trên CPU.

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const EMBEDDING_DIM = 384;

// Disable embedding on free-tier production to avoid OOM (model ~120MB).
const EMBEDDING_ENABLED = process.env.EMBEDDING_ENABLED === 'true' || process.env.NODE_ENV !== 'production';

type FeatureExtractionPipeline = (
  texts: string | string[],
  opts?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import vì @xenova/transformers là ESM-only
      const { pipeline, env } = await import('@xenova/transformers');
      // Tắt remote nếu đã có cache local; cho phép tải nếu chưa có
      env.allowRemoteModels = true;
      return (await pipeline('feature-extraction', MODEL_ID)) as unknown as FeatureExtractionPipeline;
    })();
  }
  return pipelinePromise;
}

/**
 * Embed một text → vector 384 chiều (đã normalize, dùng cosine).
 */
export async function embedText(text: string): Promise<number[]> {
  if (!EMBEDDING_ENABLED || !text || !text.trim()) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Batch embed — nhanh hơn loop từng câu.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!EMBEDDING_ENABLED || texts.length === 0) return texts.map(() => new Array(EMBEDDING_DIM).fill(0));
  const pipe = await getPipeline();
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  // output.dims = [batch, dim]
  const [batch, dim] = output.dims;
  const result: number[][] = [];
  for (let i = 0; i < batch; i++) {
    result.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return result;
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
