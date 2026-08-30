"""
Phase 3 — connectivity collector.

Shells out to the system `ping` binary (rather than a raw-socket library
like `ping3`) specifically so this does NOT need root/admin — `ping` on
Linux carries its own setuid/capability handling already.
"""
from __future__ import annotations

import re
import subprocess
import time
from dataclasses import dataclass

from backend.config import settings
from backend.db.database import SessionLocal, init_db
from backend.db.models import ConnectivityLog

# GNU ping (iputils) output, single packet, e.g.:
#   1 packets transmitted, 1 received, 0% packet loss, time 0ms
#   rtt min/avg/max/mdev = 12.345/12.345/12.345/0.000 ms
_LOSS_RE = re.compile(r"(\d+(?:\.\d+)?)% packet loss")
_RTT_RE = re.compile(r"rtt [\w/]+ = [\d.]+/([\d.]+)/")


@dataclass
class PingResult:
    host: str
    latency_ms: float | None
    packet_loss_pct: float
    status: str  # "up" | "down"


def ping_host(host: str, timeout_sec: float) -> PingResult:
    try:
        proc = subprocess.run(
            ["ping", "-c", "1", "-W", str(max(1, int(timeout_sec))), host],
            capture_output=True,
            text=True,
            timeout=timeout_sec + 2,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return PingResult(host=host, latency_ms=None, packet_loss_pct=100.0, status="down")

    output = proc.stdout
    loss_match = _LOSS_RE.search(output)
    packet_loss = float(loss_match.group(1)) if loss_match else 100.0

    rtt_match = _RTT_RE.search(output)
    latency = float(rtt_match.group(1)) if rtt_match else None

    status = "up" if proc.returncode == 0 and latency is not None else "down"
    return PingResult(host=host, latency_ms=latency, packet_loss_pct=packet_loss, status=status)


class ConnectivityCollector:
    """Tracks consecutive-failure state per host for the connection_down
    alert rule (spec section 6, rule 2) — the collector owns this state
    since it's the thing doing the pinging every tick."""

    def __init__(self) -> None:
        self._consecutive_failures: dict[str, int] = {}

    def poll_once(self) -> list[PingResult]:
        results = []
        for host in settings.connectivity_targets:
            result = ping_host(host, settings.ping_timeout_sec)
            results.append(result)
            if result.status == "down":
                self._consecutive_failures[host] = self._consecutive_failures.get(host, 0) + 1
            else:
                self._consecutive_failures[host] = 0
        return results

    def consecutive_failures(self, host: str) -> int:
        return self._consecutive_failures.get(host, 0)


def persist_results(results: list[PingResult]) -> None:
    session = SessionLocal()
    try:
        for r in results:
            session.add(
                ConnectivityLog(
                    target_host=r.host,
                    latency_ms=r.latency_ms,
                    packet_loss_pct=r.packet_loss_pct,
                    status=r.status,
                )
            )
        session.commit()
    finally:
        session.close()


def run_forever() -> None:
    init_db()
    collector = ConnectivityCollector()
    print(f"[connectivity_collector] pinging {settings.connectivity_targets} every "
          f"{settings.connectivity_poll_interval_sec}s (Ctrl+C to stop)")
    while True:
        results = collector.poll_once()
        persist_results(results)
        for r in results:
            print(f"[connectivity_collector] {r.host:<15} status={r.status:<4} "
                  f"latency={r.latency_ms}ms loss={r.packet_loss_pct}%")
        time.sleep(settings.connectivity_poll_interval_sec)


if __name__ == "__main__":
    collector = ConnectivityCollector()
    while True:
        results = collector.poll_once()
        print(f"\n=== {time.strftime('%H:%M:%S')} ===")
        for r in results:
            print(f"  {r.host:<15} status={r.status:<4} latency={r.latency_ms}ms loss={r.packet_loss_pct}%")
        time.sleep(settings.connectivity_poll_interval_sec)
