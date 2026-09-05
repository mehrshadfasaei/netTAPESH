// Shared helpers for the Cloudflare Pages Functions under functions/api/ —
// this is the Cloudflare port of backend/api/routes.py (the FastAPI
// backend), kept for local dev / self-hosting. See functions/README.md
// for why this exists alongside the Python backend rather than
// replacing it, and for deployment steps (D1 + rate-limit bindings
// this code assumes are configured).

// Cloudflare terminates the real connection itself, so CF-Connecting-IP
// is always the actual visitor IP — no X-Forwarded-For chain-parsing
// needed the way the Python backend (behind a generic reverse proxy)
// has to do.
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// Applies a configured Workers Rate Limiting binding (see wrangler.toml)
// and returns a 429 Response if the caller is over budget, or null if
// the request should proceed. One binding per endpoint (the native API
// doesn't take a per-call limit/period — each binding fixes its own),
// mirroring the distinct @limiter.limit(...) values on each Python route.
export async function checkRateLimit(env, binding, request) {
  const limiter = env[binding];
  if (!limiter) return null; // binding not configured — fail open, not closed
  const { success } = await limiter.limit({ key: clientIp(request) });
  if (success) return null;
  return jsonResponse({ error: "rate limit exceeded" }, 429);
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// D1 stores TEXT timestamps as "YYYY-MM-DD HH:MM:SS" (SQLite's
// datetime('now'), UTC but with no 'Z'/offset) — same footgun the
// Python backend's _row_serialize_timestamp() exists for: `new
// Date(...)` in JS treats an offset-less date-time string as LOCAL
// time, silently shifting every point on the history chart by the
// viewer's UTC offset. Reformat to unambiguous ISO-8601 UTC.
export function toIsoUtc(sqliteTimestamp) {
  return sqliteTimestamp.replace(" ", "T") + "Z";
}

export function rowToDict(row) {
  return {
    timestamp: toIsoUtc(row.timestamp),
    ping_ms: row.ping_ms,
    jitter_ms: row.jitter_ms,
    download_mbps: row.download_mbps,
    upload_mbps: row.upload_mbps,
  };
}
