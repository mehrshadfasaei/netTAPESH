"""
Speed test collector — real ping + download + upload throughput, via
`speedtest-cli` against the public Speedtest.net server network (the
same infrastructure Speedtest.net/Ookla-compatible clients use — no
account, no API key). This is deliberately separate from
connectivity_collector.py's fast, cheap up/down ping: a real bandwidth
test moves real data and takes real time (typically 10-30s), so it runs
on a much longer interval (see config.speedtest_interval_sec).

Not independently verified end-to-end while building this: the sandbox
this was built in has outbound network access to arbitrary hosts
blocked by policy (the same restriction that made testing `ping`
impossible earlier in this project), so a live speedtest.net run
couldn't be exercised here. The speedtest-cli API surface used below
(Speedtest().get_best_server(), .download(), .upload(),
.results.dict()) is the library's standard documented usage pattern —
worth a real run to confirm on your machine.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from backend.config import settings
from backend.db.database import SessionLocal, init_db
from backend.db.models import SpeedtestLog


@dataclass
class SpeedtestResult:
    ping_ms: Optional[float] = None
    download_mbps: Optional[float] = None
    upload_mbps: Optional[float] = None
    server_name: Optional[str] = None
    server_country: Optional[str] = None
    error: Optional[str] = None


def run_speedtest() -> SpeedtestResult:
    """One full test. Never raises — network/server failures come back
    as a SpeedtestResult with `error` set instead, so a bad test doesn't
    take down the polling loop."""
    try:
        import speedtest
    except ImportError:
        return SpeedtestResult(error="speedtest-cli not installed (pip install speedtest-cli)")

    try:
        st = speedtest.Speedtest()
        st.get_best_server()
        download_bps = st.download()
        upload_bps = st.upload()
        results = st.results.dict()

        return SpeedtestResult(
            ping_ms=results.get("ping"),
            download_mbps=download_bps / 1_000_000,
            upload_mbps=upload_bps / 1_000_000,
            server_name=(results.get("server") or {}).get("name"),
            server_country=(results.get("server") or {}).get("country"),
        )
    except Exception as exc:
        return SpeedtestResult(error=str(exc))


def persist_result(result: SpeedtestResult) -> None:
    session = SessionLocal()
    try:
        session.add(
            SpeedtestLog(
                ping_ms=result.ping_ms,
                download_mbps=result.download_mbps,
                upload_mbps=result.upload_mbps,
                server_name=result.server_name,
                server_country=result.server_country,
                error=result.error,
            )
        )
        session.commit()
    finally:
        session.close()


def run_forever() -> None:
    init_db()
    if not settings.speedtest_enabled:
        print("[speedtest_collector] disabled via NETPULSE_SPEEDTEST_ENABLED=false, exiting")
        return

    print(f"[speedtest_collector] running a full speed test every {settings.speedtest_interval_sec:.0f}s "
          f"(Ctrl+C to stop)")
    while True:
        result = run_speedtest()
        persist_result(result)
        if result.error:
            print(f"[speedtest_collector] test failed: {result.error}")
        else:
            print(
                f"[speedtest_collector] ping={result.ping_ms:.1f}ms "
                f"download={result.download_mbps:.2f}Mbps upload={result.upload_mbps:.2f}Mbps "
                f"server={result.server_name} ({result.server_country})"
            )
        time.sleep(settings.speedtest_interval_sec)


if __name__ == "__main__":
    run_forever()
