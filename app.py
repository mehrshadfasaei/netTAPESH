"""
Single-process launcher for netTAPESH — the entry point PyInstaller
bundles into one .exe (see README "Single-file download (Windows)").

Unlike the dev/Docker setup (uvicorn + two separate collector processes
in separate terminals — see README "Running natively"), this runs the
API and both collectors as background threads inside one process, and
opens the dashboard in the default browser automatically. No admin
privileges are required or requested — running unelevated means the
Windows ETW byte sampler (traffic_collector_windows.py) simply can't
start and the app transparently falls back to the connection-count
proxy (see backend/collectors/traffic_collector.py and the README's
"Known limitations" — this is the intentional trade-off for a true
download-and-double-click experience, chosen over requiring UAC for
byte-accurate MB numbers).
"""
import threading
import time
import webbrowser

import uvicorn

from backend.collectors import connectivity_collector, traffic_collector
from backend.main import app


def _open_browser_when_ready(url: str, delay_sec: float = 1.5) -> None:
    time.sleep(delay_sec)
    webbrowser.open(url)


def main() -> None:
    host, port = "127.0.0.1", 8000
    url = f"http://{host}:{port}"

    threading.Thread(target=traffic_collector.run_forever, daemon=True).start()
    threading.Thread(target=connectivity_collector.run_forever, daemon=True).start()
    threading.Thread(target=_open_browser_when_ready, args=(url,), daemon=True).start()

    print(f"netTAPESH starting at {url} — opening your browser shortly...")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
