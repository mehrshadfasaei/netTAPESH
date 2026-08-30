"""
Database engine/session setup. SQLite for now (per spec: simple to start,
clear upgrade path to TimescaleDB later if NetPulse ever grows beyond a
single device).
"""
import threading
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from backend.config import settings
from backend.db.models import Base

# Make sure the sqlite file's parent directory exists (e.g. ./data/).
if settings.database_url.startswith("sqlite:///"):
    db_path = settings.database_url.replace("sqlite:///", "", 1)
    if db_path not in (":memory:",):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

if settings.database_url.startswith("sqlite"):
    # WAL mode lets the API and the two collector processes (separate
    # containers in docker-compose, all pointed at the same file via a
    # shared volume) read/write concurrently without "database is locked".
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


_init_db_lock = threading.Lock()


def init_db() -> None:
    """
    create_all() is normally safe to call repeatedly (it checks for each
    table's existence first) — but that check-then-create isn't atomic,
    so calling it from multiple threads at once (e.g. app.py's
    single-process launcher starts the API and both collectors as
    threads that each call this on startup) can race into a genuine
    'table already exists' OperationalError. A lock serializes it.
    """
    with _init_db_lock:
        Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """FastAPI dependency: yields a DB session, closes it after the request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
