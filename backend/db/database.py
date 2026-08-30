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
    # WAL mode lets concurrent requests (multiple people running a test
    # at once, if this is hosted for more than just yourself) write
    # results without "database is locked".
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        except Exception:
            # Setting WAL mode itself briefly touches shared-memory/WAL
            # files that every connection races to create — seen this
            # raise a transient "disk I/O error" under several threads
            # opening connections at once during startup. WAL mode only
            # needs to succeed on *some* connection (it's a property of
            # the database file, not the connection), so a failure here
            # just means this one connection falls back to the default
            # journal mode rather than taking the whole collector down.
            pass
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


_init_db_lock = threading.Lock()


def init_db() -> None:
    """create_all() checks each table's existence before creating it,
    but that check-then-create isn't atomic under concurrent callers —
    a lock serializes it so a burst of concurrent requests at startup
    can't race into a spurious 'table already exists' error."""
    with _init_db_lock:
        Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """FastAPI dependency: yields a DB session, closes it after the request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
