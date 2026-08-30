"""
Phase 1 + 2 — per-process traffic collector.

MVP scope (documented limitation, see README "Known limitations"):
`psutil` cannot report per-process byte counts on Linux without root
(nethogs/eBPF territory). What it *can* give us without any elevated
privileges is each process's currently-open network connections. So the
MVP tracks "how many active connections does each process have, and to
where" as a proxy for network activity, and leaves `bytes_sent` /
`bytes_recv` NULL until a privileged collector is wired in (roadmap).

Run standalone for a quick sanity check:
    python -m backend.collectors.traffic_collector
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass

import psutil

from backend.config import settings
from backend.db.database import SessionLocal, init_db
from backend.db.models import TrafficLog


@dataclass
class ProcessSample:
    pid: int
    name: str
    connection_count: int


def sample_processes() -> list[ProcessSample]:
    """One snapshot: every process that currently has an open network
    connection, with how many it has open."""
    samples: dict[int, ProcessSample] = {}

    for proc in psutil.process_iter(["pid", "name"]):
        try:
            conns = proc.net_connections(kind="inet")
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

        if not conns:
            continue

        samples[proc.pid] = ProcessSample(
            pid=proc.pid,
            name=proc.info.get("name") or "unknown",
            connection_count=len(conns),
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
                    bytes_sent=None,
                    bytes_recv=None,
                )
            )
        session.commit()
    finally:
        session.close()


def run_forever() -> None:
    init_db()
    print(f"[traffic_collector] polling every {settings.traffic_poll_interval_sec}s (Ctrl+C to stop)")
    while True:
        samples = sample_processes()
        persist_samples(samples)
        print(f"[traffic_collector] {len(samples)} active processes @ {time.strftime('%H:%M:%S')}")
        time.sleep(settings.traffic_poll_interval_sec)


if __name__ == "__main__":
    # Phase 1 behaviour: just print, no DB writes, for a fast sanity check.
    while True:
        samples = sample_processes()
        top = sorted(samples, key=lambda s: s.connection_count, reverse=True)[:10]
        print(f"\n=== {time.strftime('%H:%M:%S')} — {len(samples)} active processes ===")
        for s in top:
            print(f"  pid={s.pid:<7} {s.name:<25} connections={s.connection_count}")
        time.sleep(settings.traffic_poll_interval_sec)
