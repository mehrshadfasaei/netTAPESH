"""
Phase 5 — WebSocket live traffic stream.

Deliberately decoupled from `traffic_collector.run_forever()` (the process
that writes to SQLite): that loop owns persistence, this loop owns
"what's happening right now" for connected browsers. Reusing the same
`sample_processes()` function keeps the two consistent without coupling
their intervals — the collector writing to disk every 5s shouldn't be
what paces the browser's live view, and a websocket handler that queried
the DB on every frame would just be adding a needless round trip for data
it can sample directly.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import WebSocket, WebSocketDisconnect

from backend.collectors.traffic_collector import sample_processes
from backend.config import settings


class ConnectionManager:
    def __init__(self) -> None:
        self._active: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._active.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        if not self._active:
            return
        message = json.dumps(payload)
        dead = []
        for ws in self._active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def has_clients(self) -> bool:
        return bool(self._active)


manager = ConnectionManager()


async def traffic_live_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection open; the broadcast loop (below) is what
            # actually pushes data. We just need to notice disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_loop() -> None:
    """Runs for the lifetime of the app; samples and pushes to whoever is
    connected. No-ops cheaply when nobody is listening."""
    while True:
        if manager.has_clients:
            # sample_processes() walks every running process synchronously;
            # off the event loop so a slow psutil scan doesn't stall other
            # connections.
            samples = await asyncio.to_thread(sample_processes)
            top = sorted(samples, key=lambda s: s.connection_count, reverse=True)[:20]
            await manager.broadcast(
                {
                    "type": "traffic_snapshot",
                    "processes": [
                        {"pid": s.pid, "name": s.name, "connection_count": s.connection_count}
                        for s in top
                    ],
                }
            )
        await asyncio.sleep(settings.traffic_poll_interval_sec)
