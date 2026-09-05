import { checkRateLimit, jsonResponse } from "../shared.js";

// Round-trip target for the continuous-ping tab's latency/jitter
// measurement — deliberately does nothing but return immediately.
export async function ping(request, env) {
  const limited = await checkRateLimit(env, "RL_PING", request);
  if (limited) return limited;
  return jsonResponse({ pong: true });
}
