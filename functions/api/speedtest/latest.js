import { checkRateLimit, jsonResponse, rowToDict } from "../../_shared.js";

export async function onRequestGet(context) {
  const limited = await checkRateLimit(context.env, "RL_LATEST", context.request);
  if (limited) return limited;

  const row = await context.env.DB.prepare(
    `SELECT * FROM speedtest_log ORDER BY timestamp DESC LIMIT 1`
  ).first();

  return jsonResponse({ result: row ? rowToDict(row) : null });
}
