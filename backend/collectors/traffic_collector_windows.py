"""
Windows-only precise per-process network byte tracking via ETW (Event
Tracing for Windows) — the same mechanism Windows' own Task Manager /
Resource Monitor "Network" column is built on, via the
Microsoft-Windows-Kernel-Network provider.

This is the accurate alternative to the connection-count proxy used
elsewhere in this project (see traffic_collector.py): it gives real
bytes sent/received per process, not just "how many sockets are open".

Requirements:
  - Windows only (imports fail cleanly on Linux/macOS — see the
    try/except below; traffic_collector.py falls back to
    connection-count-only mode when this module isn't usable).
  - `pip install pywintrace` (imports as `etw`).
  - Must run as Administrator — starting a real-time ETW trace session
    requires elevated privileges. Without it, ETW.start() raises a
    WindowsError/PermissionError; traffic_collector.py should catch that
    and fall back rather than crash.

NOT independently verified end-to-end on a real Windows machine as part
of building this — the ETW plumbing (provider GUID, task-name/field
names below) follows the documented Microsoft-Windows-Kernel-Network
manifest and the pywintrace API, but this needs a real run to confirm
the exact field names pywintrace surfaces for this provider's events. If
`_on_event` never accumulates anything, log what keys ARE present in a
sample event (see the commented debug line) and adjust the field names
below to match.
"""
from __future__ import annotations

import logging
import threading
from collections import defaultdict
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from etw import ETW, GUID, ProviderInfo
except ImportError:  # pywintrace not installed, or not on Windows at all
    ETW = None
    GUID = None
    ProviderInfo = None

# Microsoft-Windows-Kernel-Network provider GUID — the provider Resource
# Monitor's Network tab reads from. Documented/stable GUID, not something
# that varies by Windows version.
_KERNEL_NETWORK_GUID = "{7DD42A49-5329-4832-8DFD-43D979153A88}"

# Task names for the events we care about. TCP and UDP sends/receives both
# surface under these two task names in this provider.
_SEND_TASKS = {"KERNEL_NETWORK_TASK_TCPIP", "KERNEL_NETWORK_TASK_UDPIP"}


def _is_send_event(task_name: str, event_id: int) -> Optional[bool]:
    """
    Returns True for a send event, False for a receive event, None if this
    event isn't one we care about. Determined by opcode-derived event id
    within the Kernel-Network manifest: send=10 (TCP)/42 (UDP-ish) in some
    Windows versions, but the more version-stable approach is the parsed
    'Task Name' + 'Description'/'Opcode' fields pywintrace surfaces — kept
    here as a single choke point so it's the only place to adjust if the
    field names turn out to differ on a real run.
    """
    upper = task_name.upper()
    if "DATASENT" in upper or upper.endswith("SEND"):
        return True
    if "DATARECEIVED" in upper or upper.endswith("RECV") or upper.endswith("RECEIVE"):
        return False
    return None


class WindowsByteSampler:
    """
    Runs an ETW capture in a background thread (owned by pywintrace) and
    accumulates bytes sent/received per PID. Call snapshot_and_reset()
    on the same cadence as the rest of the traffic collector to get the
    bytes accumulated since the last call.
    """

    def __init__(self) -> None:
        if ETW is None:
            raise RuntimeError(
                "pywintrace is not installed (or this isn't Windows). "
                "Run: pip install pywintrace"
            )
        self._lock = threading.Lock()
        self._bytes_sent: dict[int, int] = defaultdict(int)
        self._bytes_recv: dict[int, int] = defaultdict(int)
        self._etw = None
        self._logged_events = 0

    def _on_event(self, event_tuple) -> None:
        event_id, event = event_tuple
        task_name = event.get("Task Name", "") or ""

        if task_name.upper().replace("-", "").replace("_", "") == "" :
            return

        # Debug aid, on by default for the first few events: prints exactly
        # what pywintrace parsed so field-name mismatches are visible
        # immediately instead of showing up only as "MB stays at —". Safe
        # to leave on — capped at 3 prints total, then silent.
        if self._logged_events < 3:
            print(f"[traffic_collector_windows] sample event #{self._logged_events + 1}: {event}")
            self._logged_events += 1

        header = event.get("EventHeader", {}) or {}
        pid = header.get("ProcessId")
        size = event.get("size", event.get("Size"))

        if pid is None or size is None:
            return
        try:
            size = int(size)
        except (TypeError, ValueError):
            return

        is_send = _is_send_event(task_name, event_id)
        if is_send is None:
            return

        with self._lock:
            if is_send:
                self._bytes_sent[pid] += size
            else:
                self._bytes_recv[pid] += size

    def start(self) -> None:
        provider = ProviderInfo("Microsoft-Windows-Kernel-Network", GUID(_KERNEL_NETWORK_GUID))
        self._etw = ETW(providers=[provider], event_callback=self._on_event)
        self._etw.start()
        logger.info("[traffic_collector_windows] ETW capture started (Microsoft-Windows-Kernel-Network)")

    def stop(self) -> None:
        if self._etw is not None:
            self._etw.stop()
            self._etw = None

    def snapshot_and_reset(self) -> dict[int, dict[str, int]]:
        """Bytes accumulated per PID since the last call; clears counters."""
        with self._lock:
            pids = set(self._bytes_sent) | set(self._bytes_recv)
            result = {
                pid: {
                    "bytes_sent": self._bytes_sent.get(pid, 0),
                    "bytes_recv": self._bytes_recv.get(pid, 0),
                }
                for pid in pids
            }
            self._bytes_sent.clear()
            self._bytes_recv.clear()
        return result
