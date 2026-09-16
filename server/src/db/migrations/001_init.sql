CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json)),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json)),
  linked_trip_id TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_plans_linked_trip ON plans(linked_trip_id);

CREATE TABLE IF NOT EXISTS finance_months (
  actor TEXT NOT NULL,
  month TEXT NOT NULL,
  json TEXT NOT NULL CHECK (json_valid(json)),
  PRIMARY KEY (actor, month)
);

CREATE TABLE IF NOT EXISTS finance_profiles (
  actor TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json))
);

CREATE TABLE IF NOT EXISTS game_profiles (
  actor TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json))
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json))
);
