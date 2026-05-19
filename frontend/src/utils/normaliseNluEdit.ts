import { format, addDays, parseISO, isValid } from 'date-fns'
import type { NluSlots, ParsedNLPResult } from '@/types'

export type GroupType = 'solo' | 'couple' | 'family' | 'friends' | 'business'

export const KNOWN_CITIES = [
  'Đà Lạt', 'Đà Nẵng', 'Hội An', 'Hà Nội', 'Hồ Chí Minh',
  'Nha Trang', 'Phú Quốc', 'Huế', 'Vũng Tàu', 'Cần Thơ',
  'Quảng Ninh', 'Ninh Bình', 'Sa Pa', 'Mộc Châu',
]

// Khớp với 10 tag duy nhất tồn tại trong DB (xem backend/src/scripts/seed-places.ts).
export const TAG_OPTIONS: { value: string; label: string }[] = [
  { value: 'beach',         label: 'Biển' },
  { value: 'mountain',      label: 'Núi' },
  { value: 'culture',       label: 'Văn hóa' },
  { value: 'food',          label: 'Ẩm thực' },
  { value: 'spiritual',     label: 'Tâm linh' },
  { value: 'shopping',      label: 'Mua sắm' },
  { value: 'entertainment', label: 'Giải trí' },
  { value: 'nature',        label: 'Thiên nhiên' },
  { value: 'sport',         label: 'Thể thao' },
  { value: 'landmark',      label: 'Điểm tham quan' },
]

// Map các tag cũ (lưu trong localStorage / survey trước migration) sang tag DB hợp lệ.
const LEGACY_TAG_MAP: Record<string, string> = {
  cafe:        'food',
  waterfall:   'nature',
  hiking:      'mountain',
  photography: 'landmark',
  diving:      'sport',
  camping:     'nature',
  history:     'culture',
}

export const GROUP_OPTIONS: { value: GroupType; label: string }[] = [
  { value: 'solo',     label: 'Một mình' },
  { value: 'couple',   label: 'Đôi' },
  { value: 'family',   label: 'Gia đình' },
  { value: 'friends',  label: 'Bạn bè' },
  { value: 'business', label: 'Công tác' },
]

export const VIBE_OPTIONS = [
  { value: 'quiet',    label: 'Yên tĩnh' },
  { value: 'lively',   label: 'Sôi động' },
  { value: 'romantic', label: 'Lãng mạn' },
  { value: 'modern',   label: 'Hiện đại' },
  { value: 'vintage',  label: 'Hoài cổ' },
  { value: 'luxurious', label: 'Sang trọng' },
]

export const AMENITY_OPTIONS = [
  { value: 'wifi',    label: 'Wifi free' },
  { value: 'parking', label: 'Chỗ đậu xe' },
  { value: 'pool',    label: 'Bể bơi' },
  { value: 'gym',     label: 'Phòng gym' },
  { value: 'pet',     label: 'Thú cưng' },
]

const NUM_PEOPLE: Record<GroupType, number> = {
  solo: 1, couple: 2, family: 4, friends: 3, business: 2,
}

const VALID_GROUPS = new Set<string>(['solo', 'couple', 'family', 'friends', 'business'])
const VALID_TAGS   = new Set(TAG_OPTIONS.map((t) => t.value))

/**
 * Validate and normalise NluSlots locally — no AI call needed.
 * Safe to call after every user edit.
 */
export function normaliseSlots(raw: Partial<NluSlots> | null | undefined): NluSlots {
  const r: Partial<NluSlots> = raw ?? {}

  const destinationCity =
    typeof r.destinationCity === 'string' && r.destinationCity.trim()
      ? r.destinationCity.trim()
      : null

  const durationDays =
    typeof r.durationDays === 'number' && Number.isFinite(r.durationDays) && r.durationDays >= 1
      ? Math.round(r.durationDays)
      : null

  let startDate: string | null = null
  if (typeof r.startDate === 'string' && r.startDate) {
    // Accept YYYY-MM-DD (ISO) or DD/MM/YYYY (Vietnamese format from NLU)
    const ddmmyyyy = r.startDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    const isoStr = ddmmyyyy
      ? `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
      : r.startDate
    const d = parseISO(isoStr)
    if (isValid(d)) startDate = format(d, 'yyyy-MM-dd')
  }

  const preferredTagNames = Array.isArray(r.preferredTagNames)
    ? r.preferredTagNames
        .map((t) => (typeof t === 'string' ? (LEGACY_TAG_MAP[t] ?? t) : t))
        .filter((t): t is string => typeof t === 'string' && VALID_TAGS.has(t))
    : []

  const experienceKeywords = Array.isArray(r.experienceKeywords)
    ? r.experienceKeywords.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      )
    : []

  const budgetTotal =
    typeof r.budgetTotal === 'number' && Number.isFinite(r.budgetTotal) && r.budgetTotal > 0
      ? r.budgetTotal
      : null

  const groupType =
    typeof r.groupType === 'string' && VALID_GROUPS.has(r.groupType)
      ? (r.groupType as GroupType)
      : null

  const mobilityRestrictions = Array.isArray(r.mobilityRestrictions)
    ? r.mobilityRestrictions.filter((x): x is string => typeof x === 'string')
    : []

  const dietaryPreferences = Array.isArray(r.dietaryPreferences)
    ? r.dietaryPreferences.filter((x): x is string => typeof x === 'string')
    : []

  const pace =
    typeof r.pace === 'number' && Number.isInteger(r.pace) && r.pace >= 1 && r.pace <= 5
      ? r.pace
      : null

  const vibe = Array.isArray(r.vibe)
    ? r.vibe.filter((x): x is string => typeof x === 'string')
    : []

  const amenities = Array.isArray(r.amenities)
    ? r.amenities.filter((x): x is string => typeof x === 'string')
    : []

  const originalPrompt = typeof r.originalPrompt === 'string' ? r.originalPrompt : ''

  return {
    destinationCity, durationDays, startDate,
    preferredTagNames, experienceKeywords,
    budgetTotal, groupType,
    mobilityRestrictions, dietaryPreferences, pace,
    vibe, amenities, originalPrompt,
  }
}

/** Convert validated NluSlots → ParsedNLPResult expected by PlanForm. */
export function slotsToParsedResult(slots: NluSlots): ParsedNLPResult {
  const days   = slots.durationDays ?? 3
  const startStr = slots.startDate ?? format(new Date(), 'yyyy-MM-dd')
  const numPeople = slots.groupType ? (NUM_PEOPLE[slots.groupType] ?? 1) : 1

  return {
    destinationCity: slots.destinationCity ?? 'Đà Nẵng',
    days,
    budget:    slots.budgetTotal ?? 3_000_000,
    styles:    slots.preferredTagNames,
    experienceKeywords: slots.experienceKeywords,
    startDate: startStr,
    endDate:   format(addDays(parseISO(startStr), days - 1), 'yyyy-MM-dd'),
    numPeople,
    vibe: slots.vibe,
    amenities: slots.amenities,
    originalPrompt: slots.originalPrompt,
  }
}
