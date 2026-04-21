import axios, { AxiosError } from "axios";

// --- TYPES ---

export type GroupType = "solo" | "couple" | "family" | "friends" | "business";

export interface NluSlots {
  destinationCity: string | null;
  durationDays: number | null;
  startDate: string | null;
  preferredTagNames: string[];
  budgetTotal: number | null;
  groupType: GroupType | null;
  mobilityRestrictions: string[];
  dietaryPreferences: string[];
  pace: number | null;
}

export interface NluParseRequest {
  prompt: string;
}

export interface NluParseResponse {
  slots: NluSlots;
  missingSlots: string[];
  confidence: number;
}

// --- CONFIG ---

// Đọc từ .env: COLAB_NLU_URL=https://storeroom-rewrap-doable.ngrok-free.dev
// (hoặc bất kỳ ngrok tunnel nào bạn đang chạy Colab)
const COLAB_NLU_URL = process.env.COLAB_NLU_URL;

const COLAB_TIMEOUT_MS = 30_000; // Colab chậm, cần thời gian

// --- MAIN PROXY FUNCTION ---

export async function parseNlu(prompt: string): Promise<NluParseResponse> {
  if (!COLAB_NLU_URL) {
    throw new NluUnavailableError("COLAB_NLU_URL chưa được set trong file .env");
  }

  const url = `${COLAB_NLU_URL.replace(/\/$/, "")}/api/nlu/parse`;

  let raw: unknown;

  try {
    const res = await axios.post<unknown>(
      url,
      { prompt } satisfies NluParseRequest,
      {
        timeout: COLAB_TIMEOUT_MS,
        headers: { "Content-Type": "application/json" },
      }
    );
    raw = res.data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    throw new NluUnavailableError(
      `Colab tunnel unreachable: ${axiosErr.message}`
    );
  }

  // --- Validate & normalise Colab response ---
  if (!isObject(raw)) {
    throw new NluUnavailableError("Colab returned non-object response.");
  }

  if ("error" in raw) {
    throw new NluUnavailableError(
      `Colab NLU error: ${(raw as Record<string, unknown>).error}`
    );
  }

  return normalise(raw as Record<string, unknown>);
}

// --- NORMALISE RESPONSE ---

function normalise(raw: Record<string, unknown>): NluParseResponse {
  const rawSlots = isObject(raw.slots) ? (raw.slots as Record<string, unknown>) : {};

  const slots: NluSlots = {
    destinationCity: stringOrNull(rawSlots.destinationCity),
    durationDays: numberOrNull(rawSlots.durationDays),
    startDate: stringOrNull(rawSlots.startDate),
    preferredTagNames: stringArray(rawSlots.preferredTagNames),
    budgetTotal: numberOrNull(rawSlots.budgetTotal),
    groupType: asGroupType(rawSlots.groupType),
    mobilityRestrictions: stringArray(rawSlots.mobilityRestrictions),
    dietaryPreferences: stringArray(rawSlots.dietaryPreferences),
    pace: numberOrNull(rawSlots.pace),
  };

  return {
    slots,
    missingSlots: stringArray(raw.missingSlots),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

// --- CUSTOM ERROR ---

export class NluUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NluUnavailableError";
  }
}

// ─────────────────────────────────────────────────────────────
// ──────────────── EXPRESS / NEXT.JS ROUTE HANDLER ─────────────
// (đã tích hợp hoàn chỉnh - chỉ copy-paste vào file route)
// ─────────────────────────────────────────────────────────────

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