"""Central configuration. Values can be overridden via environment
variables or a `.env` file (see `.env.example`)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NETPULSE_")

    database_url: str = "sqlite:///./data/netpulse.db"

    # X-Forwarded-For is only trustworthy when something in front of
    # this process (a reverse proxy) actually sets it itself and
    # strips/overwrites whatever a client sent — otherwise it's just an
    # attacker-controlled header. Defaults to NOT trusting it (uses the
    # real TCP peer address instead, which can't be spoofed) because the
    # README documents running this with nothing in front at all
    # (`docker compose up` + open port 8000) as a normal option, not
    # just as a reverse-proxied deployment. Set
    # NETPULSE_TRUST_PROXY_HEADERS=true only when this really is behind
    # a reverse proxy (Caddy, nginx, Cloudflare Tunnel, etc.) that you
    # know overwrites client-supplied X-Forwarded-For — otherwise every
    # rate limit (@limiter.limit(...) below) becomes trivially
    # bypassable: an attacker who can set an arbitrary X-Forwarded-For
    # gets a fresh rate-limit bucket on every single request.
    trust_proxy_headers: bool = False

    # When false (the production default), disables the interactive
    # Swagger/ReDoc docs and the raw OpenAPI schema — no reason to
    # expose the full API surface publicly on a deployed instance.
    # Set NETPULSE_DEBUG=true locally if you want them back.
    debug: bool = False

    # Ping test: how many round trips to average for latency/jitter.
    ping_samples: int = 10

    # The download test is duration-based, not size-based (see
    # frontend/js/speedtest.js): the client opens several parallel
    # streams and aborts them once its test window elapses, so each
    # stream just needs to request "more than any realistic connection
    # could consume in the test window" — this cap exists only so a
    # client can't request literally unbounded bytes from the server.
    max_download_bytes: int = 500_000_000  # 500 MB per stream
    default_download_bytes: int = 300_000_000  # 300 MB per stream

    # The upload test loops POSTing this chunk size per connection until
    # its test window elapses (rather than one giant body) — keeps
    # browser memory bounded and gives reasonably fine-grained timing.
    upload_chunk_bytes: int = 4_000_000  # 4 MB

    # History retention: the history chart only ever reads "day" or
    # "week" ranges (see speedtest_history in api/routes.py), so nothing
    # past this window is ever shown — keeping it around forever would
    # just grow the database unboundedly with data nothing displays.
    # history_max_rows is a second, independent backstop (oldest rows
    # dropped once the table exceeds it) in case retention_days alone
    # isn't enough on a deployment getting hammered with traffic.
    history_retention_days: int = 7
    history_max_rows: int = 50_000


settings = Settings()
