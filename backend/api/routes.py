"""
Self-hosted speed test API. Everything here runs against this server —
no dependency on an external speedtest.net/Ookla server network — so a
"download" test streams bytes *from* this server and an "upload" test
streams bytes *to* it; the client times both itself.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from backend.config import settings
from backend.db.database import get_session
from backend.db.models import SpeedtestLog

router = APIRouter(prefix="/api")

RangeParam = Literal["day", "week"]

# One chunk of random bytes, reused (not regenerated) across a whole
# download response — the client is timing raw transfer throughput, not
# our RNG's speed, and re-slicing the same buffer is effectively free.
_CHUNK_SIZE = 256 * 1024
_RANDOM_CHUNK = os.urandom(_CHUNK_SIZE)


def _range_start(range_: RangeParam) -> datetime:
    now = datetime.now(timezone.utc)
    return now - (timedelta(days=1) if range_ == "day" else timedelta(days=7))


@router.get("/speedtest/ping")
def speedtest_ping():
    """Round-trip target for the client's latency/jitter measurement —
    deliberately does nothing but return immediately."""
    return {"pong": True}


@router.get("/speedtest/download")
def speedtest_download(bytes: int = Query(default=None, ge=1)):
    """Streams `bytes` (default settings.default_download_bytes, capped
    at settings.max_test_bytes) of random data. The client measures
    elapsed time against Content-Length itself."""
    total = min(bytes or settings.default_download_bytes, settings.max_test_bytes)

    def generate():
        remaining = total
        while remaining > 0:
            n = min(_CHUNK_SIZE, remaining)
            yield _RANDOM_CHUNK[:n]
            remaining -= n

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={"Content-Length": str(total), "Cache-Control": "no-store"},
    )


@router.post("/speedtest/upload")
async def speedtest_upload(request: Request):
    """Reads and discards the request body in chunks (never loads it all
    into memory at once), returns how many bytes it actually received.
    The client measures elapsed time against the bytes *it sent*, not
    this response — this endpoint is just a sink."""
    total = 0
    cap = settings.max_test_bytes
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            break
    return {"received_bytes": total}


@router.post("/speedtest/result")
def speedtest_result(payload: dict, request: Request, session: Session = Depends(get_session)):
    """Client submits its own computed numbers (all the actual timing
    happens client-side, against /ping, /download, /upload above) so
    they show up in history."""
    row = SpeedtestLog(
        ping_ms=payload.get("ping_ms"),
        jitter_ms=payload.get("jitter_ms"),
        download_mbps=payload.get("download_mbps"),
        upload_mbps=payload.get("upload_mbps"),
        client_ip=request.client.host if request.client else None,
    )
    session.add(row)
    session.commit()
    return {"status": "saved", "id": row.id}


def _row_to_dict(r: SpeedtestLog) -> dict:
    return {
        "timestamp": r.timestamp.isoformat(),
        "ping_ms": r.ping_ms,
        "jitter_ms": r.jitter_ms,
        "download_mbps": r.download_mbps,
        "upload_mbps": r.upload_mbps,
    }


@router.get("/speedtest/latest")
def speedtest_latest(session: Session = Depends(get_session)):
    row = session.execute(
        select(SpeedtestLog).order_by(SpeedtestLog.timestamp.desc()).limit(1)
    ).scalar_one_or_none()
    return {"result": _row_to_dict(row) if row else None}


@router.get("/speedtest/history")
def speedtest_history(range: RangeParam = "day", session: Session = Depends(get_session)):
    since = _range_start(range)
    rows = session.execute(
        select(SpeedtestLog)
        .where(SpeedtestLog.timestamp >= since)
        .order_by(SpeedtestLog.timestamp.asc())
    ).scalars().all()
    return {
        "range": range,
        "since": since.isoformat(),
        "results": [_row_to_dict(r) for r in rows],
    }
