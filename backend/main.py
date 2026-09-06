"""
FastAPI entry point. Run with:
    uvicorn backend.main:app --reload
"""
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from backend.api.routes import limiter
from backend.api.routes import router as api_router
from backend.config import settings
from backend.db.database import init_db

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

# docs_url/redoc_url/openapi_url all None in production (settings.debug
# defaults to False) — no reason to expose the full API surface/schema
# publicly on a deployed instance; set NETPULSE_DEBUG=true to get them
# back for local development.
app = FastAPI(
    title="netTAPESH",
    description="Self-hosted internet speed test",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


# CSP is strict, not a starting point to loosen: this app has no inline
# <script> (only same-origin src="/js/..." files, all vendored locally
# — see frontend/index.html) and no inline event handlers, so script-src
# 'self' with no 'unsafe-inline'/'unsafe-eval' costs nothing
# functionally while closing off exactly the class of bug that would
# otherwise turn a future accidental unescaped-innerHTML regression
# into a working XSS. style-src keeps 'unsafe-inline' because
# speedtest.js sets plenty of inline styles via the element.style CSSOM
# API (gauge needle rotation, progress bar width, dynamic colors) —
# blocking that would break real functionality, and it's a much smaller
# attack surface than script-src (CSS alone can't execute arbitrary JS).
_CSP = "; ".join(
    [
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
    ]
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """A few standard defensive headers with no functional downside for
    this app — it doesn't embed in iframes, doesn't need third-party
    scripts, and sends no sensitive data cross-origin."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = _CSP
    # Harmless to send unconditionally — browsers only ever honor this
    # when it actually arrives over HTTPS, so it's a no-op for local
    # plain-HTTP dev but real protection once deployed behind TLS
    # (whether that's a reverse proxy you put in front, per the README's
    # VPS section, or Cloudflare's own edge).
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.include_router(api_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Registered last: /api and /health are matched first, everything else
# (including "/") falls through to the static frontend.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
