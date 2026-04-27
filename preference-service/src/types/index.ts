// ─── Survey ───────────────────────────────────────────────────────────────────

export type PrimaryPurpose =
  | 'nghi_duong'
  | 'van_hoa'
  | 'am_thuc'
  | 'phieu_luu'
  | 'chup_anh'
  | 'tam_linh';

export type DailyScheduleType = 'early_bird' | 'normal' | 'night_owl';

export type GroupType = 'solo' | 'couple' | 'family' | 'friends' | 'business';

export interface SurveyPayload {
  primaryPurpose: PrimaryPurpose;
  preferredTagIds: number[];       // max 3, thuộc [1..10]
  pace: number;                    // [0,1]
  dailyScheduleType: DailyScheduleType;
  foodPreferences: string[];
  budgetPerDayMin: number;
  budgetPerDayMax: number;
  groupType: GroupType;
  mobilityRestrictions: string[];
}

// ─── Weights (trả cho Người 4, 6) ────────────────────────────────────────────

export interface WeightsResponse {
  weights: {
    wInterest: number;
    wPace: number;
    wDistance: number;
    wBudget: number;
    wWeather: number;
    wRisk: number;
  };
  softConstraints: SoftConstraint[];
  currentArmId: number;
  armName: string;
  preferenceVector: number[];
  preferredTagIds: number[];
  pace: number;
  budgetPerDayMin: number;
  budgetPerDayMax: number;
  mobilityRestrictions: string[];
}

export interface SoftConstraint {
  type: 'prefer_category' | 'avoid_category' | 'prefer_indoor' | 'prefer_outdoor';
  value: string | number;
  strength: number;  // [0,1]
}

// ─── Bandit ───────────────────────────────────────────────────────────────────

export interface UCB1Result {
  armId: number;
  armName: string;
}

// ─── Interaction events ───────────────────────────────────────────────────────

export type InteractionType =
  | 'poi_accepted'
  | 'poi_rejected'
  | 'replan_accepted'
  | 'replan_rejected'
  | 'poi_favorited'
  | 'poi_rated'
  | 'slot_completed'
  | 'slot_skipped';

export interface TripReplanEvent {
  userId: string;
  tripId: string;
  armId: number;
  reward: number;  // 1 = accepted, 0 = rejected
}

export interface SlotEvent {
  userId: string;
  tripId: string;
  placeId: number;
  accepted: boolean;
}

export interface LandmarkRecognizedEvent {
  userId: string;
  placeId: number;
  tripId?: string;
  confidence: number;
}

// ─── Request với user đã auth ─────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  userId: string;  // UUID từ token, inject bởi middleware
}
