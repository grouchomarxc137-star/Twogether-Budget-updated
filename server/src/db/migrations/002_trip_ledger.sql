-- Redesigned Trips: one row per shared trip (expenses and settlements live
-- inside the trip document). Rows are only ever upserted -- a deleted trip
-- is a soft delete inside the JSON, never a removed row.
CREATE TABLE IF NOT EXISTS trip_ledger (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL CHECK (json_valid(json)),
  updated_at TEXT
);
