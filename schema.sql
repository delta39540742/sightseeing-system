-- =============================================================================
-- TRAVEL PLANNING SYSTEM — DATABASE SCHEMA
-- PostgreSQL 14+ với PostGIS
-- =============================================================================
-- Quy ước:
--   - Tên bảng: snake_case số ít (place, trip_slot)
--   - Tiền tố 'app_user' thay vì 'user' (user là từ khóa PostgreSQL)
--   - UUID cho entity user-facing; BIGINT cho entity bulk (place, log)
--   - Tọa độ dùng GEOGRAPHY(POINT, 4326) để query ST_DWithin theo mét
--   - Float [0,1] luôn theo quy ước: 1 = tốt, 0 = xấu
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- cho gen_random_uuid()

-- =============================================================================
-- 1. USER & AUTH
-- =============================================================================

CREATE TABLE app_user (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid  TEXT UNIQUE NOT NULL,
    email         TEXT NOT NULL,
    display_name  TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_user_firebase ON app_user(firebase_uid);

-- =============================================================================
-- 2. PLACE (và bảng con)
-- =============================================================================

CREATE TABLE place (
    place_id                BIGSERIAL PRIMARY KEY,
    name                    TEXT NOT NULL,
    description             TEXT,

    -- Tọa độ (PostGIS)
    geom                    GEOGRAPHY(POINT, 4326) NOT NULL,
    -- Generated columns để đọc lat/long dễ dàng
    lat                     DOUBLE PRECISION GENERATED ALWAYS AS (ST_Y(geom::geometry)) STORED,
    lng                     DOUBLE PRECISION GENERATED ALWAYS AS (ST_X(geom::geometry)) STORED,

    -- Thông tin giá
    min_price               INT,                     -- VND
    max_price               INT,                     -- VND
    price_type              TEXT NOT NULL CHECK (price_type IN ('entry_fee','avg_meal','reference_total','free')),

    -- Thông tin thời gian
    avg_visit_duration_min  INT NOT NULL CHECK (avg_visit_duration_min > 0),

    -- Tiện ích
    parking_available       BOOLEAN NOT NULL DEFAULT FALSE,
    wheelchair_access       BOOLEAN NOT NULL DEFAULT FALSE,
    public_transport        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Điểm đánh giá [0,1], quy ước 1 = tốt
    terrain_easiness        FLOAT CHECK (terrain_easiness BETWEEN 0 AND 1),
    road_access_score       FLOAT CHECK (road_access_score BETWEEN 0 AND 1),
    spaciousness_1km        FLOAT CHECK (spaciousness_1km BETWEEN 0 AND 1),
    popularity_score        FLOAT CHECK (popularity_score BETWEEN 0 AND 1),

    -- Phân loại cho Part 2 (replan khi mưa)
    indoor_outdoor          TEXT NOT NULL CHECK (indoor_outdoor IN ('indoor','outdoor','mixed')),

    -- Landmark cho Part 3
    is_landmark             BOOLEAN NOT NULL DEFAULT FALSE,
    landmark_class_id       INT,  -- khớp với mock recognition output; NULL nếu không phải landmark

    -- Địa chỉ hiển thị
    address                 TEXT,

    location_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index spatial cho query theo bán kính
CREATE INDEX idx_place_geom ON place USING GIST(geom);
CREATE INDEX idx_place_landmark ON place(landmark_class_id) WHERE is_landmark = TRUE;
CREATE INDEX idx_place_popularity ON place(popularity_score DESC NULLS LAST);
CREATE INDEX idx_place_indoor ON place(indoor_outdoor);

-- ---------------------------------------------------------------------------
-- 2.1 Place Image
-- ---------------------------------------------------------------------------
CREATE TABLE place_image (
    image_id      BIGSERIAL PRIMARY KEY,
    place_id      BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    url           TEXT NOT NULL,
    is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_place_image_place ON place_image(place_id, display_order);
CREATE UNIQUE INDEX idx_place_image_primary ON place_image(place_id) WHERE is_primary = TRUE;

-- ---------------------------------------------------------------------------
-- 2.2 Place Tag + PlaceTagMap
-- ---------------------------------------------------------------------------
CREATE TABLE place_tag (
    tag_id       INT PRIMARY KEY,
    name         VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL
);

-- Seed tags tương ứng Part 4 survey
INSERT INTO place_tag (tag_id, name, display_name) VALUES
    (1, 'beach',      'Biển'),
    (2, 'mountain',   'Núi'),
    (3, 'culture',    'Văn hóa - Lịch sử'),
    (4, 'food',       'Ẩm thực'),
    (5, 'spiritual',  'Tâm linh'),
    (6, 'shopping',   'Mua sắm'),
    (7, 'entertainment','Giải trí'),
    (8, 'park',       'Công viên'),
    (9, 'rest',       'Nghỉ ngơi'),
    (10,'sightseeing','Tham quan chung');

CREATE TABLE place_tag_map (
    place_id BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    tag_id   INT    NOT NULL REFERENCES place_tag(tag_id),
    PRIMARY KEY (place_id, tag_id)
);

CREATE INDEX idx_tagmap_tag ON place_tag_map(tag_id);

-- ---------------------------------------------------------------------------
-- 2.3 Giờ mở cửa
-- ---------------------------------------------------------------------------
CREATE TABLE place_opening_hour (
    place_id    BIGINT   NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=T2, 6=CN
    open_time   TIME     NOT NULL,
    close_time  TIME     NOT NULL,
    PRIMARY KEY (place_id, day_of_week, open_time),
    CHECK (close_time > open_time)
);

-- ---------------------------------------------------------------------------
-- 2.4 Crowd snapshot + peak time
-- ---------------------------------------------------------------------------
CREATE TABLE place_crowd_snapshot (
    snapshot_id      BIGSERIAL PRIMARY KEY,
    place_id         BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    recorded_at      TIMESTAMPTZ NOT NULL,
    emptiness_level  FLOAT NOT NULL CHECK (emptiness_level BETWEEN 0 AND 1)  -- 1 = vắng = tốt
);

CREATE INDEX idx_crowd_place_time ON place_crowd_snapshot(place_id, recorded_at DESC);

CREATE TABLE place_peak_time (
    place_id         BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    start_time       TIME NOT NULL,
    end_time         TIME NOT NULL,
    emptiness_level  FLOAT NOT NULL CHECK (emptiness_level BETWEEN 0 AND 1),
    PRIMARY KEY (place_id, start_time),
    CHECK (end_time > start_time)
);

-- ---------------------------------------------------------------------------
-- 2.5 Nearby amenity
-- ---------------------------------------------------------------------------
CREATE TABLE place_nearby_amenity (
    place_id         BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    amenity_place_id BIGINT NOT NULL REFERENCES place(place_id) ON DELETE CASCADE,
    distance_m       FLOAT  NOT NULL CHECK (distance_m >= 0),
    PRIMARY KEY (place_id, amenity_place_id),
    CHECK (place_id <> amenity_place_id)
);

CREATE INDEX idx_nearby_amenity ON place_nearby_amenity(amenity_place_id);

-- =============================================================================
-- 3. FESTIVAL (tĩnh, dùng trong Part 1)
-- =============================================================================

CREATE TABLE festival (
    festival_id           BIGSERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT,
    city                  TEXT NOT NULL,
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    affected_geom         GEOGRAPHY(POLYGON, 4326),
    traffic_impact_level  FLOAT CHECK (traffic_impact_level BETWEEN 0 AND 1),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_festival_dates ON festival(start_date, end_date);
CREATE INDEX idx_festival_geom  ON festival USING GIST(affected_geom);

-- =============================================================================
-- 4. USER PREFERENCE + PERSONALIZATION (Part 4)
-- =============================================================================

CREATE TABLE user_preference (
    user_id                UUID PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
    primary_purpose        TEXT NOT NULL CHECK (primary_purpose IN
                              ('nghi_duong','van_hoa','am_thuc','phieu_luu','chup_anh','tam_linh')),
    preferred_tag_ids      INT[] NOT NULL,  -- ≤3 tag_id
    pace                   FLOAT NOT NULL CHECK (pace BETWEEN 0 AND 1),  -- 0 = thong thả, 1 = dày đặc
    daily_schedule_type    TEXT NOT NULL CHECK (daily_schedule_type IN ('early_bird','normal','night_owl')),
    food_preferences       TEXT[] NOT NULL DEFAULT '{}',
    budget_per_day_min     INT NOT NULL,
    budget_per_day_max     INT NOT NULL,
    group_type             TEXT NOT NULL CHECK (group_type IN ('solo','couple','family','friends','business')),
    mobility_restrictions  TEXT[] NOT NULL DEFAULT '{}',
    preference_vector      FLOAT[] NOT NULL,  -- embedding để CF dùng; độ dài = 10 (bằng số tag)
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (budget_per_day_max >= budget_per_day_min)
);

-- Bandit arms: 6 bộ trọng số định sẵn
CREATE TABLE bandit_arm (
    arm_id      INT PRIMARY KEY,
    name        TEXT NOT NULL,
    w_interest  FLOAT NOT NULL,
    w_pace      FLOAT NOT NULL,
    w_distance  FLOAT NOT NULL,
    w_budget    FLOAT NOT NULL,
    w_weather   FLOAT NOT NULL,
    w_risk      FLOAT NOT NULL
);

-- Seed 6 arms
INSERT INTO bandit_arm VALUES
    (1, 'balanced',        1.0, 1.0, 1.0, 1.0, 1.0, 1.0),
    (2, 'interest_heavy',  2.0, 1.0, 0.5, 0.8, 1.0, 0.8),
    (3, 'budget_tight',    1.0, 0.8, 1.0, 2.0, 1.0, 1.2),
    (4, 'pace_relaxed',    1.0, 2.0, 1.2, 1.0, 1.2, 1.0),
    (5, 'weather_safe',    1.0, 1.0, 1.0, 1.0, 2.5, 1.5),
    (6, 'compact_nearby',  1.0, 1.0, 2.0, 1.0, 0.8, 1.0);

-- Trạng thái bandit cho từng user
CREATE TABLE user_arm_stat (
    user_id      UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    arm_id       INT  NOT NULL REFERENCES bandit_arm(arm_id),
    pulls        INT  NOT NULL DEFAULT 0,
    total_reward FLOAT NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, arm_id)
);

-- Trọng số hiện tại của user (tính từ bandit + preference)
CREATE TABLE user_objective_weights (
    user_id          UUID PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
    w_interest       FLOAT NOT NULL,
    w_pace           FLOAT NOT NULL,
    w_distance       FLOAT NOT NULL,
    w_budget         FLOAT NOT NULL,
    w_weather        FLOAT NOT NULL,
    w_risk           FLOAT NOT NULL,
    current_arm_id   INT NOT NULL REFERENCES bandit_arm(arm_id),
    soft_constraints JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{type, value, strength}]
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Similarity từ SVD (chạy batch)
CREATE TABLE user_similarity (
    user_id         UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    similar_user_id UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    similarity      FLOAT NOT NULL CHECK (similarity BETWEEN -1 AND 1),
    rank_position   INT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, similar_user_id),
    CHECK (user_id <> similar_user_id)
);

CREATE INDEX idx_usersim_rank ON user_similarity(user_id, rank_position);

-- Interaction log (nguồn tín hiệu cho CF + bandit)
CREATE TABLE interaction_log (
    interaction_id    BIGSERIAL PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    place_id          BIGINT REFERENCES place(place_id),
    trip_id           UUID,  -- không FK để không ảnh hưởng khi xóa trip
    interaction_type  TEXT NOT NULL CHECK (interaction_type IN
                        ('poi_accepted','poi_rejected',
                         'replan_accepted','replan_rejected',
                         'poi_favorited','poi_rated',
                         'slot_completed','slot_skipped')),
    rating            FLOAT CHECK (rating BETWEEN 0 AND 1),
    context           JSONB,  -- event_type gốc, arm_id đang dùng, v.v.
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interaction_user  ON interaction_log(user_id, created_at DESC);
CREATE INDEX idx_interaction_place ON interaction_log(place_id);
CREATE INDEX idx_interaction_type  ON interaction_log(interaction_type);

-- =============================================================================
-- 5. TRIP + TRIP SLOT + TRIP STATE
-- =============================================================================

CREATE TABLE trip (
    trip_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    title             TEXT,
    destination_city  TEXT NOT NULL,  -- 'Da Nang' cho MVP
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','confirmed','active','completed','cancelled')),
    budget_total      INT NOT NULL,
    raw_prompt        TEXT,                  -- NL prompt gốc của user
    parsed_slots      JSONB,                 -- output NLU
    hotel_place_id    BIGINT REFERENCES place(place_id),
    objective_score   FLOAT,                 -- F score hiện tại
    current_arm_id    INT REFERENCES bandit_arm(arm_id),  -- arm dùng khi lập trip
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_trip_user   ON trip(user_id, created_at DESC);
CREATE INDEX idx_trip_status ON trip(status) WHERE status IN ('active','draft');

-- Slot trong trip. Mỗi lần replan tăng version, slot cũ giữ nguyên cho audit.
CREATE TABLE trip_slot (
    slot_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id         UUID NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    day_index       INT NOT NULL CHECK (day_index >= 0),
    slot_order      INT NOT NULL CHECK (slot_order >= 0),
    version         INT NOT NULL DEFAULT 1,

    place_id        BIGINT NOT NULL REFERENCES place(place_id),
    planned_start   TIMESTAMPTZ NOT NULL,
    planned_end     TIMESTAMPTZ NOT NULL,
    actual_start    TIMESTAMPTZ,
    actual_end      TIMESTAMPTZ,

    estimated_cost  INT NOT NULL DEFAULT 0,
    activity_type   TEXT NOT NULL CHECK (activity_type IN ('sightseeing','meal','rest')),
    rationale       TEXT,
    status          TEXT NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned','completed','skipped','replaced')),

    UNIQUE (trip_id, day_index, slot_order, version),
    CHECK (planned_end > planned_start)
);

CREATE INDEX idx_slot_trip_active ON trip_slot(trip_id, day_index, slot_order)
    WHERE status = 'planned';

-- State snapshot sau mỗi slot (cho replanner + explainability)
CREATE TABLE trip_state_snapshot (
    snapshot_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id              UUID NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    slot_id              UUID REFERENCES trip_slot(slot_id) ON DELETE SET NULL,
    captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    day_index            INT NOT NULL,
    slot_order           INT NOT NULL,

    time_remaining_min   INT NOT NULL,
    budget_remaining     INT NOT NULL,
    fatigue              FLOAT NOT NULL CHECK (fatigue BETWEEN 0 AND 1),
    current_geom         GEOGRAPHY(POINT, 4326),
    mood_proxy           FLOAT NOT NULL CHECK (mood_proxy BETWEEN 0 AND 1),

    source               TEXT NOT NULL CHECK (source IN ('planned','actual','simulated'))
);

CREATE INDEX idx_state_trip ON trip_state_snapshot(trip_id, captured_at DESC);

-- =============================================================================
-- 6. TRIP EVENT + REPLAN PROPOSAL
-- =============================================================================

CREATE TABLE trip_event (
    event_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id             UUID NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    event_type          TEXT NOT NULL CHECK (event_type IN
                          ('rain_heavy','place_closed','user_delayed','user_fatigued',
                           'user_interest_discovered','simulated')),
    severity            FLOAT NOT NULL CHECK (severity BETWEEN 0 AND 1),
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source              TEXT NOT NULL CHECK (source IN
                          ('auto_weather_poll','gps_drift','opening_hour_check',
                           'user_tired_button','heuristic_fatigue',
                           'landmark_recognition','simulator')),
    payload             JSONB NOT NULL,
    affected_slot_ids   UUID[] NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','resolved_by_replan','dismissed'))
);

CREATE INDEX idx_event_trip   ON trip_event(trip_id, detected_at DESC);
CREATE INDEX idx_event_status ON trip_event(trip_id, status) WHERE status = 'open';

-- Đề xuất replan chờ user accept/reject
CREATE TABLE replan_proposal (
    proposal_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id                 UUID NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
    triggered_by_event_id   UUID REFERENCES trip_event(event_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMPTZ NOT NULL,

    old_plan_snapshot       JSONB NOT NULL,   -- slots cũ (từ version hiện tại)
    new_plan_snapshot       JSONB NOT NULL,   -- slots mới đề xuất
    causal_trace            JSONB NOT NULL,   -- chuỗi lý do
    score_before            FLOAT NOT NULL,
    score_after             FLOAT NOT NULL,

    status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','accepted','rejected','expired')),
    decided_at              TIMESTAMPTZ
);

CREATE INDEX idx_proposal_trip_pending ON replan_proposal(trip_id)
    WHERE status = 'pending';

-- =============================================================================
-- 7. LANDMARK RECOGNITION (Part 3)
-- =============================================================================

CREATE TABLE landmark_recognition (
    recognition_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                    UUID NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    trip_id                    UUID REFERENCES trip(trip_id) ON DELETE SET NULL,
    image_url                  TEXT NOT NULL,
    predicted_landmark_class_id INT,
    predicted_place_id         BIGINT REFERENCES place(place_id),
    confidence                 FLOAT NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    is_mock                    BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE khi chuyển sang model thật
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recognition_user ON landmark_recognition(user_id, created_at DESC);

-- Seed 10 landmark cho Đà Nẵng (landmark_class_id 1-10)
-- Dev ngày 1 sẽ INSERT đúng 10 record Place với is_landmark=TRUE và landmark_class_id
-- Mock service map filename → landmark_class_id → predicted_place_id

-- =============================================================================
-- 8. INTERNAL EVENT LOG (hộp thư nội bộ, debug + audit)
-- =============================================================================

CREATE TABLE event_log (
    log_id          BIGSERIAL PRIMARY KEY,
    event_name      TEXT NOT NULL,           -- xem Event Catalog trong spec
    payload         JSONB NOT NULL,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumer_count  INT NOT NULL DEFAULT 0,
    correlation_id  UUID                     -- trace 1 user action qua nhiều event
);

CREATE INDEX idx_log_event ON event_log(event_name, published_at DESC);
CREATE INDEX idx_log_corr  ON event_log(correlation_id) WHERE correlation_id IS NOT NULL;

-- =============================================================================
-- 9. HELPER VIEWS
-- =============================================================================

-- View lấy slot active (status='planned', version cao nhất) của trip
CREATE OR REPLACE VIEW v_trip_slot_active AS
SELECT DISTINCT ON (trip_id, day_index, slot_order)
    ts.*
FROM trip_slot ts
WHERE status = 'planned'
ORDER BY trip_id, day_index, slot_order, version DESC;

-- View state snapshot mới nhất của mỗi trip
CREATE OR REPLACE VIEW v_trip_state_latest AS
SELECT DISTINCT ON (trip_id)
    tss.*
FROM trip_state_snapshot tss
ORDER BY trip_id, captured_at DESC;

-- =============================================================================
-- 10. SEED DỮ LIỆU MẪU (tối thiểu để dev chạy)
-- =============================================================================

-- 10 landmark Đà Nẵng — dev Người 2 sẽ chuẩn hóa chi tiết ngày 1
-- Tọa độ tham khảo (cần dev verify)
INSERT INTO place (name, description, geom, min_price, max_price, price_type,
                   avg_visit_duration_min, indoor_outdoor, is_landmark, landmark_class_id,
                   terrain_easiness, road_access_score, spaciousness_1km, popularity_score,
                   address)
VALUES
    ('Cầu Rồng', 'Cầu biểu tượng Đà Nẵng, phun lửa nước tối cuối tuần',
     ST_GeogFromText('SRID=4326;POINT(108.2273 16.0614)'), 0, 0, 'free',
     45, 'outdoor', TRUE, 1, 0.95, 1.0, 0.8, 0.95, 'Quận Hải Châu, Đà Nẵng'),
    ('Bà Nà Hills', 'Khu du lịch núi Bà Nà, có Cầu Vàng',
     ST_GeogFromText('SRID=4326;POINT(108.0299 15.9977)'), 850000, 1000000, 'entry_fee',
     300, 'mixed', TRUE, 2, 0.6, 0.7, 0.5, 0.9, 'Hòa Vang, Đà Nẵng'),
    ('Ngũ Hành Sơn', 'Núi đá vôi linh thiêng, có chùa và động',
     ST_GeogFromText('SRID=4326;POINT(108.2621 16.0036)'), 40000, 100000, 'entry_fee',
     120, 'mixed', TRUE, 3, 0.55, 0.9, 0.7, 0.85, 'Ngũ Hành Sơn, Đà Nẵng'),
    ('Chợ Cồn', 'Chợ truyền thống lớn nhất Đà Nẵng',
     ST_GeogFromText('SRID=4326;POINT(108.2186 16.0650)'), 20000, 200000, 'avg_meal',
     90, 'mixed', TRUE, 4, 0.95, 1.0, 0.4, 0.8, 'Hải Châu, Đà Nẵng'),
    ('Chùa Linh Ứng Bãi Bụt', 'Tượng Phật Bà cao 67m, bán đảo Sơn Trà',
     ST_GeogFromText('SRID=4326;POINT(108.2818 16.0992)'), 0, 0, 'free',
     90, 'outdoor', TRUE, 5, 0.75, 0.8, 0.8, 0.88, 'Sơn Trà, Đà Nẵng'),
    ('Cầu Vàng', 'Cây cầu được đỡ bởi bàn tay khổng lồ, ở Bà Nà',
     ST_GeogFromText('SRID=4326;POINT(108.0188 15.9956)'), 0, 0, 'free',
     60, 'outdoor', TRUE, 6, 0.8, 0.6, 0.3, 0.98, 'Trong Bà Nà Hills'),
    ('Bãi biển Mỹ Khê', 'Một trong những bãi biển đẹp nhất hành tinh',
     ST_GeogFromText('SRID=4326;POINT(108.2486 16.0617)'), 0, 0, 'free',
     120, 'outdoor', TRUE, 7, 1.0, 1.0, 0.6, 0.95, 'Sơn Trà / Ngũ Hành Sơn'),
    ('Hải Vân Quan', 'Cổng ải lịch sử đèo Hải Vân',
     ST_GeogFromText('SRID=4326;POINT(108.1833 16.2000)'), 0, 0, 'free',
     60, 'outdoor', TRUE, 8, 0.7, 0.5, 0.9, 0.75, 'Đèo Hải Vân, Đà Nẵng'),
    ('Bảo tàng Điêu khắc Chăm', 'Bộ sưu tập điêu khắc Chămpa lớn nhất',
     ST_GeogFromText('SRID=4326;POINT(108.2235 16.0603)'), 60000, 60000, 'entry_fee',
     90, 'indoor', TRUE, 9, 1.0, 1.0, 0.7, 0.7, 'Hải Châu, Đà Nẵng'),
    ('Bán đảo Sơn Trà', 'Khu bảo tồn thiên nhiên, ngắm voọc chà vá',
     ST_GeogFromText('SRID=4326;POINT(108.2936 16.1189)'), 0, 0, 'free',
     180, 'outdoor', TRUE, 10, 0.5, 0.6, 0.95, 0.78, 'Sơn Trà, Đà Nẵng');

-- Gán tag cơ bản cho 10 landmark (dev Người 2 có thể tinh chỉnh)
INSERT INTO place_tag_map (place_id, tag_id) VALUES
    (1,10),(1,3),
    (2,2),(2,7),(2,10),
    (3,2),(3,5),(3,10),
    (4,4),(4,6),
    (5,5),(5,3),
    (6,10),(6,2),
    (7,1),(7,9),
    (8,3),(8,10),
    (9,3),(9,10),
    (10,2),(10,8),(10,10);

-- =============================================================================
-- HẾT FILE
-- =============================================================================
