export type TripStatus = 'draft' | 'active' | 'confirmed' | 'completed' | 'cancelled';

export interface TripSlot {
  slotId: string;
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  version: number;
  placeId: number;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  estimatedCost: number;
  activityType: 'sightseeing' | 'meal' | 'rest' | 'transport' | 'activity';
  rationale: string | null;
  status: 'planned' | 'completed' | 'skipped' | 'replaced';
}

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

export interface TripState {
  tripId: string;
  dayIndex: number;
  slotOrder: number;
  timeRemainingMin: number;
  budgetRemaining: number;
  fatigue: number;
  currentLat: number;
  currentLng: number;
  moodProxy: number;
  capturedAt: string;
  source: 'simulated' | 'actual';
}

export interface TripEvent {
  eventId: string;
  tripId: string;
  status: string;
  [key: string]: unknown;
}

export interface ReplanProposal {
  proposalId: string;
  tripId: string;
  triggeredByEventId: string | null;
  createdAt: string;
  expiresAt: string;
  oldPlanSnapshot: TripSlot[];
  newPlanSnapshot: TripSlot[];
  causalTrace: unknown[];
  scoreBefore: number;
  scoreAfter: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface PlaceTag {
  tagId: number;
  [key: string]: unknown;
}

export interface PlaceOpeningHour {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

export interface Place {
  placeId: number;
  name: string;
  lat: number;
  lng: number;
  avgVisitDurationMin: number;
  terrainEasiness?: number;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed';
  estimatedCost?: number;
  minPrice?: number;
  tagIds?: number[];
  tags: PlaceTag[];
  openingHours: PlaceOpeningHour[];
  [key: string]: unknown;
}

export interface UserPreference {
  preferenceVector: number[];
  pace: number;
  mobilityRestrictions?: string[];
  [key: string]: unknown;
}

export interface CausalTraceStep {
  stepIndex: number;
  reason: string;
  affectedSlotId: string | null;
  alternativeChosen: { placeId: number; reason: string } | null;
  downstreamImpact: unknown;
}

export interface ObjectiveWeights {
  wInterest: number;
  wPace: number;
  wDistance: number;
  wBudget: number;
  wWeather: number;
  wRisk: number;
}
