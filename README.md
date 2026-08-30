# NetPulse

A local network traffic and connection-quality monitoring tool.

Two things, on one machine:

1. **Per-application traffic monitoring** — which processes are actively
   using the network, similar in spirit to a lightweight GlassWire.
2. **Connection quality/stability monitoring** — periodic latency /
   packet-loss / outage checks against a few reference hosts, logged over
   time. This is the part most similar tools skip: it's built for
   environments with frequent, unpredictable internet instability, where
   knowing *when* and *how often* your connection degraded matters as
   much as knowing your bandwidth usage.

## Status

Implemented so far: traffic collector, connectivity collector, SQLite
storage, and the REST API (history/status/alerts/settings endpoints).
WebSocket live streaming, the frontend dashboard, Telegram alerting, and
Docker packaging are still in progress — see the phases below.

- [x] Phase 1 — standalone traffic collector
- [x] Phase 2 — SQLite storage
- [x] Phase 3 — connectivity collector
- [x] Phase 4 — REST API
- [ ] Phase 5 — WebSocket live streaming
- [ ] Phase 6 — frontend dashboard
- [ ] Phase 7 — alerting (Telegram)
- [ ] Phase 8 — Docker + docs
- [ ] Phase 9 — CI/CD

## Known limitations (read this before judging the traffic numbers)

- **Per-process byte counts are not available in this version.**
  `psutil` cannot report per-process bytes sent/received on Linux without
  root and a privileged tool like `nethogs` or an eBPF-based collector.
  Rather than requiring `sudo` for what's meant to be a
  `docker-compose up`-and-go tool, the traffic collector currently
  reports **active connection counts per process** (which app is talking
  to which host, and how many open connections it has) instead of exact
  data volume. Accurate byte-level tracking via `nethogs`/eBPF is on the
  roadmap as an opt-in, privileged mode.
- **Single device only.** This monitors the machine it runs on, not a
  whole home network. Multi-device support is a future direction, not
  in scope for this version.
- **Privacy.** Only metadata is collected — process name, connection
  count, destination host/port for traffic; latency/loss/up-down for
  connectivity. No packet payloads are inspected or stored.
- **Platform.** Built and tested on Linux. Cross-platform support
  (Windows/macOS) is not a current goal.
- **No authentication.** This is a personal/portfolio tool for local use,
  not meant to be exposed to the internet.

## Tech stack

Python 3.11+ / FastAPI · psutil · SQLite (SQLAlchemy) · WebSocket ·
Vanilla JS + Chart.js · Telegram Bot API · Docker

## Running locally (development)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # adjust thresholds/targets if you want

# Run the API
uvicorn backend.main:app --reload

# Run the collectors (separate terminals)
python -m backend.collectors.traffic_collector
python -m backend.collectors.connectivity_collector
```

API docs (Swagger UI) once the server is running: `http://localhost:8000/docs`

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/traffic/live` | WebSocket — live per-process activity (phase 5) |
| GET | `/api/traffic/history?range=day\|week` | Historical traffic data |
| GET | `/api/connectivity/status` | Current connection status per target host |
| GET | `/api/connectivity/history?range=day\|week` | Historical latency/outage data |
| GET | `/api/alerts` | Recent alerts |
| POST | `/api/settings` | Update alert thresholds |

## Roadmap

- Privileged traffic mode (nethogs/eBPF) for real byte-level per-process usage
- Multi-device support (home-network-wide monitoring)
- Windows/macOS collectors
