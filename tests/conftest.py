"""Shared pytest fixtures for the backend test suite.

The database engine (backend/db/database.py) is created at IMPORT TIME
from settings.database_url — so the env var pointing at a throwaway
test database has to be set before `backend.*` is ever imported
anywhere in this process, not just before the fixtures below run. That
happens once, here, at collection time (conftest.py is always imported
before any test module).
"""
import os
import tempfile

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.environ["NETPULSE_DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ["NETPULSE_DEBUG"] = "false"

import pytest
from fastapi.testclient import TestClient

from backend.api.routes import limiter
from backend.db.database import engine, init_db
from backend.db.models import Base
from backend.main import app


@pytest.fixture(autouse=True)
def _clean_database_and_rate_limits():
    """Runs before AND after every test — a fresh, empty speedtest_log
    table and a reset rate limiter each time, so tests can't see each
    other's rows or trip a limit some earlier test already spent (the
    limiter is process-global in-memory state, keyed by client "IP",
    and every TestClient request looks like it comes from the same
    place)."""
    init_db()
    limiter.reset()
    yield
    Base.metadata.drop_all(bind=engine)
    limiter.reset()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    os.close(_db_fd)
    os.unlink(_db_path)
