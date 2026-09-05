// Parity with the Python backend's GET /health (backend/main.py) — no
// real health check needed on Pages (there's no server process that can
// be "down" the way a container can), just here in case anything
// (uptime monitor, etc.) expects it.
export async function onRequestGet() {
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
}
