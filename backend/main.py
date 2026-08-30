"""
FastAPI entry point. Run with:
    uvicorn backend.main:app --reload
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router as api_router
from backend.db.database import init_db

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="netTAPESH", description="Self-hosted internet speed test")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(api_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# Registered last: /api and /health are matched first, everything else
# (including "/") falls through to the static frontend.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
