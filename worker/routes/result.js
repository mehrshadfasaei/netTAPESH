import { checkRateLimit, clientIp, jsonResponse } from "../shared.js";

// Client submits its own computed numbers (all the actual timing
// happens client-side — for the main test, against M-Lab directly; for
// the continuous-ping tab, against /ping, /download, /upload above) so
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

  return jsonResponse({ status: "saved", id: insert.meta.last_row_id });
}
