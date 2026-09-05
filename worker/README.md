# Cloudflare deployment

This directory is a from-scratch JavaScript port of `backend/api/routes.py`
+ `backend/main.py` (the Python backend), built to run as a [Cloudflare
Worker with a static-assets binding](https://developers.cloudflare.com/workers/static-assets/) —
so the whole app (static site + API) can be hosted entirely on
Cloudflare's free tier, on the same origin (no CORS needed), with no
sleeping/cold-start container the way a free-tier PaaS host has.

This supersedes an earlier attempt at the same thing built as
"Cloudflare Pages Functions" (a `functions/` directory) — Cloudflare's
dashboard, when actually used, offered the newer unified Workers +
static-assets flow instead (a single `wrangler deploy`, not the
Pages-specific flow that `pages_build_output_dir` assumed), so this was
rebuilt to match what Cloudflare's real UI does today rather than an
assumption about which product line was current.

**The Python backend (`backend/`) is kept, not replaced** — it's still
the simplest way to run this locally (`uvicorn backend.main:app
--reload`) and works as a normal Docker/VPS deployment if that's ever
preferred over Cloudflare. The two implementations are independent;
keeping both in sync when an endpoint changes is a manual step.

**Not deployed or tested against real Cloudflare infrastructure from
here** — this development environment has no Cloudflare account access
(and no network egress to Cloudflare's API), so everything below is
written correctly against Cloudflare's documented behavior but hasn't
been verified end-to-end on a live account.

## How requests are routed

Per `[assets]` in `wrangler.toml`, any request matching a file under
`frontend/` is served directly — the Worker script never runs for those.
Everything else (our `/api/speedtest/*` routes, `/health`) falls through
to `worker/index.js`, which dispatches by method + path to
`worker/routes/*.js`.

## One-time setup

1. Install Wrangler (Cloudflare's CLI) if you don't have it, and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. Create the D1 database:
   ```bash
   wrangler d1 create nettapesh
   ```
   This prints a `database_id` — add it to `wrangler.toml` at the repo
   root as a new `[[d1_databases]]` block:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "nettapesh"
   database_id = "<paste it here>"
   ```

3. Apply the schema:
   ```bash
   wrangler d1 execute nettapesh --remote --file=worker/schema.sql
   ```

## Deploy

From the repo root:
```bash
wrangler deploy
```

Or connect the GitHub repo directly in the Cloudflare dashboard
(**Compute (Workers)** → **Create** → connect this repo) for auto-deploy
on every push — if the dashboard's setup screen shows a **Deploy
command** field, leave it as `npx wrangler deploy` (the default); it
reads `wrangler.toml` from the repo root the same way the CLI does, so
the D1/rate-limit bindings above still need to be added to
`wrangler.toml` (or via the dashboard's **Settings → Bindings** for that
Worker) before the API routes that use them will work.

## After deploying

- Point your domain's DNS at the Worker (**Settings → Domains &
  Routes** for the Worker) instead of at Render.
- Verify each endpoint works: `/health`, `/api/speedtest/ping`, run a
  continuous-ping round, run the main test and check it appears in
  history. The main speed test itself doesn't touch any of this (it
  talks to M-Lab directly — see `speedtest.js`'s module docstring), so
  it'll work even before any of the steps above are done; only history,
  the ISP/location display, and the continuous-ping tab depend on this
  backend.
