"""
Phase 4 — REST API. WebSocket streaming (`/api/traffic/live`) is added in
main.py during phase 5, once this REST surface is stable.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.database import get_session
from backend.db.models import Alert, ConnectivityLog, TrafficLog

router = APIRouter(prefix="/api")

RangeParam = Literal["day", "week"]


def _range_start(range_: RangeParam) -> datetime:
    now = datetime.now(timezone.utc)
    return now - (timedelta(days=1) if range_ == "day" else timedelta(days=7))


@router.get("/traffic/history")
def traffic_history(range: RangeParam = "day", session: Session = Depends(get_session)):
    since = _range_start(range)
    rows = session.execute(
        select(
            TrafficLog.process_name,
            func.sum(TrafficLog.connection_count).label("total_connections"),
            func.sum(TrafficLog.bytes_sent).label("total_bytes_sent"),
            func.sum(TrafficLog.bytes_recv).label("total_bytes_recv"),
            func.count(TrafficLog.id).label("samples"),
        )
        .where(TrafficLog.timestamp >= since)
        .group_by(TrafficLog.process_name)
        # NULLS come from the connection-count-only fallback (see
        # traffic_collector.py); SUM() over an all-NULL group is NULL, not
        # 0, so this still sorts sensibly whichever mode produced the data.
        .order_by(
            func.sum(TrafficLog.bytes_sent + TrafficLog.bytes_recv).desc().nulls_last(),
            func.sum(TrafficLog.connection_count).desc(),
        )
    ).all()

    def to_mb(bytes_val):
        return round(bytes_val / (1024 * 1024), 3) if bytes_val is not None else None

    return {
        "range": range,
        "since": since.isoformat(),
        "processes": [
            {
                "process_name": name,
                "total_connections": total,
                "total_mb_sent": to_mb(bytes_sent),
                "total_mb_recv": to_mb(bytes_recv),
                "samples": samples,
            }
            for name, total, bytes_sent, bytes_recv, samples in rows
        ],
    }


@router.get("/connectivity/status")
def connectivity_status(session: Session = Depends(get_session)):
    latest_per_host = []
    for host in settings.connectivity_targets:
        row = session.execute(
            select(ConnectivityLog)
            .where(ConnectivityLog.target_host == host)
            .order_by(ConnectivityLog.timestamp.desc())
            .limit(1)
        ).scalar_one_or_none()
        if row is None:
            latest_per_host.append({"target_host": host, "status": "unknown", "latency_ms": None})
        else:
            latest_per_host.append(
                {
                    "target_host": row.target_host,
                    "status": row.status,
                    "latency_ms": row.latency_ms,
                    "packet_loss_pct": row.packet_loss_pct,
                    "timestamp": row.timestamp.isoformat(),
                }
            )
    return {"targets": latest_per_host}


@router.get("/connectivity/history")
def connectivity_history(range: RangeParam = "day", session: Session = Depends(get_session)):
    since = _range_start(range)
    rows = session.execute(
        select(ConnectivityLog)
        .where(ConnectivityLog.timestamp >= since)
        .order_by(ConnectivityLog.timestamp.asc())
    ).scalars().all()

    return {
        "range": range,
        "since": since.isoformat(),
        "samples": [
            {
                "timestamp": r.timestamp.isoformat(),
                "target_host": r.target_host,
                "latency_ms": r.latency_ms,
                "packet_loss_pct": r.packet_loss_pct,
                "status": r.status,
            }
            for r in rows
        ],
    }


@router.get("/alerts")
def list_alerts(limit: int = 50, session: Session = Depends(get_session)):
    rows = session.execute(
        select(Alert).order_by(Alert.timestamp.desc()).limit(limit)
    ).scalars().all()
    return {
        "alerts": [
            {
                "id": a.id,
                "timestamp": a.timestamp.isoformat(),
                "type": a.type,
                "message": a.message,
                "acknowledged": a.acknowledged,
            }
            for a in rows
        ]
    }


@router.post("/settings")
def update_settings(payload: dict):
    """
    MVP: echoes back the accepted keys. Threshold values live in
    `backend/config.py` (env-var driven); wiring this endpoint to persist
    changes at runtime (e.g. to a small settings table) is a follow-up —
    tracked in the README roadmap rather than faked here.
    """
    accepted_keys = {
        "high_usage_threshold_mb",
        "high_usage_window_sec",
        "connection_down_consecutive_failures",
        "high_latency_threshold_ms",
    }
    applied = {k: v for k, v in payload.items() if k in accepted_keys}
    return {"applied": applied, "note": "runtime persistence not yet implemented — see README roadmap"}
