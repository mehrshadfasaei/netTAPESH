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

import httpx
from fastapi import APIRouter, Depends, Query, Request
from slowapi import Limiter
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from backend.config import settings
from backend.db.database import get_session
from backend.db.models import SpeedtestLog

router = APIRouter(prefix="/api")

RangeParam = Literal["day", "week"]


def _extract_client_ip(request: Request) -> str | None:
    # Render (and most PaaS reverse proxies) put the real visitor IP in
    # X-Forwarded-For, not request.client.host — that's the proxy's own
    # address. X-Forwarded-For can be a comma-separated chain if there
    # were multiple hops; the first entry is the original client.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _limiter_key(request: Request) -> str:
    """Rate-limit by the real client IP, not the reverse proxy's — reuses
    _extract_client_ip above; without it, every visitor behind the same
    proxy (i.e. everyone, once this is deployed behind Caddy/nginx)
    would share one rate-limit bucket."""
    return _extract_client_ip(request) or "unknown"


# One shared limiter for the whole API. Limits below are deliberately
# generous, not tight — a single legitimate test run already makes a
# real burst of requests (4 parallel download streams, dozens of
# upload-chunk POSTs within the 8s test window, ping every ~300ms
# during the continuous-ping loop), so these are sized to comfortably
# clear normal usage while still capping a script hammering the
# bandwidth-heavy endpoints continuously. Applied per endpoint below,
# not globally, since different endpoints have very different normal
# call rates.
limiter = Limiter(key_func=_limiter_key)

# One chunk of random bytes, reused (not regenerated) across a whole
# download response — the client is timing raw transfer throughput, not
# our RNG's speed, and re-slicing the same buffer is effectively free.
_CHUNK_SIZE = 256 * 1024
_RANDOM_CHUNK = os.urandom(_CHUNK_SIZE)


def _range_start(range_: RangeParam) -> datetime:
    now = datetime.now(timezone.utc)
    return now - (timedelta(days=1) if range_ == "day" else timedelta(days=7))


@router.get("/speedtest/ping")
@limiter.limit("180/minute")
def speedtest_ping(request: Request):
    """Round-trip target for the client's latency/jitter measurement —
    deliberately does nothing but return immediately."""
    return {"pong": True}


@router.get("/speedtest/client-info")
@limiter.limit("20/minute")
async def speedtest_client_info(request: Request):
    """ISP name + city/country for the display around the GO button —
    looked up by IP via ip-api.com's free tier (no key required, ~45
    req/min limit). Deliberately looks up the *client's* IP specifically
    (not calling ip-api.com from our own outbound connection, which
    would just describe the server's own hosting provider/location
    instead of the visitor's)."""
    client_ip = _extract_client_ip(request)
    if not client_ip:
        return {"isp": None, "location": None, "ip": None}

    # Private/loopback addresses (local dev, or a proxy that didn't set
    # X-Forwarded-For) aren't geolocatable — ip-api.com would just
    # return a "private range" error for these, so skip the call.
    if client_ip in ("127.0.0.1", "::1") or client_ip.startswith(("10.", "192.168.", "172.16.")):
        return {"isp": None, "location": None, "ip": client_ip}

    try:
        async with httpx.AsyncClient(timeout=3.0) as http_client:
            resp = await http_client.get(
                f"http://ip-api.com/json/{client_ip}",
                params={"fields": "status,isp,city,country,query"},
            )
        data = resp.json()
        if data.get("status") != "success":
            return {"isp": None, "location": None, "ip": client_ip}
        location = "، ".join(filter(None, [data.get("city"), data.get("country")]))
        return {"isp": data.get("isp"), "location": location or None, "ip": data.get("query")}
    except Exception:
        # Best-effort — a failed lookup shouldn't break the page, the
        # frontend just shows nothing in the ISP/location slots.
        return {"isp": None, "location": None, "ip": client_ip}


@router.get("/speedtest/download")
@limiter.limit("60/minute")
def speedtest_download(request: Request, bytes: int = Query(default=None, ge=1)):
    """Streams `bytes` (default settings.default_download_bytes, capped
    at settings.max_download_bytes) of random data. Deliberately large —
    the client (frontend/js/speedtest.js) runs several of these in
    parallel and aborts them once its test duration elapses, rather than
    waiting for any one of them to finish; see module docstring."""
    total = min(bytes or settings.default_download_bytes, settings.max_download_bytes)

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
@limiter.limit("180/minute")
async def speedtest_upload(request: Request):
    """Reads and discards the request body in chunks (never loads it all
    into memory at once), returns how many bytes it actually received.
    The client measures elapsed time against the bytes *it sent*, not
    this response — this endpoint is just a sink."""
    total = 0
    cap = settings.upload_chunk_bytes * 4  # generous slack over one client chunk
    async for chunk in request.stream():
        total += len(chunk)
        if total > cap:
            break
    return {"received_bytes": total}


@router.post("/speedtest/result")
@limiter.limit("20/minute")
def speedtest_result(request: Request, payload: dict, session: Session = Depends(get_session)):
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


def _row_serialize_timestamp(ts: datetime) -> str:
    """SQLite drops tzinfo on round-trip (models.py sets timestamp via
    utcnow(), but what comes back from a query has tzinfo=None even
    though the value IS UTC) — isoformat() on a naive datetime omits any
    'Z'/offset, and `new Date(...)` in JS treats a timezone-less
    date-time string as LOCAL time, silently shifting every point on the
    history chart by the viewer's UTC offset. Stamp UTC back on before
    formatting so the string is unambiguous."""
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.isoformat()


def _row_to_dict(r: SpeedtestLog) -> dict:
    return {
        "timestamp": _row_serialize_timestamp(r.timestamp),
        "ping_ms": r.ping_ms,
        "jitter_ms": r.jitter_ms,
        "download_mbps": r.download_mbps,
        "upload_mbps": r.upload_mbps,
    }


@router.get("/speedtest/latest")
@limiter.limit("60/minute")
def speedtest_latest(request: Request, session: Session = Depends(get_session)):
    row = session.execute(
        select(SpeedtestLog).order_by(SpeedtestLog.timestamp.desc()).limit(1)
    ).scalar_one_or_none()
    return {"result": _row_to_dict(row) if row else None}


@router.get("/speedtest/history")
@limiter.limit("60/minute")
def speedtest_history(
    request: Request,
    # Literal["day", "week"] spelled out here instead of the RangeParam
    # alias — with `from __future__ import annotations` (this file's
    # first line) every annotation becomes a lazily-evaluated string,
    # and slowapi's @limiter.limit wrapper doesn't propagate enough of
    # this module's namespace for Pydantic to resolve the ForwardRef
    # to RangeParam when FastAPI builds this route (fails at import
    # time with "TypeAdapter[...] is not fully defined"). A literal
    # inline type has nothing to resolve, so it's unaffected.
    range: Literal["day", "week"] = "day",
    session: Session = Depends(get_session),
):
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
