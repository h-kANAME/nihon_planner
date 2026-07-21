CREATE TABLE IF NOT EXISTS itinerary_days (
  id          TEXT PRIMARY KEY,
  day_number  INTEGER NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '',
  base        TEXT NOT NULL DEFAULT '',
  stay_label  TEXT NOT NULL DEFAULT '',
  hub         TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_itinerary_days_sort ON itinerary_days(sort, day_number);

CREATE TABLE IF NOT EXISTS itinerary_stops (
  id           TEXT PRIMARY KEY,
  day_id       TEXT NOT NULL REFERENCES itinerary_days(id) ON DELETE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  name         TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  how_to_get   TEXT NOT NULL DEFAULT '',
  est_duration TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'stop' CHECK (kind IN ('stop', 'hub_out', 'hub_back')),
  done         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_itinerary_stops_day ON itinerary_stops(day_id, sort_order);

INSERT OR IGNORE INTO settings (key, value) VALUES (
  'trip_meta',
  '{"title":"","anchor_date":null,"imported_at":null,"source_filename":null}'
);
