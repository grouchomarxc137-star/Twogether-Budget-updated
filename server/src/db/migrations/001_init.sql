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


CREATE TABLE IF NOT EXISTS push_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_push_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_actor ON push_subscriptions(actor);

CREATE TABLE IF NOT EXISTS push_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  tag TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT './',
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  FOREIGN KEY(subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  UNIQUE(subscription_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_push_messages_pending
  ON push_messages(subscription_id, claimed_at);
