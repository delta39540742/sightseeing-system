export type TripStatus = 'draft' | 'active' | 'confirmed' | 'completed' | 'cancelled'

export interface ScoreBreakdown {
  interest: number    // raw dot-product (before ×10)
  popularity: number  // raw popularity_score (before ×0.3)
  softAdj: number
  cfBoost: number
  semBoost: number    // 12 × cosine_sim; range [-12, 12]
  expBoost: number    // 6 × keyword_hits; range [0, ∞)
}

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

export interface PlaceCandidate extends Place {
  scoreBreakdown?: ScoreBreakdown
}

export interface SlotScoreComponent {
  name: string
  label: string
  weighted: number
  pct: number
  detail?: string
}

export interface SlotExplanation {
  summary: string
  score: {
    total: number
    rank: number
    poolSize: number
    components: SlotScoreComponent[]
    runnerUp?: { name: string; score: number; mainLoss: string }
  }
  order?: {
    changed: boolean
    from?: number
    to?: number
    reason?: string
    tradeoff?: string
  }
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
  explanation?: SlotExplanation
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
  // Structured destination resolved from DESTINATIONS table (frontend/src/data/destinations.ts).
  // When present, backend filters by province (and optional ST_DWithin radius) instead of
  // doing fuzzy text matching on address/description. Optional for backward compatibility.
  destinationProvince?: string
  destinationLat?: number
  destinationLng?: number
  destinationRadiusKm?: number
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
  dayStarts?: DayStart[]
}

export interface DayStart {
  dayIndex: number
  lat: number
  lng: number
  name?: string
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

export type DestinationKind = 'province' | 'subArea'

export interface ParsedNLPResult {
  destinationCity: string
  // 2-tier destination from NLU (Option B). Optional for backward compatibility with
  // local nlpParser fallback. When present, page components should use these directly
  // instead of fuzzy-matching destinationCity via findDestination().
  destinationKind?: DestinationKind | null
  destinationProvince?: string | null
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
  // 2-tier destination — see backend/src/services/nluService.ts.
  destinationKind: DestinationKind | null
  destinationProvince: string | null
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
