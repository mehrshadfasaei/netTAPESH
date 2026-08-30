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
    WindowsError/PermissionError; traffic_collector.py catches that and
    falls back rather than crash.

The provider's manifest (confirmed against the published
Microsoft-Windows-Kernel-Network.xml — provider GUID
{7DD42A49-5329-4832-8DFD-43D979153A88}) defines send/receive as
separate numeric event IDs under one shared task name
(KERNEL_NETWORK_TASK_TCPIP / _UDPIP), not as distinguishable task
names — so send vs. receive is decided by event_id below, not by
parsing "Task Name" text (an earlier version of this file did that and
it silently matched nothing). The manifest also defines a `PID` field
as part of each event's own payload — that's the process that actually
owns the socket, and is what's read below; the generic ETW
EventHeader.ProcessId is a different (often irrelevant, sometimes
System/0) value for kernel-mode network events and is not used.

Two keywords gate whether the provider emits IPv4/IPv6 traffic events
at all (KERNEL_NETWORK_KEYWORD_IPV4 = 0x10, _IPV6 = 0x20) — passing no
keywords (bitmask 0) was tried first and produced zero events on a
real run, so both are requested explicitly below.
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
# Monitor's Network tab reads from. Documented/stable GUID.
_KERNEL_NETWORK_GUID = "{7DD42A49-5329-4832-8DFD-43D979153A88}"

# Must be requested explicitly (see module docstring) — these are the
# provider's own keyword names, resolved to bitmask values by pywintrace's
# get_keywords_bitmask() via TdhEnumerateProviderFieldInformation.
_REQUIRED_KEYWORDS = ["KERNEL_NETWORK_KEYWORD_IPV4", "KERNEL_NETWORK_KEYWORD_IPV6"]

# Numeric event IDs from the manifest (KERNEL_NETWORK_TASK_TCPIP /
# _UDPIP events). IPv6 UDP event IDs weren't confirmed against the
# manifest while building this — if UDP traffic over IPv6 turns out to
# be missed, that's the place to add them.
_SEND_EVENT_IDS = {10, 26, 42}  # TCP-IPv4 sent, TCP-IPv6 sent, UDP-IPv4 sent
_RECV_EVENT_IDS = {11, 27, 43}  # TCP-IPv4 recv, TCP-IPv6 recv, UDP-IPv4 recv


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

        # Debug aid, on by default for the first few events: prints exactly
        # what pywintrace parsed so field-name mismatches are visible
        # immediately instead of showing up only as "MB stays at —". Safe
        # to leave on — capped at 3 prints total, then silent.
        if self._logged_events < 3:
            print(f"[traffic_collector_windows] sample event #{self._logged_events + 1} (id={event_id}): {event}")
            self._logged_events += 1

        if event_id in _SEND_EVENT_IDS:
            is_send = True
        elif event_id in _RECV_EVENT_IDS:
            is_send = False
        else:
            return

        # The event's own PID field (who owns the socket) — not
        # EventHeader.ProcessId, see module docstring.
        pid = event.get("PID")
        size = event.get("size")
        if pid is None or size is None:
            return
        try:
            pid = int(pid)
            size = int(size)
        except (TypeError, ValueError):
            return

        with self._lock:
            if is_send:
                self._bytes_sent[pid] += size
            else:
                self._bytes_recv[pid] += size

    def start(self) -> None:
        provider = ProviderInfo(
            "Microsoft-Windows-Kernel-Network",
            GUID(_KERNEL_NETWORK_GUID),
            any_keywords=_REQUIRED_KEYWORDS,
        )
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
