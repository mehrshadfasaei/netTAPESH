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

### Render.com (free tier)

`render.yaml` in this repo is a Blueprint — Render reads it and
configures the service automatically instead of you clicking through
every setting by hand:

1. Push this repo to GitHub (already done if you're reading this from
   the repo).
2. On [render.com](https://render.com), **New +** → **Blueprint** →
   connect this GitHub repo → Render detects `render.yaml` and shows
   the `nettapesh` service it's about to create → **Apply**.
3. Wait for the first build (a few minutes) — Render gives you a URL
   like `https://nettapesh-xxxx.onrender.com`.

**Two free-tier trade-offs worth knowing, not bugs:**
- The free plan has **no persistent disk**, so the SQLite history file
  resets on every redeploy/restart — the live ping/download/upload test
  itself is unaffected, only the history chart loses old data. A paid
  plan with a persistent disk (or switching to a hosted Postgres) fixes
  this if history matters to you.
- Free services **spin down after 15 minutes idle** and take ~30-60s to
  wake back up on the next request — the first test after a quiet
  period will look artificially slow/high-ping because it's waiting for
  the container to boot, not measuring your connection. Nothing to fix,
  just don't judge the first run after a gap.

### Railway / Fly.io

Both also build directly from this repo's `Dockerfile` — point either
platform's "deploy from GitHub repo" flow at this repo; no extra config
needed beyond what's already in the `Dockerfile`. Same persistent-disk
caveat as Render applies unless you attach a volume.

### A VPS (recommended if accuracy matters)

This is genuinely the best option for a speed test, not just a fallback:
a free-tier PaaS gives you no control over *where* the server sits, and
for measuring your own connection, the server's location relative to you
is the whole point. Pick a VPS in the country/city you actually want to
test against — an Iranian VPS to measure your real ISP speed inside
Iran (a foreign server would measure the international route instead,
which isn't the same thing and isn't a bug in the app), a VPS elsewhere
if that's what you actually want to test against.

No PaaS-specific config needed — this repo's `Dockerfile` and
`docker-compose.yml` already do everything:

1. Get any Linux VPS (Ubuntu 22.04+ is a safe default) with root/SSH
   access — this rules out shared/cPanel "hosting" plans, which don't
   give you a shell or let you run a custom server process; you need a
   VPS specifically. 1 vCPU / 1GB RAM is plenty; check the plan's
   **monthly bandwidth**, since each test moves real data (hundreds of
   MB per run).
2. Install Docker + the Compose plugin:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Clone this repo and start it:
   ```bash
   git clone https://github.com/mehrshadfasaei/nettapesh.git
   cd nettapesh
   docker compose up -d --build
   ```
   `restart: unless-stopped` in `docker-compose.yml` means it comes back
   up automatically after a server reboot, and `./data` is a bind mount
   (not the container's own ephemeral filesystem), so history survives
   restarts/redeploys — the opposite of the free-tier PaaS trade-off
   above.
4. Open `http://<your-server-ip>:8000`. For a real domain with
   `https://`, put a reverse proxy in front (Caddy is the least config —
   point it at `localhost:8000` and it handles TLS automatically; nginx
   + certbot works the same way with more steps).
5. Open port 8000 (or 80/443 if you're using a reverse proxy) in the
   provider's firewall/security-group panel — most VPS providers block
   everything but SSH by default.

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
