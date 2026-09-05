import { checkRateLimit } from "../shared.js";

// One chunk of random bytes, reused (not regenerated) across a whole
// response — the client is timing raw transfer throughput, not this
// Worker's RNG speed. Lazily generated on first request, then cached
// for the isolate's lifetime — NOT at module scope: Workers disallows
// crypto/fetch/timers outside a request handler ("Disallowed operation
// called within global scope"), so this can't just be a top-level const.
const CHUNK_SIZE = 64 * 1024;
let _randomChunk = null;
function randomChunk() {
  if (!_randomChunk) _randomChunk = crypto.getRandomValues(new Uint8Array(CHUNK_SIZE));
  return _randomChunk;
}

// Sized for the continuous-ping tab's probes only (500 KB per request —
// see PING_LOOP_DOWNLOAD_BYTES in frontend/js/speedtest.js) — the main
// speed test no longer uses this endpoint at all (it measures against
// M-Lab directly, see speedtest.js's module docstring), so there's no
// need for the old hundreds-of-MB ceiling the Python backend allowed.
const DEFAULT_BYTES = 300_000;
const MAX_BYTES = 5_000_000;

export async function download(request, env) {
  const limited = await checkRateLimit(env, "RL_DOWNLOAD", request);
  if (limited) return limited;

  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get("bytes"), 10);
  const total = Math.min(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_BYTES, MAX_BYTES);

  let remaining = total;
  const stream = new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const chunk = randomChunk();
      const n = Math.min(CHUNK_SIZE, remaining);
      controller.enqueue(n === CHUNK_SIZE ? chunk : chunk.slice(0, n));
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
