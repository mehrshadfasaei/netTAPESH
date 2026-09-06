// Single Worker entry point — the current unified Cloudflare model
// (Workers with a static-assets binding, not the older separate "Pages"
// product) serves everything through one script. run_worker_first in
// wrangler.toml (needed so withSecurityHeaders() below actually reaches
// the HTML page, not just /api/* JSON responses — see its comment)
// means EVERY request reaches this fetch handler now, including static
// files; anything that isn't one of our own API routes falls through to
// env.ASSETS.fetch() to serve the actual static file.
//
// This is the Cloudflare port of backend/api/routes.py + backend/main.py
// (the FastAPI backend) — see worker/README.md for why it exists
// alongside the Python backend rather than replacing it, and for
// deployment steps (D1 + rate-limit bindings this code assumes are
// configured).
import { ping } from "./routes/ping.js";
import { clientInfo } from "./routes/clientInfo.js";
import { download } from "./routes/download.js";
import { upload } from "./routes/upload.js";
import { result } from "./routes/result.js";
import { latest } from "./routes/latest.js";
import { history } from "./routes/history.js";

const ROUTES = {
  "GET /health": () => new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } }),
  "GET /api/speedtest/ping": ping,
  "GET /api/speedtest/client-info": clientInfo,
  "GET /api/speedtest/download": download,
  "POST /api/speedtest/upload": upload,
  "POST /api/speedtest/result": result,
  "GET /api/speedtest/latest": latest,
  "GET /api/speedtest/history": history,
};

// Same headers backend/main.py's security_headers() middleware adds for
// the Python backend.
//
// The CSP is strict, not a starting point to loosen: this app has no
// inline <script> (only same-origin src="/js/..." files, all vendored
// locally — see index.html) and no inline event handlers, so
// script-src 'self' with no 'unsafe-inline'/'unsafe-eval' costs nothing
// functionally while closing off exactly the class of bug that would
// otherwise turn a future accidental unescaped-innerHTML regression
// into a working XSS. style-src keeps 'unsafe-inline' because
// speedtest.js sets plenty of inline styles via the element.style CSSOM
// API (gauge needle rotation, progress bar width, dynamic colors) —
// blocking that would break real functionality, and it's a much
// smaller attack surface than script-src (CSS alone can't execute
// arbitrary JS).
//
// HSTS: Cloudflare's own zone-level "Always Use HTTPS"/HSTS setting is
// what actually matters for nettapesh.ir in practice, but sending it
// from the app too means it doesn't silently depend on that dashboard
// setting never being turned off. Harmless to send unconditionally —
// browsers only ever honor Strict-Transport-Security when it arrives
// over an actual HTTPS connection in the first place.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", CSP);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (!handler) {
      // Not one of our API routes — hand it to the static-assets
      // binding (the actual HTML/CSS/JS/etc.), still wrapped with the
      // same security headers a plain "served without touching this
      // fetch handler" static response never would have gotten.
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }
    try {
      return withSecurityHeaders(await handler(request, env));
    } catch (e) {
      return withSecurityHeaders(
        new Response(JSON.stringify({ error: "internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};
