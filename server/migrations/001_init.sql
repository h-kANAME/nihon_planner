PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount      REAL NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('ARS','USD','JPY')),
  category    TEXT NOT NULL CHECK (category IN ('comida','transporte','alojamiento','actividades','compras','otros')),
  spent_at    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_items (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('flight','stay','booking','doc')),
  title          TEXT NOT NULL,
  done           INTEGER NOT NULL DEFAULT 0,
  datetime_start TEXT,
  datetime_end   TEXT,
  meta           TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_type_dt ON plan_items(type, datetime_start);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('planificar','consultar')),
  summary    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_session ON ai_messages(session_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS ai_messages_fts USING fts5(
  content, content='ai_messages', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS ai_messages_ai AFTER INSERT ON ai_messages BEGIN
  INSERT INTO ai_messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS ai_messages_ad AFTER DELETE ON ai_messages BEGIN
  INSERT INTO ai_messages_fts(ai_messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS ai_messages_au AFTER UPDATE ON ai_messages BEGIN
  INSERT INTO ai_messages_fts(ai_messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO ai_messages_fts(rowid, content) VALUES (new.id, new.content);
END;
