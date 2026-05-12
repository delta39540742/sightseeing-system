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
