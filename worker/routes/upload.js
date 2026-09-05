import { checkRateLimit, jsonResponse } from "../shared.js";

// Reads and discards the request body in chunks, returns how many bytes
// it actually received. The client measures elapsed time against the
// bytes *it sent*, not this response — this endpoint is just a sink.
// Capped generously over the continuous-ping tab's 250 KB probe (see
// PING_LOOP_UPLOAD_BYTES in frontend/js/speedtest.js) — the main test
// no longer uses this endpoint at all.
const CAP_BYTES = 2_000_000;

export async function upload(request, env) {
  const limited = await checkRateLimit(env, "RL_UPLOAD", request);
  if (limited) return limited;

  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > CAP_BYTES) {
        await reader.cancel();
        break;
      }
    }
  }
  return jsonResponse({ received_bytes: total });
}
