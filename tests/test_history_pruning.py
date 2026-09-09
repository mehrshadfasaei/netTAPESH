"""Tests for _prune_history in backend/api/routes.py — keeps the
speedtest_log table bounded by both age (settings.history_retention_days)
and row count (settings.history_max_rows). Calls _prune_history directly
rather than going through the API (it only runs on ~10% of /result calls
in production, per random.random() < 0.1 at the call site — too flaky to
rely on from outside)."""
from datetime import UTC, datetime, timedelta

from backend import config
from backend.api.routes import _prune_history
from backend.db.database import SessionLocal
from backend.db.models import SpeedtestLog


def _insert_row(session, *, days_old: float = 0, marker: float = 1.0):
    # `marker` (stashed in download_mbps, otherwise unused by these
    # tests) exists so a test can identify *which* rows survived
    # pruning by value, not just count them — timestamps alone are
    # awkward to assert on directly since they're each computed
    # relative to datetime.now() at insert time.
    row = SpeedtestLog(
        timestamp=datetime.now(UTC) - timedelta(days=days_old),
        ping_ms=1.0,
        jitter_ms=1.0,
        download_mbps=marker,
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
        # marker=i doubles as "how old" (5 = oldest .. 1 = newest), so
        # the surviving rows can be identified by value below, not just
        # counted.
        for i in range(5, 0, -1):
            _insert_row(session, days_old=i * 0.01, marker=float(i))
        _prune_history(session)
        remaining = session.query(SpeedtestLog).order_by(SpeedtestLog.timestamp.asc()).all()
        # Must be exactly the 3 newest rows (marker 3, 2, 1) — asserting
        # only len()==3 (as an earlier version of this test did) would
        # still pass if _prune_history's row-cap branch regressed to
        # keeping the oldest rows instead (e.g. an .asc()/.desc() flip
        # on the ordering it deletes by).
        assert [r.download_mbps for r in remaining] == [3.0, 2.0, 1.0]
