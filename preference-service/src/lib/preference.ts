import { SurveyPayload, SoftConstraint } from '../types';

/**
 * TAG_IDS: 1=beach, 2=mountain, 3=culture, 4=food, 5=spiritual,
 *          6=shopping, 7=entertainment, 8=park, 9=rest, 10=sightseeing
 */
const ALL_TAG_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Ánh xạ primaryPurpose → tag_id liên quan nhất
 */
const PURPOSE_TAG_MAP: Record<string, number[]> = {
  nghi_duong: [9, 1, 8],   // rest, beach, park
  van_hoa:    [3, 10, 5],  // culture, sightseeing, spiritual
  am_thuc:    [4, 6, 10],  // food, shopping, sightseeing
  phieu_luu:  [2, 1, 7],   // mountain, beach, entertainment
  chup_anh:   [10, 2, 1],  // sightseeing, mountain, beach
  tam_linh:   [5, 3, 10],  // spiritual, culture, sightseeing
};

/**
 * buildPreferenceVector
 * Tạo vector 10 chiều [0,1] đại diện cho mức độ ưa thích mỗi tag.
 *
 * Logic:
 *   - Base score = 0.2 cho tất cả tags
 *   - preferredTagIds (user tự chọn) → +0.5
 *   - primaryPurpose related tags    → +0.2
 *   - Normalize về [0,1]
 */
export function buildPreferenceVector(survey: SurveyPayload): number[] {
  const scores: Record<number, number> = {};
  ALL_TAG_IDS.forEach((id) => (scores[id] = 0.2));

  // Boost từ preferred tags (tín hiệu mạnh nhất)
  survey.preferredTagIds.forEach((tagId) => {
    if (scores[tagId] !== undefined) scores[tagId] += 0.5;
  });

  // Boost từ primaryPurpose
  const purposeTags = PURPOSE_TAG_MAP[survey.primaryPurpose] ?? [];
  purposeTags.forEach((tagId, i) => {
    if (scores[tagId] !== undefined) {
      scores[tagId] += 0.2 - i * 0.05; // tag đầu tiên được boost nhiều hơn
    }
  });

  // Normalize về [0,1]
  const values = ALL_TAG_IDS.map((id) => scores[id]);
  const max = Math.max(...values);
  return values.map((v) => (max > 0 ? Math.min(v / max, 1) : 0));
}

/**
 * buildSoftConstraints
 * Tạo soft constraints từ survey để trả cho Người 4/6.
 */
export function buildSoftConstraints(survey: SurveyPayload): SoftConstraint[] {
  const constraints: SoftConstraint[] = [];

  // Prefer category từ primaryPurpose
  constraints.push({
    type: 'prefer_category',
    value: survey.primaryPurpose,
    strength: 0.8,
  });

  // Mobility: nếu có hạn chế → prefer indoor
  if (survey.mobilityRestrictions.length > 0) {
    constraints.push({
      type: 'prefer_indoor',
      value: 'indoor',
      strength: 0.7,
    });
  }

  // Group type: family → prefer spacious, avoid crowd
  if (survey.groupType === 'family') {
    constraints.push({
      type: 'prefer_outdoor',
      value: 'outdoor',
      strength: 0.4,
    });
  }

  return constraints;
}

/**
 * Ánh xạ preference → base weights (trước khi bandit scale)
 * Đây là prior, bandit sẽ multiply lên trên.
 */
export function calcBaseWeights(survey: SurveyPayload) {
  const base = {
    wInterest: 1.0,
    wPace: 1.0,
    wDistance: 1.0,
    wBudget: 1.0,
    wWeather: 1.0,
    wRisk: 1.0,
  };

  // Budget sensitivity
  if (survey.budgetPerDayMax < 500_000) {
    base.wBudget = 1.5; // user tight budget → budget quan trọng hơn
  }

  // Pace
  if (survey.pace < 0.3) {
    base.wPace = 1.3; // thong thả → pace quan trọng
  }

  // Mobility → tăng risk weight (tránh địa hình khó)
  if (survey.mobilityRestrictions.includes('xe_lan') || survey.mobilityRestrictions.includes('ngai_leo_treo')) {
    base.wRisk = 1.5;
  }

  return base;
}
