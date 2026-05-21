import axios, { AxiosError } from "axios";

// --- TYPES ---

export type GroupType = "solo" | "couple" | "family" | "friends" | "business";

export interface NluSlots {
  destinationCity: string | null;
  durationDays: number | null;
  startDate: string | null;
  preferredTagNames: string[];
  experienceKeywords: string[];
  budgetTotal: number | null;
  groupType: GroupType | null;
  mobilityRestrictions: string[];
  dietaryPreferences: string[];
  pace: number | null;
  vibe: string[];
  amenities: string[];
  originalPrompt: string;
}

export interface NluParseRequest {
  prompt: string;
  today?: string;
}

export interface NluParseResponse {
  slots: NluSlots;
  missingSlots: string[];
  confidence: number;
}

// --- CONFIG ---

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPSEEK_TIMEOUT_MS = 20_000;

// --- SYSTEM PROMPT ---

function buildSystemPrompt(today: string): string {
  return `You are a travel intent parser. Extract travel planning information from the user's message and return a JSON object.

Today's date is ${today}.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "slots": {
    "destinationCity": string or null,
    "durationDays": number or null,
    "startDate": "YYYY-MM-DD" or null,
    "preferredTagNames": string[],
    "experienceKeywords": string[],
    "budgetTotal": number or null,
    "groupType": "solo" or "couple" or "family" or "friends" or "business" or null,
    "mobilityRestrictions": string[],
    "dietaryPreferences": string[],
    "pace": number (1-5) or null,
    "vibe": string[],
    "amenities": string[],
    "originalPrompt": string
  },
  "missingSlots": string[],
  "confidence": number
}

Rules:
- destinationCity: city name in English or Vietnamese (e.g. "Da Nang", "Hội An", "Hà Nội")
- durationDays: number of days ("3 ngày" → 3)
- startDate: absolute YYYY-MM-DD; resolve relative dates ("thứ 6 tuần sau") using today's date
- preferredTagNames: activity/place categories (e.g. ["beach", "food", "cultural", "nightlife"])
- experienceKeywords: descriptive keywords from the prompt (e.g. ["romantic", "relaxing"])
- budgetTotal: total budget in VND ("5 triệu" → 5000000), null if not mentioned
- groupType: one of "solo" | "couple" | "family" | "friends" | "business"
- mobilityRestrictions: physical constraints (e.g. ["wheelchair"])
- dietaryPreferences: food restrictions (e.g. ["vegetarian", "halal"])
- pace: 1=very relaxed, 3=normal, 5=packed schedule; infer from tone
- vibe: emotional/aesthetic vibes (e.g. ["romantic", "chill", "adventurous"])
- amenities: desired amenities (e.g. ["pool", "wifi", "parking"])
- missingSlots: slot names that are absent but needed (e.g. ["destinationCity", "durationDays"])
- confidence: extraction confidence 0.0–1.0
- originalPrompt: copy the user's message verbatim`;
}

// --- MAIN FUNCTION ---

export async function parseNlu(prompt: string, today?: string): Promise<NluParseResponse> {
  if (!DEEPSEEK_API_KEY) {
    throw new NluUnavailableError("DEEPSEEK_API_KEY chưa được set trong file .env");
  }

  const todayStr = today ?? new Date().toISOString().split("T")[0];

  let raw: unknown;

  try {
    const res = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt(todayStr) },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      },
      {
        timeout: DEEPSEEK_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (res.data as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new NluUnavailableError("DeepSeek returned unexpected response format");
    }
    raw = JSON.parse(content);
  } catch (err) {
    if (err instanceof NluUnavailableError) throw err;
    if (err instanceof SyntaxError) {
      throw new NluUnavailableError("DeepSeek returned invalid JSON");
    }
    const axiosErr = err as AxiosError;
    throw new NluUnavailableError(`DeepSeek API error: ${axiosErr.message}`);
  }

  if (!isObject(raw)) {
    throw new NluUnavailableError("DeepSeek returned non-object response.");
  }

  if ("error" in raw) {
    throw new NluUnavailableError(
      `DeepSeek NLU error: ${(raw as Record<string, unknown>).error}`
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
    experienceKeywords: stringArray(rawSlots.experienceKeywords)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    budgetTotal: numberOrNull(rawSlots.budgetTotal),
    groupType: asGroupType(rawSlots.groupType),
    mobilityRestrictions: stringArray(rawSlots.mobilityRestrictions),
    dietaryPreferences: stringArray(rawSlots.dietaryPreferences),
    pace: numberOrNull(rawSlots.pace),
    vibe: stringArray(rawSlots.vibe),
    amenities: stringArray(rawSlots.amenities),
    originalPrompt: typeof rawSlots.originalPrompt === "string" ? rawSlots.originalPrompt : "",
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

// --- HELPERS ---

function isObject(v: unknown): v is Record<string, unknown> {
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

const VALID_GROUP_TYPES: GroupType[] = ["solo", "couple", "family", "friends", "business"];

function asGroupType(v: unknown): GroupType | null {
  if (typeof v === "string" && (VALID_GROUP_TYPES as string[]).includes(v)) {
    return v as GroupType;
  }
  return null;
}
