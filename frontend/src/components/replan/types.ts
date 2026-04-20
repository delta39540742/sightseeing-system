// Shared types for replan components — mirrors backend @app/types

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
  activityType: 'sightseeing' | 'meal' | 'rest';
  rationale: string | null;
  status: 'planned' | 'completed' | 'skipped' | 'replaced';
}

export interface Place {
  placeId: number;
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed';
  tags: { tagId: number; name: string; displayName: string }[];
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
  /** Added by the API — true when beam search timed out and old plan was kept */
  isTimeout?: boolean;
}
