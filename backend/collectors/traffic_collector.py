"""
Per-process traffic collector.

Two modes, chosen automatically:

- **Windows, with `pywintrace` installed and running as Administrator:**
  real bytes sent/received per process via ETW (see
  traffic_collector_windows.py) — accurate, MB-precise numbers.
- **Everywhere else (Linux/macOS, or Windows without admin/pywintrace):**
  the documented MVP fallback. `psutil` cannot report per-process byte
  counts on Linux without root (nethogs/eBPF territory), so instead we
  track "how many active connections does each process have, and to
  where" as a proxy for network activity. `bytes_sent`/`bytes_recv` stay
  NULL in this mode — see README "Known limitations".

Run standalone for a quick sanity check:
    python -m backend.collectors.traffic_collector
"""
from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from typing import Optional

import psutil

from backend.config import settings
from backend.db.database import SessionLocal, init_db
from backend.db.models import TrafficLog


@dataclass
class ProcessSample:
    pid: int
    name: str
    connection_count: int
    bytes_sent: Optional[int] = None
    bytes_recv: Optional[int] = None


def sample_processes(byte_deltas: Optional[dict[int, dict[str, int]]] = None) -> list[ProcessSample]:
    """
    One snapshot: every process that currently has an open network
    connection, with how many it has open — merged with per-PID byte
    deltas from the Windows ETW sampler when one is running.
    """
    byte_deltas = byte_deltas or {}
    samples: dict[int, ProcessSample] = {}

    for proc in psutil.process_iter(["pid", "name"]):
        try:
            conns = proc.net_connections(kind="inet")
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

        pid = proc.pid
        b = byte_deltas.get(pid)
        if not conns and b is None:
            continue

        samples[pid] = ProcessSample(
            pid=pid,
            name=proc.info.get("name") or "unknown",
            connection_count=len(conns),
            bytes_sent=b.get("bytes_sent") if b else None,
            bytes_recv=b.get("bytes_recv") if b else None,
        )

    # A PID with byte activity that process_iter() missed this pass (e.g.
    # an AccessDenied race, or the socket already closed) still gets
    # recorded — the byte data is the more important signal to not lose.
    for pid, b in byte_deltas.items():
        if pid in samples:
            continue
        try:
            name = psutil.Process(pid).name()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            name = "unknown"
        samples[pid] = ProcessSample(
            pid=pid,
            name=name,
            connection_count=0,
            bytes_sent=b.get("bytes_sent"),
            bytes_recv=b.get("bytes_recv"),
        )

    return list(samples.values())


def persist_samples(samples: list[ProcessSample]) -> None:
    session = SessionLocal()
    try:
        for s in samples:
            session.add(
                TrafficLog(
                    process_name=s.name,
                    pid=s.pid,
                    connection_count=s.connection_count,
                    bytes_sent=s.bytes_sent,
                    bytes_recv=s.bytes_recv,
                )
            )
        session.commit()
    finally:
        session.close()


def _start_windows_byte_sampler():
    """Best-effort: returns a started WindowsByteSampler, or None if this
    isn't Windows, pywintrace isn't installed, or we're not elevated."""
    if sys.platform != "win32":
        return None
    try:
        from backend.collectors.traffic_collector_windows import WindowsByteSampler

        sampler = WindowsByteSampler()
        sampler.start()
        print("[traffic_collector] Windows ETW byte sampler active — bytes_sent/bytes_recv are real values")
        return sampler
    except Exception as exc:
        print(
            f"[traffic_collector] Windows byte sampler unavailable ({exc}); "
            "falling back to connection-count-only mode. Run this as "
            "Administrator with 'pip install pywintrace' to enable real MB tracking."
        )
        return None


def run_forever() -> None:
    init_db()
    sampler = _start_windows_byte_sampler()
    print(f"[traffic_collector] polling every {settings.traffic_poll_interval_sec}s (Ctrl+C to stop)")
    try:
        while True:
            byte_deltas = sampler.snapshot_and_reset() if sampler else None
            samples = sample_processes(byte_deltas)
            persist_samples(samples)
            print(f"[traffic_collector] {len(samples)} active processes @ {time.strftime('%H:%M:%S')}")
            time.sleep(settings.traffic_poll_interval_sec)
    finally:
        if sampler:
            sampler.stop()


if __name__ == "__main__":
    # This is what docker-compose and the README run in production — it
    # persists to the DB. For a quick print-only sanity check without
    # touching the database, call sample_processes() directly in a repl
    # instead (see the phase-1 example in the README).
    run_forever()
