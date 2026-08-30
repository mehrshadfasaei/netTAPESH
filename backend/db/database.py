"""
Database engine/session setup. SQLite for now (per spec: simple to start,
clear upgrade path to TimescaleDB later if NetPulse ever grows beyond a
single device).
"""
from pathlib import Path

from sqlalchemy import create_engine
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

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """FastAPI dependency: yields a DB session, closes it after the request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
