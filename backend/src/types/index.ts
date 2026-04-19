// @app/types — Shared TypeScript types for TravelSystem
// Source of truth: travel-system-spec.md §2

// ============================================================================
// User & Preference
// ============================================================================

export interface User {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export type PrimaryPurpose =
  | 'nghi_duong'
  | 'van_hoa'
  | 'am_thuc'
  | 'phieu_luu'
  | 'chup_anh'
  | 'tam_linh';

export type DailyScheduleType = 'early_bird' | 'normal' | 'night_owl';
export type GroupType = 'solo' | 'couple' | 'family' | 'friends' | 'business';

export interface UserPreference {
  userId: string;
  primaryPurpose: PrimaryPurpose;
  preferredTagIds: number[];     // ≤3
  pace: number;                  // [0,1]
  dailyScheduleType: DailyScheduleType;
  foodPreferences: string[];
  budgetPerDayMin: number;       // VND
  budgetPerDayMax: number;
  groupType: GroupType;
  mobilityRestrictions: string[];
  preferenceVector: number[];    // length = 10
  updatedAt: string;
}

export interface ObjectiveWeights {
  wInterest: number;
  wPace: number;
  wDistance: number;
  wBudget: number;
  wWeather: number;
  wRisk: number;
}

export interface SoftConstraint {
  type: 'prefer_category' | 'avoid_category' | 'prefer_indoor' | 'prefer_outdoor';
  value: string | number;
  strength: number; // [0,1]
}

// ============================================================================
// Place
// ============================================================================

export type IndoorOutdoor = 'indoor' | 'outdoor' | 'mixed';
export type PriceType = 'entry_fee' | 'avg_meal' | 'reference_total' | 'free';

export interface Place {
  placeId: number;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  minPrice: number | null;
  maxPrice: number | null;
  priceType: PriceType;
  avgVisitDurationMin: number;
  parkingAvailable: boolean;
  wheelchairAccess: boolean;
  publicTransport: boolean;
  terrainEasiness: number | null; // [0,1], 1 = dễ đi
  roadAccessScore: number | null;
  spaciousness1km: number | null;
  popularityScore: number | null;
  indoorOutdoor: IndoorOutdoor;
  isLandmark: boolean;
  landmarkClassId: number | null;
  address: string | null;
  images: PlaceImage[];
  tags: PlaceTag[];
  openingHours: PlaceOpeningHour[];
}

export interface PlaceImage {
  imageId: number;
  url: string;
  isPrimary: boolean;
}

export interface PlaceTag {
  tagId: number;
  name: string;
  displayName: string;
}

export interface PlaceOpeningHour {
  dayOfWeek: number; // 0=Mon … 6=Sun
  openTime: string;  // "HH:MM"
  closeTime: string;
}

// ============================================================================
// Trip
// ============================================================================

export type TripStatus = 'draft' | 'confirmed' | 'active' | 'completed' | 'cancelled';
export type ActivityType = 'sightseeing' | 'meal' | 'rest';
export type SlotStatus = 'planned' | 'completed' | 'skipped' | 'replaced';

export interface Trip {
  tripId: string;
  userId: string;
  title: string | null;
  destinationCity: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  budgetTotal: number;
  hotelPlaceId: number | null;
  objectiveScore: number | null;
  slots: TripSlot[];
  createdAt: string;
  updatedAt: string;
}

export interface TripSlot {
  slotId: string;
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  version: number;
  placeId: number;
  place?: Place;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  estimatedCost: number;
  activityType: ActivityType;
  rationale: string | null;
  status: SlotStatus;
}

export interface TripState {
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  timeRemainingMin: number;
  budgetRemaining: number;
  fatigue: number;            // [0,1]
  currentLat: number | null;
  currentLng: number | null;
  moodProxy: number;          // [0,1]
  capturedAt: string;
  source: 'planned' | 'actual' | 'simulated';
}

// ============================================================================
// Event & Replan
// ============================================================================

export type TripEventType =
  | 'rain_heavy'
  | 'place_closed'
  | 'user_delayed'
  | 'user_fatigued'
  | 'user_interest_discovered'
  | 'simulated';

export type EventSource =
  | 'auto_weather_poll'
  | 'gps_drift'
  | 'opening_hour_check'
  | 'user_tired_button'
  | 'heuristic_fatigue'
  | 'landmark_recognition'
  | 'simulator';

export interface TripEvent {
  eventId: string;
  tripId: string;
  eventType: TripEventType;
  severity: number;
  detectedAt: string;
  source: EventSource;
  payload: Record<string, unknown>;
  affectedSlotIds: string[];
  status: 'open' | 'resolved_by_replan' | 'dismissed';
}

export interface CausalTraceStep {
  stepIndex: number;
  reason: string;
  affectedSlotId: string | null;
  alternativeChosen: { placeId: number; reason: string } | null;
  downstreamImpact: string | null;
}

export interface ReplanProposal {
  proposalId: string;
  tripId: string;
  triggeredByEventId: string | null;
  createdAt: string;
  expiresAt: string;
  oldPlanSnapshot: TripSlot[];
  newPlanSnapshot: TripSlot[];
  causalTrace: CausalTraceStep[];
  scoreBefore: number;
  scoreAfter: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}
