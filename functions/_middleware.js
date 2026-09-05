// Runs for every request to the site (static assets included) — Pages
// Functions middleware wraps the whole pipeline, not just /api/* routes.
// Same three headers backend/main.py's security_headers() middleware
// adds for the Python backend; see that file's comment for why these
// three specifically.
export async function onRequest(context) {
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, headers });
}
