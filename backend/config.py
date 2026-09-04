"""Central configuration. Values can be overridden via environment
variables or a `.env` file (see `.env.example`)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NETPULSE_")

    database_url: str = "sqlite:///./data/netpulse.db"

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


settings = Settings()
