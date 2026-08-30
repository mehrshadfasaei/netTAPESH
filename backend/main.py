"""
FastAPI entry point (phase 4). Run with:
    uvicorn backend.main:app --reload
"""
from fastapi import FastAPI

from backend.api.routes import router as api_router
from backend.db.database import init_db

app = FastAPI(title="NetPulse", description="Local traffic + connectivity monitoring")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(api_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
