-- Hybrid expenses: optional amount + done + kind (absorbs plan_items logistics).
-- SQLite cannot ALTER CHECK constraints; rebuild table.

CREATE TABLE expenses_new (
  id             TEXT PRIMARY KEY,
  description    TEXT NOT NULL,
  amount         REAL CHECK (amount IS NULL OR amount > 0),
  currency       TEXT CHECK (currency IS NULL OR currency IN ('ARS','USD','JPY')),
  category       TEXT NOT NULL CHECK (category IN (
    'comida','transporte','alojamiento','actividades','compras','otros',
    'documentacion','vuelos','reservas'
  )),
  spent_at       TEXT NOT NULL,
  done           INTEGER NOT NULL DEFAULT 0,
  kind           TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','flight','stay','booking','doc')),
  meta_json      TEXT NOT NULL DEFAULT '{}',
  datetime_start TEXT,
  datetime_end   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO expenses_new (
  id, description, amount, currency, category, spent_at, done, kind, meta_json, datetime_start, datetime_end, created_at
)
SELECT
  id,
  description,
  amount,
  currency,
  category,
  spent_at,
  1,
  'expense',
  '{}',
  NULL,
  NULL,
  created_at
FROM expenses;

INSERT INTO expenses_new (
  id, description, amount, currency, category, spent_at, done, kind, meta_json, datetime_start, datetime_end, created_at
)
SELECT
  p.id,
  p.title,
  CASE
    WHEN json_extract(p.meta, '$.amount') IS NOT NULL AND CAST(json_extract(p.meta, '$.amount') AS REAL) > 0
      THEN CAST(json_extract(p.meta, '$.amount') AS REAL)
    ELSE NULL
  END,
  CASE
    WHEN json_extract(p.meta, '$.amount') IS NOT NULL AND CAST(json_extract(p.meta, '$.amount') AS REAL) > 0
      THEN COALESCE(json_extract(p.meta, '$.currency'), 'JPY')
    ELSE NULL
  END,
  CASE p.type
    WHEN 'flight' THEN 'vuelos'
    WHEN 'stay' THEN 'alojamiento'
    WHEN 'booking' THEN 'reservas'
    ELSE 'documentacion'
  END,
  COALESCE(p.datetime_start, p.created_at, datetime('now')),
  p.done,
  p.type,
  COALESCE(p.meta, '{}'),
  p.datetime_start,
  p.datetime_end,
  p.created_at
FROM plan_items p
WHERE p.id NOT IN (SELECT id FROM expenses_new);

DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;

CREATE INDEX IF NOT EXISTS idx_expenses_cat_spent ON expenses(category, spent_at);
CREATE INDEX IF NOT EXISTS idx_expenses_kind_done ON expenses(kind, done);

-- Logistics now lives in expenses; clear plan_items to avoid double source of truth.
DELETE FROM plan_items;
