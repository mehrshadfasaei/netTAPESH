// Single Worker entry point — the current unified Cloudflare model
// (Workers with a static-assets binding, not the older separate "Pages"
// product) serves everything through one script. Requests matching a
// file under frontend/ (per [assets] in wrangler.toml) are served
// automatically WITHOUT reaching this fetch handler at all — this code
// only runs for paths that don't match a static file, i.e. our API
// routes, plus /health.
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

// Same three headers backend/main.py's security_headers() middleware
// adds for the Python backend; see that file's comment for why these
// three specifically.
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = ROUTES[`${request.method} ${url.pathname}`];
    if (!handler) {
      // Not one of our API routes and didn't match a static asset
      // either (or [assets] isn't configured) — genuinely not found.
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
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
