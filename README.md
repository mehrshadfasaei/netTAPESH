# netTAPESH

An internet speed test — ping, download, and upload — built as a plain
web page. No install, no app, no account: open the page, click the
button, get real numbers.

## Why not just Speedtest.net / fast.com?

Public speed test sites measure your connection to *their* servers,
picked automatically as whichever is "nearest" your connection —
usually meaning a server inside your own country. That's the right
number for "is my ISP giving me what I pay for", but it's the wrong
number if what you actually care about is your connection's quality to
the outside world (international routing, undersea cables, cross-border
peering) — which is a real, separate question for anyone testing from a
heavily-filtered or poorly-peered country. netTAPESH's main test
answers that second question specifically: it measures against
[M-Lab](https://www.measurementlab.net/)'s free, open, globally
distributed measurement network (see `frontend/js/vendor/ndt7/`) —
M-Lab's server-selection logic still picks whatever's "nearest" by
network path, which won't always land in Europe specifically (could be
the Middle East, Turkey, etc.), but in practice it's consistently
somewhere outside the tester's own country's network, which is the
point. Because the test runs entirely in the browser against M-Lab —
not against this app's own backend — the result doesn't depend on
where netTAPESH itself happens to be hosted: the site can live on cheap
in-country hosting while the numbers it reports still reflect
international connection quality.

netTAPESH is a public, non-profit measurement platform, not a private
company's product — using it means results (metrics + client IP)
become part of M-Lab's public open dataset (see their
[data policy](https://www.measurementlab.net/data-policy/)) — worth
knowing before pointing real users at it.

## How it works

**Main test** ("تست سرعت" tab): runs [ndt7](https://github.com/m-lab/ndt7-js)
(vendored locally, not loaded from a CDN) entirely client-side against
M-Lab's network — locates a server, then runs a ~10s download and ~10s
upload over WebSocket, both reported live as they run. "Ping" is
approximated from the server's periodic TCPInfo round-trip-time reports
during the download (M-Lab has no separate idle-ping phase the way this
app's own backend does — see below) — occasionally unavailable, in
which case the UI shows "—" for ping/jitter rather than a made-up
number.

**Continuous ping tab**: a genuinely different, separate feature — it
deliberately tests the connection to *this app's own server*, not
international quality, so it keeps its own backend endpoints instead:

- `GET /api/speedtest/ping` — returns instantly, used both for repeated
  round-trip timing and, in the continuous-ping tab, a rapid-fire
  ping/download/upload loop.
- `GET /api/speedtest/download` / `POST /api/speedtest/upload` — small,
  fast probes sized for that loop (not the main test's methodology).

Results from the main test are optionally saved
(`POST /api/speedtest/result`) so the dashboard can show a history
chart.

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

Put this behind TLS (`https://`) rather than serving it plain — nothing
in the app assumes a particular domain or port, so any of the options
below work.

Where you host this only matters for the **continuous-ping tab** and
**history** (both genuinely test/depend on *this app's own server* —
see the module docstring at the top of `frontend/js/speedtest.js`). The
**main speed test doesn't care where you host it at all** — it measures
against M-Lab's network directly from the browser, not against this
app's backend.

### Cloudflare Pages (recommended — free, and not filtered from Iran the
way most PaaS hosts are)

See `functions/README.md` for the full walkthrough (D1 database setup,
rate-limit bindings, deploying). In short: `functions/` at the repo root
is a from-scratch JavaScript port of `backend/api/routes.py`, built to
run as [Cloudflare Pages
Functions](https://developers.cloudflare.com/pages/functions/) — static
frontend and API served from the same Cloudflare domain, no separate
server to keep running, no cold-start sleep. **Not verified against a
real Cloudflare account from this dev environment** (no network egress
to Cloudflare's API here) — follow `functions/README.md`'s steps on
your own machine and report back if anything doesn't match.

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

### A VPS

Gives you full control and a persistent disk, at the cost of actually
paying for and maintaining a server — worth it if Cloudflare's free
tier's limits (D1's row/request quotas, Workers' request-count cap) ever
become a real constraint, or if you'd rather self-host the backend for
its own sake. Doesn't affect the main test's accuracy the way it would
have before the M-Lab migration (see above) — only the continuous-ping
tab and history depend on the backend's own location/uptime.

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
