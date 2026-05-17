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
  isLocked?: boolean;
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
  wheelchairAccess?: boolean;
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
  wStability: number;
  wPotentialBias: number;
  /** Bonus for alternatives near the venue where the user already arrived.
   *  0 in normal replanning; set to 2.0 when userIsAtVenue=true. */
  wProximity: number;
  /** Synergy bonus for consecutive slots sharing similar tag vectors.
   *  Rewards thematically coherent sequences; defaults to 0.3 when absent. */
  wSynergy?: number;
}

// ---------------------------------------------------------------------------
// Replan effectiveness evaluation
// ---------------------------------------------------------------------------

export type IncidentType     = 'rain' | 'traffic_delay';
export type IncidentSeverity = 'low' | 'medium' | 'high';
export type TransportType    = 'uncovered' | 'covered';

export interface IncidentContext {
  type: IncidentType;
  severity: IncidentSeverity;
  /** Rain intensity in mm/h — for rain incidents. */
  rainMmPerH?: number;
  /** 'uncovered' = motorbike/bicycle, 'covered' = car. From event payload. */
  userTransportType?: TransportType;
  /** Estimated traffic delay in minutes — for traffic_delay incidents. */
  trafficDelayMin?: number;
  /** Straight-line km from user's current GPS to first disrupted slot's venue. */
  distanceToOriginalDestKm?: number;
}

export interface CriterionResult {
  id: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
  level: 'error' | 'warning' | 'info';
}

export interface EffectivenessReport {
  tripId: string;
  proposalId: string;
  evaluatedAt: string;
  incident: IncidentContext;
  overallPass: boolean;
  passRate: number;
  criteria: CriterionResult[];
  suggestions: string[];
  devNote: string;
}
