"""Central configuration. Values can be overridden via environment
variables or a `.env` file (see `.env.example`)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NETPULSE_")

    database_url: str = "sqlite:///./data/netpulse.db"

    # Ping test: how many round trips to average for latency/jitter.
    ping_samples: int = 10

    # Download/upload test payload size. Big enough to saturate a
    # decent connection past TCP slow-start, small enough not to be
    # painful on a slow one. The client can override per-request via
    # ?bytes= on /api/speedtest/download, capped at this value.
    max_test_bytes: int = 50_000_000  # 50 MB
    default_download_bytes: int = 25_000_000  # 25 MB
    default_upload_bytes: int = 15_000_000  # 15 MB


settings = Settings()
