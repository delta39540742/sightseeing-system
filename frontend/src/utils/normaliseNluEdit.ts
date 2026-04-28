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
export function normaliseSlots(raw: Partial<NluSlots>): NluSlots {
  const destinationCity =
    typeof raw.destinationCity === 'string' && raw.destinationCity.trim()
      ? raw.destinationCity.trim()
      : null

  const durationDays =
    typeof raw.durationDays === 'number' && Number.isFinite(raw.durationDays) && raw.durationDays >= 1
      ? Math.round(raw.durationDays)
      : null

  let startDate: string | null = null
  if (typeof raw.startDate === 'string' && raw.startDate) {
    const d = parseISO(raw.startDate)
    if (isValid(d)) startDate = format(d, 'yyyy-MM-dd')
  }

  const preferredTagNames = Array.isArray(raw.preferredTagNames)
    ? raw.preferredTagNames
        .map((t) => (typeof t === 'string' ? (LEGACY_TAG_MAP[t] ?? t) : t))
        .filter((t): t is string => typeof t === 'string' && VALID_TAGS.has(t))
    : []

  const experienceKeywords = Array.isArray(raw.experienceKeywords)
    ? raw.experienceKeywords.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      )
    : []

  const budgetTotal =
    typeof raw.budgetTotal === 'number' && Number.isFinite(raw.budgetTotal) && raw.budgetTotal > 0
      ? raw.budgetTotal
      : null

  const groupType =
    typeof raw.groupType === 'string' && VALID_GROUPS.has(raw.groupType)
      ? (raw.groupType as GroupType)
      : null

  const mobilityRestrictions = Array.isArray(raw.mobilityRestrictions)
    ? raw.mobilityRestrictions.filter((x): x is string => typeof x === 'string')
    : []

  const dietaryPreferences = Array.isArray(raw.dietaryPreferences)
    ? raw.dietaryPreferences.filter((x): x is string => typeof x === 'string')
    : []

  const pace =
    typeof raw.pace === 'number' && Number.isInteger(raw.pace) && raw.pace >= 1 && raw.pace <= 5
      ? raw.pace
      : null

  const vibe = Array.isArray(raw.vibe)
    ? raw.vibe.filter((x): x is string => typeof x === 'string')
    : []

  const amenities = Array.isArray(raw.amenities)
    ? raw.amenities.filter((x): x is string => typeof x === 'string')
    : []

  const originalPrompt = typeof raw.originalPrompt === 'string' ? raw.originalPrompt : ''

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
