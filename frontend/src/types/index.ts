export type TripStatus = 'draft' | 'active' | 'confirmed' | 'completed' | 'cancelled'

export interface Place {
  placeId: number
  name: string
  lat: number
  lng: number
  avgVisitDurationMin: number
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed'
  estimatedCost?: number
  minPrice?: number
  priceType?: string
  description?: string
  imageUrl?: string
  rating?: number
  tags: Array<{ tagId: number; name?: string }>
  openingHours: Array<{ dayOfWeek: number; openTime: string; closeTime: string }>
}

export interface TripSlot {
  slotId: string
  tripId: string
  dayIndex: number
  slotOrder: number
  placeId: number
  place?: Place
  plannedStart: string
  plannedEnd: string
  estimatedCost: number
  activityType: 'sightseeing' | 'meal' | 'rest' | 'transport' | 'activity'
  status: 'planned' | 'completed' | 'skipped' | 'replaced'
  isLocked?: boolean
  conflict?: ConflictInfo
  pending?: boolean
}

export interface ConflictInfo {
  type: 'time' | 'distance' | 'closed'
  message: string
  cause: string
  suggestion: string
}

export interface Trip {
  tripId: string
  userId: string
  title: string | null
  destinationCity: string
  startDate: string
  endDate: string
  status: TripStatus
  budgetTotal: number
  objectiveScore: number | null
  slots: TripSlot[]
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface PlanRequest {
  destinationCity: string
  startDate: string
  endDate: string
  budgetTotal: number
  startLat?: number
  startLng?: number
  preferences?: string[]
  experienceKeywords?: string[]
  anchorPlaceIds?: number[]
  orderedPlaceIds?: number[]
  mustVisitPlaceIds?: number[]
  numPeople?: number
  additionalNotes?: string
  strictMode?: boolean
  planningAlgorithm?: 'greedy_2opt' | 'i3ch'
  lockedSlots?: Array<{ placeId: number; dayIndex: number; fixedStart: string; durationMin?: number }>
}

export interface PlaceOrderItem {
  placeId: number
  place: Place
  mustVisit: boolean
  priority: number
}

export interface UserPreference {
  primaryPurpose?: string
  pace?: string
  dailyScheduleType?: string
  budgetPerDayMin?: number
  budgetPerDayMax?: number
  foodPreferences?: string[]
  mobilityRestrictions?: string[]
  travelStyles?: string[]
  transportMode?: string
  maxWalkingKm?: number
}

// Khớp với SurveyPayload của preference-service (src/types/index.ts).
export type SurveyPrimaryPurpose =
  | 'nghi_duong' | 'van_hoa' | 'am_thuc' | 'phieu_luu' | 'chup_anh' | 'tam_linh'
export type SurveyDailyScheduleType = 'early_bird' | 'normal' | 'night_owl'
export type SurveyGroupType = 'solo' | 'couple' | 'family' | 'friends' | 'business'

export interface SurveyPayload {
  primaryPurpose: SurveyPrimaryPurpose
  preferredTagIds: number[]
  pace: number
  dailyScheduleType: SurveyDailyScheduleType
  foodPreferences: string[]
  budgetPerDayMin: number
  budgetPerDayMax: number
  groupType: SurveyGroupType
  mobilityRestrictions: string[]
}

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

export interface HistoryEntry<T> {
  state: T
  description: string
  timestamp: number
}

export interface TripVersion {
  slots: TripSlot[]
  savedAt: number
  label: string
}

export type FilterCategory = 'all' | 'sightseeing' | 'meal' | 'activity' | 'rest' | 'transport'
export type SortMode = 'fastest' | 'cheapest' | 'scenic'

export interface ParsedNLPResult {
  destinationCity: string
  days: number
  budget: number
  styles: string[]
  experienceKeywords?: string[]
  startDate: string
  endDate: string
  numPeople: number
  // Expanded for vibe & amenities search
  vibe?: string[]
  amenities?: string[]
  originalPrompt?: string
}

export interface NluSlots {
  destinationCity: string | null
  durationDays: number | null
  startDate: string | null
  preferredTagNames: string[]
  experienceKeywords: string[]
  budgetTotal: number | null
  groupType: 'solo' | 'couple' | 'family' | 'friends' | 'business' | null
  mobilityRestrictions: string[]
  dietaryPreferences: string[]
  pace: number | null
  // New fields
  vibe: string[]
  amenities: string[]
  originalPrompt?: string
}

export interface NluParseResponse {
  slots: NluSlots
  missingSlots: string[]
  confidence: number
}

export interface LandmarkRecognitionResult {
  recognitionId: string
  landmarkClassId: number
  placeId: number
  place: { id: number; name: string; address: string; rating: number }
  confidence: number
  isMock: boolean
}

export type ReplanScope = 'remaining_day' | 'remaining_trip'
