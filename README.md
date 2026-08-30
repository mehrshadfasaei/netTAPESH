# netTAPESH (NetPulse)

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

Traffic + connectivity collectors, SQLite storage, the REST API,
WebSocket live streaming, and the frontend dashboard are implemented and
working end to end. Automated alerting (rule engine + Telegram
notifications) is intentionally out of scope for this version — the
`/api/alerts` endpoint and `alerts` table exist and are ready for it, but
nothing writes to them yet. Docker packaging is in progress.

- [x] Phase 1 — standalone traffic collector
- [x] Phase 2 — SQLite storage
- [x] Phase 3 — connectivity collector
- [x] Phase 4 — REST API
- [x] Phase 5 — WebSocket live streaming
- [x] Phase 6 — frontend dashboard
- [ ] ~~Phase 7 — alerting (Telegram)~~ — skipped for this version, see below
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
- **No automated alerting.** The alert rules described in the original
  spec (high usage / connection down / high latency) and Telegram
  notifications are not implemented. `/api/alerts` and the `alerts` table
  are in place for it, but nothing populates them — this is a deliberate
  scope cut, not a bug, and it's the first thing on the roadmap below.
- **Single device only.** This monitors the machine it runs on, not a
  whole home network. Multi-device support is a future direction, not
  in scope for this version.
- **Privacy.** Only metadata is collected — process name, connection
  count, destination host/port for traffic; latency/loss/up-down for
  connectivity. No packet payloads are inspected or stored.
- **Platform.** Built and tested on Linux. Cross-platform support
  (Windows/macOS) is not a current goal.
- **Traffic monitoring cannot see host processes when containerized on
  Windows/macOS.** This is the single most important limitation to
  understand: `psutil` inside a container only ever sees that
  container's own process tree. On Linux, `pid: host` in
  docker-compose fixes this. On Windows/macOS, Docker Desktop runs
  everything inside a Linux VM that has zero visibility into native
  Windows/macOS processes — no compose flag gets around that, it's
  architectural. So on Windows/macOS: **run the API and the traffic
  collector natively (not in Docker)** if you want to see your actual
  running apps; Docker there is only useful for the connectivity
  monitoring half, or for a portfolio demo of the container's own
  traffic. See "Running natively" below.
- **No authentication.** This is a personal/portfolio tool for local use,
  not meant to be exposed to the internet.

## Tech stack

Python 3.11+ / FastAPI · psutil · SQLite (SQLAlchemy, WAL mode) ·
WebSocket · Vanilla JS + Chart.js · Docker / docker-compose

## Running natively (recommended on Windows/macOS, or to see real traffic on Linux too)

This is the only way to see your actual running apps in the traffic
view — see "Known limitations" above for why Docker can't do this on
Windows/macOS.

```bash
python3 -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # optional — adjust thresholds/targets if you want

# Run the API + dashboard
uvicorn backend.main:app --reload

# Run the collectors (separate terminals)
python -m backend.collectors.traffic_collector
python -m backend.collectors.connectivity_collector
```

Open `http://localhost:8000`. API docs (Swagger UI): `http://localhost:8000/docs`

## Running with Docker

```bash
docker compose up --build
```

No `sudo`, no manual dependency install. This starts the API/dashboard
(port `8000`) and the connectivity collector, sharing one SQLite file at
`./data/netpulse.db` via a bind mount (not a named volume — that's
deliberate, see next paragraph). **`traffic-collector` is intentionally
not a Docker service** — see "Known limitations" above. To also see
per-app traffic while the rest runs in Docker, run just the traffic
collector natively alongside it (same venv steps above, just the one
command: `python -m backend.collectors.traffic_collector`), pointed at
the same `./data/netpulse.db` — the bind mount is what makes that
shared file possible.

To change thresholds or poll intervals, copy `.env.example` to `.env`,
edit it, and add an `env_file: [.env]` line to each service in
`docker-compose.yml` (left out by default so the zero-config path stays
zero-config).

## API

| Method | Path | Description |
|---|---|---|
| WS | `/api/traffic/live` | WebSocket — live per-process activity |
| GET | `/api/traffic/history?range=day\|week` | Historical traffic data |
| GET | `/api/connectivity/status` | Current connection status per target host |
| GET | `/api/connectivity/history?range=day\|week` | Historical latency/outage data |
| GET | `/api/alerts` | Recent alerts (currently always empty — see limitations) |
| POST | `/api/settings` | Accepts threshold overrides (not yet persisted at runtime) |

## Roadmap

- Alert rule engine + Telegram notifications (skipped in this version)
- Privileged traffic mode (nethogs/eBPF) for real byte-level per-process usage
- Multi-device support (home-network-wide monitoring)
- Windows/macOS collectors
- CI (GitHub Actions): lint + test on every push
