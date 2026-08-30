"""
Central configuration for NetPulse.

Everything a user might reasonably want to tune (poll intervals, alert
thresholds, reference hosts) lives here — never hardcoded inside the
collectors. Values can be overridden via environment variables or a
`.env` file (see `.env.example`).
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NETPULSE_")

    # --- Database -----------------------------------------------------
    database_url: str = "sqlite:///./data/netpulse.db"

    # --- Traffic collector ---------------------------------------------
    # How often (seconds) to sample per-process network connections.
    traffic_poll_interval_sec: float = 5.0

    # --- Connectivity collector -----------------------------------------
    # Reference hosts pinged on a fixed interval to judge connection
    # quality. Mix of a global anchor (Google DNS) and a local one so we
    # can tell "my ISP is down" apart from "the whole internet is down".
    connectivity_targets: list[str] = ["8.8.8.8", "1.1.1.1"]
    connectivity_poll_interval_sec: float = 10.0
    ping_timeout_sec: float = 1.5

    # --- Alert rules ------------------------------------------------------
    # 1) high_usage: a single process crossing this many MB within the
    #    time window below triggers an alert.
    high_usage_threshold_mb: float = 500.0
    high_usage_window_sec: float = 60.0

    # 2) connection_down: this many consecutive failed pings to a target
    #    triggers an alert.
    connection_down_consecutive_failures: int = 3

    # 3) high_latency: average latency (ms) over the recent window that
    #    triggers an alert.
    high_latency_threshold_ms: float = 300.0
    high_latency_window_samples: int = 5

    # --- Alerts / Telegram ------------------------------------------------
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    alerts_enabled: bool = False


settings = Settings()
