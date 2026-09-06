-- D1 (Cloudflare's serverless SQLite) schema — the Cloudflare port of
-- backend/db/models.py's SpeedtestLog table. Apply once when setting up
-- the D1 database (see worker/README.md):
--   npx wrangler d1 execute nettapesh --remote --file=worker/schema.sql
CREATE TABLE IF NOT EXISTS speedtest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  ping_ms REAL,
  jitter_ms REAL,
  download_mbps REAL,
  upload_mbps REAL,
  client_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_speedtest_log_timestamp ON speedtest_log (timestamp);

-- No cleanup/retention logic here — pruning old rows so this table
-- doesn't grow without bound is handled in application code
-- (pruneHistory() in worker/routes/result.js, _prune_history() in
-- backend/api/routes.py for the Python backend), run opportunistically
-- after each saved result rather than as a DB-level trigger/cron.
