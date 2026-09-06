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

// Deliberately large — the main speed test (see runParallelTest() in
// frontend/js/speedtest.js) opens 4 of these in parallel and aborts
// them once its 8s test window elapses, rather than waiting for any one
// to finish; on a fast connection each stream needs enough bytes queued
// up to still be flowing when the abort hits, or the test would measure
// "how fast can I download 300KB" instead of real sustained throughput.
// The continuous-ping tab's small probes (500 KB, see
// PING_LOOP_DOWNLOAD_BYTES) pass their own `bytes=` and stay well under
// this default.
const DEFAULT_BYTES = 300_000_000;
const MAX_BYTES = 500_000_000;

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
