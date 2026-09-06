"""Tests for _prune_history in backend/api/routes.py — keeps the
speedtest_log table bounded by both age (settings.history_retention_days)
and row count (settings.history_max_rows). Calls _prune_history directly
rather than going through the API (it only runs on ~10% of /result calls
in production, per random.random() < 0.1 at the call site — too flaky to
rely on from outside)."""
from datetime import datetime, timedelta, timezone

from backend import config
from backend.api.routes import _prune_history
from backend.db.database import SessionLocal
from backend.db.models import SpeedtestLog


def _insert_row(session, *, days_old: float = 0):
    row = SpeedtestLog(
        timestamp=datetime.now(timezone.utc) - timedelta(days=days_old),
        ping_ms=1.0,
        jitter_ms=1.0,
        download_mbps=1.0,
        upload_mbps=1.0,
    )
    session.add(row)
    session.commit()
    return row


def test_prune_removes_rows_older_than_retention(client):
    with SessionLocal() as session:
        _insert_row(session, days_old=config.settings.history_retention_days + 1)
        _insert_row(session, days_old=0)
        _prune_history(session)
        remaining = session.query(SpeedtestLog).count()
        assert remaining == 1


def test_prune_keeps_rows_within_retention(client):
    with SessionLocal() as session:
        _insert_row(session, days_old=config.settings.history_retention_days - 1)
        _insert_row(session, days_old=0)
        _prune_history(session)
        remaining = session.query(SpeedtestLog).count()
        assert remaining == 2


def test_prune_enforces_max_row_cap(client, monkeypatch):
    monkeypatch.setattr(config.settings, "history_max_rows", 3)
    with SessionLocal() as session:
        # Insert 5 rows, oldest first, none of them old enough to be
        # pruned by retention alone — only the row-count cap should act.
        for i in range(5, 0, -1):
            _insert_row(session, days_old=i * 0.01)
        _prune_history(session)
        remaining = session.query(SpeedtestLog).order_by(SpeedtestLog.timestamp.asc()).all()
        assert len(remaining) == 3
        # The rows kept should be the 3 most recent (smallest days_old).
        assert remaining[0].timestamp > remaining[-1].timestamp - timedelta(days=100)
