"""
FastAPI entry point (phases 4-5). Run with:
    uvicorn backend.main:app --reload
"""
import asyncio

from fastapi import FastAPI, WebSocket

from backend.api.routes import router as api_router
from backend.api.websocket import broadcast_loop, traffic_live_endpoint
from backend.db.database import init_db

app = FastAPI(title="NetPulse", description="Local traffic + connectivity monitoring")

_broadcast_task: asyncio.Task | None = None


@app.on_event("startup")
async def on_startup() -> None:
    global _broadcast_task
    init_db()
    _broadcast_task = asyncio.create_task(broadcast_loop())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    if _broadcast_task is not None:
        _broadcast_task.cancel()


app.include_router(api_router)


@app.websocket("/api/traffic/live")
async def traffic_live(websocket: WebSocket) -> None:
    await traffic_live_endpoint(websocket)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
