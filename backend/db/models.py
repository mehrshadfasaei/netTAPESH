"""
SQLAlchemy models — mirrors the schema in the project spec (section 4),
with one deliberate addition: `traffic_log.bytes_sent` / `bytes_recv` are
nullable. In the MVP we only get per-process *connection* data from
psutil (no root/nethogs required); real per-process byte counts are a
roadmap item. NULL means "not measured", not "zero" — keeps the schema
forward-compatible once accurate byte counting lands.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TrafficLog(Base):
    __tablename__ = "traffic_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    process_name: Mapped[str] = mapped_column(String, index=True)
    pid: Mapped[int] = mapped_column(Integer)
    # Number of active outbound/inbound connections observed for this
    # process at sample time. Always available (no elevated privileges
    # needed).
    connection_count: Mapped[int] = mapped_column(Integer, default=0)
    # Byte-level counters — NULL until a privileged collector (nethogs /
    # eBPF) is wired in. See roadmap in README.
    bytes_sent: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    bytes_recv: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class ConnectivityLog(Base):
    __tablename__ = "connectivity_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    target_host: Mapped[str] = mapped_column(String, index=True)
    latency_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    packet_loss_pct: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String)  # "up" | "down"


class SpeedtestLog(Base):
    """
    Full ping+download+upload speed tests (via speedtest-cli against
    public Speedtest.net-network servers), run on a much longer interval
    than connectivity_log's frequent up/down pings — a real bandwidth
    test moves real data and shouldn't run every 10s. See
    speedtest_collector.py.
    """
    __tablename__ = "speedtest_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    ping_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    download_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    upload_mbps: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    server_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    server_country: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Set when the test itself failed (network error, no servers found,
    # etc.) rather than ran and measured something — every numeric field
    # above stays NULL in that case, not 0.
    error: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    type: Mapped[str] = mapped_column(String)  # high_usage | connection_down | high_latency
    message: Mapped[str] = mapped_column(String)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
