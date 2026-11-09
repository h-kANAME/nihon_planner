ALTER TABLE itinerary_stops ADD COLUMN lat REAL;
ALTER TABLE itinerary_stops ADD COLUMN lng REAL;
ALTER TABLE itinerary_stops ADD COLUMN location_mode TEXT NOT NULL DEFAULT 'pending'
  CHECK (location_mode IN ('pending', 'coords', 'not_applicable', 'inherit_stay'));
ALTER TABLE itinerary_stops ADD COLUMN location_precision TEXT
  CHECK (location_precision IN ('place', 'view'));
ALTER TABLE itinerary_stops ADD COLUMN raw_input TEXT;
ALTER TABLE itinerary_stops ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE itinerary_days ADD COLUMN stay_lat REAL;
ALTER TABLE itinerary_days ADD COLUMN stay_lng REAL;
ALTER TABLE itinerary_days ADD COLUMN stay_precision TEXT
  CHECK (stay_precision IN ('place', 'view'));
ALTER TABLE itinerary_days ADD COLUMN stay_raw_input TEXT;
ALTER TABLE itinerary_days ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Backfill: hubs heredan del alojamiento
UPDATE itinerary_stops SET location_mode = 'inherit_stay'
WHERE kind IN ('hub_out', 'hub_back');
