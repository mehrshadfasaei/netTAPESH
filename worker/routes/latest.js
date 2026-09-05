import { checkRateLimit, jsonResponse, rowToDict } from "../shared.js";

export async function latest(request, env) {
  const limited = await checkRateLimit(env, "RL_LATEST", request);
  if (limited) return limited;

  const row = await env.DB.prepare(`SELECT * FROM speedtest_log ORDER BY timestamp DESC LIMIT 1`).first();

  return jsonResponse({ result: row ? rowToDict(row) : null });
}
