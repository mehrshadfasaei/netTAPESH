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
actual measurement happens in the browser:

- `GET /api/speedtest/ping` — returns instantly; the client fires this
  repeatedly and times the round trips itself (median = ping, average
  deviation = jitter).
- `GET /api/speedtest/download?bytes=N` — streams N bytes of random
  data; the client reads the response stream and times bytes-received
  against elapsed time.
- `POST /api/speedtest/upload` — reads and discards whatever's sent to
  it; the client times how long *it took to send* N bytes (via
  `XMLHttpRequest`'s upload progress events, which `fetch` doesn't
  expose).

Results are optionally saved (`POST /api/speedtest/result`) so the
dashboard can show a history chart.

## Status

Built and verified end-to-end in this environment (unlike some earlier
work in this repo's history — see git log — this doesn't depend on any
external network access, since the "server" it's testing against *is*
this app): ping/download/upload all measured with real timing against a
running instance, correct Mbps math confirmed, result persistence and
history endpoints all working.

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
| GET | `/api/speedtest/download?bytes=N` | Streams N random bytes (default 25MB, capped at 50MB) |
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
- **Upload progress relies on `XMLHttpRequest`**, not `fetch`, because
  `fetch` still doesn't expose upload progress events in any browser as
  of writing. This is deliberate, not an oversight.

## Roadmap

- Multiple parallel connections for download/upload (closer to how
  Speedtest.net saturates a connection; single-connection tests can
  under-report on very fast links)
- Per-deployment server picker if this is ever run from more than one
  location
- CI (GitHub Actions): lint + test on every push
