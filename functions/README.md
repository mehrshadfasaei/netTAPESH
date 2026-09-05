# Cloudflare Pages deployment

This directory (`functions/`, at the repo root — required by Cloudflare
Pages' convention, see [Routing](https://developers.cloudflare.com/pages/functions/routing/))
is a from-scratch JavaScript port of `backend/api/routes.py` (the Python
backend), built to run as [Cloudflare Pages
Functions](https://developers.cloudflare.com/pages/functions/) instead —
so the whole app (static site + API) can be hosted entirely on
Cloudflare's free tier, on the same origin (no CORS needed), with no
sleeping/cold-start container the way a free-tier PaaS host has.

**The Python backend (`backend/`) is kept, not replaced** — it's still
the simplest way to run this locally (`uvicorn backend.main:app
--reload`) and works as a normal Docker/VPS deployment if that's ever
preferred over Cloudflare. The two implementations are independent;
keeping both in sync when an endpoint changes is a manual step.

**Not deployed or tested against real Cloudflare infrastructure from
here** — this development environment has no Cloudflare account access
(and no network egress to Cloudflare's API), so everything below is
written correctly against Cloudflare's documented behavior but hasn't
been verified end-to-end on a live account. Follow the steps below on
your own machine, where `wrangler` can actually reach Cloudflare.

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
   This prints a `database_id` — copy it into `wrangler.toml` at the repo
   root, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

3. Apply the schema:
   ```bash
   wrangler d1 execute nettapesh --remote --file=functions/schema.sql
   ```

4. Rate limiting bindings (`[[ratelimits]]` in `wrangler.toml`) need no
   separate setup — they're created automatically from the config the
   first time you deploy.

## Deploy

From the repo root:
```bash
wrangler pages deploy frontend --project-name=nettapesh
```
(`frontend` here is `pages_build_output_dir` from `wrangler.toml` — the
static files Pages serves; `functions/` is picked up automatically
because it sits at the repo root alongside it.)

Or connect the GitHub repo directly in the Cloudflare dashboard
(Workers & Pages → Create → Pages → Connect to Git) for auto-deploy on
every push — set the build output directory to `frontend` and leave the
build command empty (nothing to build, it's plain HTML/CSS/JS). If you
deploy this way instead of via `wrangler pages deploy`, add the D1 and
rate-limit bindings through the dashboard under your Pages project's
**Settings → Functions** instead of relying on `wrangler.toml` (Git-based
deploys don't read it the same way the CLI does) — same `binding` names
as in `wrangler.toml` (`DB`, `RL_PING`, `RL_CLIENT_INFO`, etc.) so the
code above finds them.

## After deploying

- Point your domain's DNS at the Pages project (**Custom domains** tab
  in the Pages project settings) instead of at Render.
- Verify each endpoint works: `/health`, `/api/speedtest/ping`, run a
  continuous-ping round, run the main test and check it appears in
  history. The main speed test itself doesn't touch any of this (it
  talks to M-Lab directly — see `speedtest.js`'s module docstring), so
  it'll work even before any of the steps above are done; only history,
  the ISP/location display, and the continuous-ping tab depend on this
  backend.
