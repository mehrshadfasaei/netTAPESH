import { checkRateLimit, clientIp, jsonResponse } from "../shared.js";

// Keeps speedtest_log from growing without bound on D1. The history
// chart only ever reads "day"/"week" ranges (see worker/routes/
// history.js), so anything past RETENTION_DAYS is already invisible in
// the UI — this just stops it from silently piling up in the database
// forever. MAX_ROWS is a second, independent cap (oldest rows dropped
// once the table exceeds it) in case a deployment gets enough traffic
// that retention alone isn't enough. Equivalent to _prune_history() in
// backend/api/routes.py — kept in sync manually, per worker/README.md.
const RETENTION_DAYS = 90;
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

  const insert = await env.DB.prepare(
    `INSERT INTO speedtest_log (ping_ms, jitter_ms, download_mbps, upload_mbps, client_ip)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      payload.ping_ms ?? null,
      payload.jitter_ms ?? null,
      payload.download_mbps ?? null,
      payload.upload_mbps ?? null,
      clientIp(request)
    )
    .run();

  if (Math.random() < PRUNE_CHANCE) {
    await pruneHistory(env);
  }

  return jsonResponse({ status: "saved", id: insert.meta.last_row_id });
}
