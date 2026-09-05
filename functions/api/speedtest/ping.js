import { checkRateLimit, jsonResponse } from "../../_shared.js";

// Round-trip target for the continuous-ping tab's latency/jitter
// measurement — deliberately does nothing but return immediately.
export async function onRequestGet(context) {
  const limited = await checkRateLimit(context.env, "RL_PING", context.request);
  if (limited) return limited;
  return jsonResponse({ pong: true });
}
