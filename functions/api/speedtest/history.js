import { checkRateLimit, jsonResponse, rowToDict } from "../../_shared.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// SQLite-style "YYYY-MM-DD HH:MM:SS" (UTC, no offset) — matches the
// format datetime('now') stores rows with, so a plain TEXT >=
// comparison in the SQL query below works correctly.
function toSqliteUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export async function onRequestGet(context) {
  const limited = await checkRateLimit(context.env, "RL_HISTORY", context.request);
  if (limited) return limited;

  const url = new URL(context.request.url);
  const range = url.searchParams.get("range") === "week" ? "week" : "day";
  const sinceDate = new Date(Date.now() - (range === "week" ? 7 : 1) * DAY_MS);
  const sinceSqlite = toSqliteUtc(sinceDate);

  const { results } = await context.env.DB.prepare(
    `SELECT * FROM speedtest_log WHERE timestamp >= ? ORDER BY timestamp ASC`
  )
    .bind(sinceSqlite)
    .all();

  return jsonResponse({
    range,
    since: sinceDate.toISOString(),
    results: results.map(rowToDict),
  });
}
