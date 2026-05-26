-- New table: persistent per-day starting points for saved trips
CREATE TABLE "trip_day_start" (
    "trip_id"    UUID    NOT NULL,
    "day_index"  INTEGER NOT NULL,
    "lat"        DOUBLE PRECISION NOT NULL,
    "lng"        DOUBLE PRECISION NOT NULL,
    "name"       TEXT    NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "trip_day_start_pkey" PRIMARY KEY ("trip_id", "day_index"),
    CONSTRAINT "trip_day_start_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trip"("trip_id") ON DELETE CASCADE
);

CREATE INDEX "idx_trip_day_start_trip" ON "trip_day_start" ("trip_id");
