import axios, { AxiosError } from "axios";

// --- TYPES ---

export type GroupType = "solo" | "couple" | "family" | "friends" | "business";

export type DestinationKind = "province" | "subArea";

export interface NluSlots {
  destinationCity: string | null;
  // Cấu trúc 2 cấp (Option B):
  //   - "province": destinationCity là 1 trong 34 tỉnh/thành (post 1/7/2025); destinationProvince === destinationCity.
  //   - "subArea":  destinationCity là cụm du lịch con (Mộc Châu, Sa Pa, Hội An…); destinationProvince là tỉnh cha.
  // null nếu LLM không xác định / không khớp allowlist.
  destinationKind: DestinationKind | null;
  destinationProvince: string | null;
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

// Allowlist — phải khớp 1-1 với frontend/src/data/destinations.ts.
// Đây là source-of-truth phía backend cho NLU validation.
const PROVINCE_NAMES: readonly string[] = [
  "An Giang", "Bắc Ninh", "Cà Mau", "Cần Thơ", "Cao Bằng", "Đà Nẵng",
  "Đắk Lắk", "Điện Biên", "Đồng Nai", "Đồng Tháp", "Gia Lai", "Hà Nội",
  "Hà Tĩnh", "Hải Phòng", "Hồ Chí Minh", "Huế", "Hưng Yên", "Khánh Hòa",
  "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Nghệ An", "Ninh Bình",
  "Phú Thọ", "Quảng Ngãi", "Quảng Ninh", "Quảng Trị", "Sơn La", "Tây Ninh",
  "Thái Nguyên", "Thanh Hóa", "Tuyên Quang", "Vĩnh Long",
] as const;

// Map cụm sub-area → tỉnh cha. Mọi key/value phải có dấu khớp DB.
const SUB_AREA_TO_PROVINCE: Readonly<Record<string, string>> = {
  "Mộc Châu":  "Sơn La",
  "Sa Pa":     "Lào Cai",
  "Hội An":    "Đà Nẵng",
  "Vũng Tàu":  "Hồ Chí Minh",
  "Phú Quốc":  "An Giang",
  "Đà Lạt":    "Lâm Đồng",
  "Nha Trang": "Khánh Hòa",
  "Hạ Long":   "Quảng Ninh",
  "Cát Bà":    "Hải Phòng",
  "Tam Đảo":   "Phú Thọ",
  "Mai Châu":  "Phú Thọ",
  "Hà Giang":  "Tuyên Quang",
  "Đồng Văn":  "Tuyên Quang",
  "Côn Đảo":   "Hồ Chí Minh",
  "Mũi Né":    "Lâm Đồng",
  "Phong Nha": "Quảng Trị",
};

const PROVINCE_SET = new Set<string>(PROVINCE_NAMES);
const SUB_AREA_SET = new Set<string>(Object.keys(SUB_AREA_TO_PROVINCE));

function normaliseDestKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}
// Map dạng không dấu → canonical (giữ dấu) để chống typo từ LLM.
const PROVINCE_LOOKUP: ReadonlyMap<string, string> = new Map(
  PROVINCE_NAMES.map((n) => [normaliseDestKey(n), n]),
);
const SUB_AREA_LOOKUP: ReadonlyMap<string, string> = new Map(
  Object.keys(SUB_AREA_TO_PROVINCE).map((n) => [normaliseDestKey(n), n]),
);

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
  const provincesList = PROVINCE_NAMES.join(", ");
  const subAreasList = Object.entries(SUB_AREA_TO_PROVINCE)
    .map(([area, prov]) => `"${area}" (in ${prov})`)
    .join(", ");

  return `You are a Vietnamese travel intent parser. Extract trip-planning information from the user's message and return a JSON object.

Today's date is ${today}.

IMPORTANT — Vietnam destinations are TWO-TIER after the 1/7/2025 administrative restructure:
  • province: one of the 34 official provinces/centrally-governed cities.
  • subArea:  a famous tourism cluster INSIDE a province (e.g. Mộc Châu is a plateau inside Sơn La).
A subArea is NOT a city by itself — never invent a province from a subArea name.

Valid province names (use these exact strings, with Vietnamese diacritics):
${provincesList}

Valid subArea → parent province (use these exact strings):
${subAreasList}

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "slots": {
    "destinationCity": string or null,
    "destinationKind": "province" or "subArea" or null,
    "destinationProvince": string or null,
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

Destination rules:
- If user mentions a province (e.g. "đi Đà Nẵng", "Sơn La"): destinationCity = the province name, destinationKind = "province", destinationProvince = the same province name.
- If user mentions a subArea (e.g. "đi Mộc Châu", "Sa Pa 3 ngày", "Hội An"): destinationCity = the subArea name, destinationKind = "subArea", destinationProvince = the parent province from the list above.
- Always use the exact canonical Vietnamese spelling with diacritics from the lists above.
- If the input doesn't match any name in the allowlists, set destinationCity to your best guess but leave destinationKind and destinationProvince as null.
- Never label a subArea as "province" or invent a destinationProvince that isn't in the province list.

Other rules:
- durationDays: number of days ("3 ngày" → 3).
- startDate: absolute YYYY-MM-DD; resolve relative dates ("thứ 6 tuần sau") using today's date.
- preferredTagNames: activity/place categories (e.g. ["beach", "food", "cultural", "nightlife"]).
- experienceKeywords: descriptive keywords from the prompt (e.g. ["romantic", "relaxing"]).
- budgetTotal: total budget in VND ("5 triệu" → 5000000), null if not mentioned.
- groupType: one of "solo" | "couple" | "family" | "friends" | "business".
- mobilityRestrictions: physical constraints (e.g. ["wheelchair"]).
- dietaryPreferences: food restrictions (e.g. ["vegetarian", "halal"]).
- pace: 1=very relaxed, 3=normal, 5=packed schedule; infer from tone.
- vibe: emotional/aesthetic vibes (e.g. ["romantic", "chill", "adventurous"]).
- amenities: desired amenities (e.g. ["pool", "wifi", "parking"]).
- missingSlots: slot names that are absent but needed (e.g. ["destinationCity", "durationDays"]).
- confidence: extraction confidence 0.0–1.0.
- originalPrompt: copy the user's message verbatim.`;
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

  const rawCity = stringOrNull(rawSlots.destinationCity);
  const rawKind = stringOrNull(rawSlots.destinationKind);
  const rawProvince = stringOrNull(rawSlots.destinationProvince);
  const {
    destinationCity,
    destinationKind,
    destinationProvince,
  } = resolveDestination(rawCity, rawKind, rawProvince);

  const slots: NluSlots = {
    destinationCity,
    destinationKind,
    destinationProvince,
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

// Validate + auto-correct LLM output. Even if the LLM mislabels (e.g. labels
// "Mộc Châu" as province), we re-derive the canonical structure from the allowlist.
function resolveDestination(
  rawCity: string | null,
  rawKind: string | null,
  rawProvince: string | null,
): { destinationCity: string | null; destinationKind: DestinationKind | null; destinationProvince: string | null } {
  if (!rawCity) {
    return { destinationCity: null, destinationKind: null, destinationProvince: null };
  }

  const cityKey = normaliseDestKey(rawCity);

  // 1. Sub-area takes priority — handles the "Mộc Châu" misclassification case.
  const subAreaCanonical = SUB_AREA_LOOKUP.get(cityKey);
  if (subAreaCanonical) {
    return {
      destinationCity: subAreaCanonical,
      destinationKind: "subArea",
      destinationProvince: SUB_AREA_TO_PROVINCE[subAreaCanonical],
    };
  }

  // 2. Exact province match.
  const provinceCanonical = PROVINCE_LOOKUP.get(cityKey);
  if (provinceCanonical) {
    return {
      destinationCity: provinceCanonical,
      destinationKind: "province",
      destinationProvince: provinceCanonical,
    };
  }

  // 3. Unknown — keep the LLM's raw city but trust its kind/province only if they pass allowlist.
  const trustedKind = rawKind === "province" || rawKind === "subArea" ? rawKind : null;
  const trustedProvince =
    rawProvince && PROVINCE_SET.has(rawProvince) ? rawProvince : null;
  return {
    destinationCity: rawCity,
    destinationKind: trustedKind,
    destinationProvince: trustedProvince,
  };
}

// Suppress unused warning — PROVINCE_SET / SUB_AREA_SET kept for future validation paths.
void SUB_AREA_SET;

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
