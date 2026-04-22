import express from "express"; // hoặc import { NextRequest, NextResponse } from "next/server";

const router = express.Router(); // ← Dùng cho Express
// Hoặc dùng Next.js API route: export async function POST(req: NextRequest)

router.post("/api/nlu/parse", async (req, res) => {
  try {
    const { prompt } = req.body as NluParseRequest;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ error: "PROMPT_IS_EMPTY" });
    }

    // Gọi AI (Colab tunnel) và trả về ngay cho FE
    const result = await parseNlu(prompt.trim());

    return res.json(result); // Trả về đúng format NluParseResponse
  } catch (err) {
    if (err instanceof NluUnavailableError) {
      // FE sẽ nhận thông báo thân thiện
      return res.status(503).json({
        error: "AI đang bảo trì, hãy điền tay",
      });
    }

    console.error("NLU parse error:", err);
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;

// --- HELPERS ---

function isObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

const VALID_GROUP_TYPES: GroupType[] = [
  "solo",
  "couple",
  "family",
  "friends",
  "business",
];

function asGroupType(v: unknown): GroupType | null {
  if (typeof v === "string" && (VALID_GROUP_TYPES as string[]).includes(v)) {
    return v as GroupType;
  }
  return null;
}