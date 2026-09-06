import { checkRateLimit, clientIp, jsonResponse } from "../shared.js";

// Keeps speedtest_log from growing without bound on D1. The history
// chart only ever reads "day"/"week" ranges (see worker/routes/
// history.js), so anything past RETENTION_DAYS is already invisible in
// the UI — this just stops it from silently piling up in the database
// forever. MAX_ROWS is a second, independent cap (oldest rows dropped
// once the table exceeds it) in case a deployment gets enough traffic
// that retention alone isn't enough. Equivalent to _prune_history() in
// backend/api/routes.py — kept in sync manually, per worker/README.md.
const RETENTION_DAYS = 7;
const MAX_ROWS = 50_000;
// Not run on every single insert (see the Math.random() check at the
// call site) since it's more work than a plain insert — a fraction of
// writes paying for it is plenty to keep the table bounded without
// taxing every request.
const PRUNE_CHANCE = 0.1;

async function pruneHistory(env) {
  await env.DB.prepare(`DELETE FROM speedtest_log WHERE timestamp < datetime('now', ?)`)
    .bind(`-${RETENTION_DAYS} days`)
    .run();

  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM speedtest_log`).first();
  const total = row ? row.total : 0;
  if (total > MAX_ROWS) {
    const excess = total - MAX_ROWS;
    await env.DB.prepare(
      `DELETE FROM speedtest_log WHERE id IN (
         SELECT id FROM speedtest_log ORDER BY timestamp ASC LIMIT ?
       )`
    )
      .bind(excess)
      .run();
  }
}

// Sane ceilings, not real-world expectations — see validateMetric()
// below for why these exist at all.
const MAX_PING_MS = 100_000; // 100s
const MAX_MBPS = 1_000_000; // 1 Tbps

// This endpoint has no authentication by design (see "Known
// limitations" in the README) — anyone can POST to it, not just a
// client that actually ran a test. Without this, a POST carrying e.g.
// {"download_mbps": "<script>", "ping_ms": -1} would be stored as-is
// and later handed straight into Chart.js by the history chart
// (loadHistory() in frontend/js/speedtest.js, which does no validation
// of its own) — degrading or blanking the shared history chart for
// every visitor from one malicious request. Returns undefined
// (distinct from null, which is a legitimate "not provided" value) to
// signal an invalid value the caller should reject the whole request
// for, rather than silently coercing or dropping just that one field.
function validateMetric(value, maxValue) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maxValue) {
    return undefined;
  }
  return value;
}

// Client submits its own computed numbers (all the actual timing
// happens client-side, against /ping, /download, /upload above) so
// they show up in history.
export async function result(request, env) {
  const limited = await checkRateLimit(env, "RL_RESULT", request);
  if (limited) return limited;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const ping_ms = validateMetric(payload.ping_ms, MAX_PING_MS);
  const jitter_ms = validateMetric(payload.jitter_ms, MAX_PING_MS);
  const download_mbps = validateMetric(payload.download_mbps, MAX_MBPS);
  const upload_mbps = validateMetric(payload.upload_mbps, MAX_MBPS);
  if ([ping_ms, jitter_ms, download_mbps, upload_mbps].some((v) => v === undefined)) {
    return jsonResponse({ error: "invalid metric value" }, 400);
  }

  const insert = await env.DB.prepare(
    `INSERT INTO speedtest_log (ping_ms, jitter_ms, download_mbps, upload_mbps, client_ip)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(ping_ms, jitter_ms, download_mbps, upload_mbps, clientIp(request))
    .run();

  if (Math.random() < PRUNE_CHANCE) {
    await pruneHistory(env);
  }

  return jsonResponse({ status: "saved", id: insert.meta.last_row_id });
}
