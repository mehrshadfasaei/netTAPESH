"""SQLAlchemy models. Single table: history of self-hosted speed tests."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SpeedtestLog(Base):
    __tablename__ = "speedtest_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    ping_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    jitter_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    download_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    upload_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    client_ip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
