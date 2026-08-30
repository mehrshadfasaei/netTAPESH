# netTAPESH

A self-hosted internet speed test — ping, download, and upload — built
as a plain web page. No install, no app, no account: open the page,
click the button, get real numbers measured against your own server.

## Why self-hosted

Public speed test sites (Speedtest.net, fast.com) measure your
connection to *their* servers, which may be far away or congested in
ways that don't reflect your actual day-to-day connection to whatever
you host yourself. Running your own copy means the download/upload
servers are wherever *you* deploy this — a VPS near you, your home
server, wherever — with the same interface people already know.

## How it works

The server has three endpoints, and does no timing itself — all the
actual measurement happens in the browser, following the same
methodology real speed test services use (not naive single-request
timing):

- `GET /api/speedtest/ping` — returns instantly. Measured *first*, via
  10 sequential round trips while the link is idle (median = ping,
  average deviation = jitter) — not during the download/upload tests,
  which would inflate it with queuing delay from the load itself.
- `GET /api/speedtest/download` — streams a large amount of random data
  (default 300 MB, capped at 500 MB per stream — see config). The client
  opens **4 of these in parallel** and **aborts them once an 8-second
  test window elapses**, rather than waiting for any one to finish: a
  single TCP stream often can't saturate a fast link (window scaling and
  congestion control cap one stream's throughput well below the link's
  real capacity), so real tools use several streams at once. The first
  second of the window is discarded from the Mbps calculation — TCP's
  slow-start ramp-up otherwise under-reports steady-state speed.
- `POST /api/speedtest/upload` — reads and discards whatever's sent to
  it. The client runs **4 parallel lanes**, each looping fixed-size
  (4 MB) chunk uploads until the same 8-second window (with the same
  1-second warm-up discount) elapses — chosen over one giant upload body
  to keep browser memory bounded and give reasonably fine-grained timing
  as chunks complete.

Results are optionally saved (`POST /api/speedtest/result`) so the
dashboard can show a history chart.

## Status

Built and verified end-to-end in this environment (unlike some earlier
work in this repo's history — see git log — this doesn't depend on any
external network access, since the "server" it's testing against *is*
this app): ping/download/upload all measured with real timing against a
running instance, including the 4-parallel-connection/duration-based
download and upload methodology (simulated the exact client pattern —
4 concurrent streams, abort after a fixed window — against a live
server, confirmed correct byte totals and that the server stays healthy
afterward), correct Mbps math confirmed, result persistence and history
endpoints all working. The one thing not exercised here: real-world
network conditions (latency, packet loss, a genuinely slow link) — every
test above ran over localhost, where TCP behaves differently than over
a real internet path.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open `http://localhost:8000`. API docs (Swagger UI): `http://localhost:8000/docs`

## Running with Docker

```bash
docker compose up --build
```

Open `http://localhost:8000`. To change test sizes or ping sample count,
copy `.env.example` to `.env`, edit it, and uncomment the `env_file`
line in `docker-compose.yml`.

## Deploying somewhere real

Because accuracy depends on the server actually being reachable at
realistic latency from wherever you're testing from, this is meant to
run on a real host (a VPS, a home server with port forwarding, etc.),
not just `localhost`. Put it behind a reverse proxy (nginx, Caddy) with
TLS if you want `https://`; nothing in the app assumes a particular
domain or port.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/speedtest/ping` | Instant response — client measures round-trip |
| GET | `/api/speedtest/download?bytes=N` | Streams N random bytes (default 300MB, capped at 500MB — see "How it works") |
| POST | `/api/speedtest/upload` | Reads and discards the request body, returns bytes received |
| POST | `/api/speedtest/result` | Saves a client-computed result to history |
| GET | `/api/speedtest/latest` | Most recent saved result |
| GET | `/api/speedtest/history?range=day\|week` | Saved results over time |

## Known limitations

- **No authentication.** Anyone who can reach the server can run tests
  against it and write to its history table. Fine for personal/local
  use; put it behind auth or a firewall before exposing it more widely.
- **Single server, single history table.** Multiple people testing
  against a shared deployment all land in the same history — there's no
  per-user or per-IP separation beyond the `client_ip` column being
  recorded (not yet surfaced anywhere in the UI).
- **No server picker.** There's exactly one server: wherever you deploy
  this. Real speed test services ping several candidate servers and pick
  the closest one — irrelevant here since there's only ever one.

## Roadmap

- Per-deployment server picker if this is ever run from more than one
  location
- CI (GitHub Actions): lint + test on every push
