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

from backend.collectors.traffic_collector import _start_windows_byte_sampler, sample_processes
from backend.config import settings

# Separate sampler instance from the standalone traffic_collector process
# (this runs inside the API process, e.g. under uvicorn) — same Windows
# ETW mechanism, own accumulation window, started once at import time.
_byte_sampler = _start_windows_byte_sampler()


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
    connected. Draining the byte sampler every tick (not just when
    someone's connected) keeps each window's bytes meaningful instead of
    dumping an hour of backlog on the first client that connects."""
    tick = 0
    while True:
        tick += 1
        byte_deltas = _byte_sampler.snapshot_and_reset() if _byte_sampler else None
        if manager.has_clients:
            # Deliberately NOT offloaded to a worker thread (no
            # asyncio.to_thread) — on Windows, psutil calls made from a
            # thread pool thread that never ran CoInitialize can behave
            # differently (silently return less than a call from the
            # collector's own dedicated thread does). A local walk of
            # ~50 processes takes single-digit milliseconds, so blocking
            # the loop briefly every poll interval is a non-issue for a
            # single-user local dashboard.
            try:
                samples = sample_processes(byte_deltas)
            except Exception as exc:
                print(f"[websocket] sample_processes() failed: {exc!r}")
                samples = []
            if tick <= 3:
                print(f"[websocket] tick {tick}: {len(samples)} process samples for the live view")
            sort_key = (
                (lambda s: (s.bytes_sent or 0) + (s.bytes_recv or 0))
                if byte_deltas
                else (lambda s: s.connection_count)
            )
            top = sorted(samples, key=sort_key, reverse=True)[:20]
            await manager.broadcast(
                {
                    "type": "traffic_snapshot",
                    "processes": [
                        {
                            "pid": s.pid,
                            "name": s.name,
                            "connection_count": s.connection_count,
                            "bytes_sent": s.bytes_sent,
                            "bytes_recv": s.bytes_recv,
                        }
                        for s in top
                    ],
                }
            )
        await asyncio.sleep(settings.traffic_poll_interval_sec)
