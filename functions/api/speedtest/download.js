import { checkRateLimit } from "../../_shared.js";

// One chunk of random bytes, reused (not regenerated) across a whole
// response — the client is timing raw transfer throughput, not this
// Worker's RNG speed. Module-scope so it's generated once per isolate,
// not per request.
const CHUNK_SIZE = 64 * 1024;
const RANDOM_CHUNK = crypto.getRandomValues(new Uint8Array(CHUNK_SIZE));

// Sized for the continuous-ping tab's probes only (500 KB per request —
// see PING_LOOP_DOWNLOAD_BYTES in frontend/js/speedtest.js) — the main
// speed test no longer uses this endpoint at all (it measures against
// M-Lab directly, see speedtest.js's module docstring), so there's no
// need for the old hundreds-of-MB ceiling the Python backend allowed.
const DEFAULT_BYTES = 300_000;
const MAX_BYTES = 5_000_000;

export async function onRequestGet(context) {
  const limited = await checkRateLimit(context.env, "RL_DOWNLOAD", context.request);
  if (limited) return limited;

  const url = new URL(context.request.url);
  const requested = parseInt(url.searchParams.get("bytes"), 10);
  const total = Math.min(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_BYTES, MAX_BYTES);

  let remaining = total;
  const stream = new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const n = Math.min(CHUNK_SIZE, remaining);
      controller.enqueue(n === CHUNK_SIZE ? RANDOM_CHUNK : RANDOM_CHUNK.slice(0, n));
      remaining -= n;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(total),
      "Cache-Control": "no-store",
    },
  });
}
