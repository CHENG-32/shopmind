from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
STATIC_DIR = ROOT / "static"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    infinisynapse_api_key: str = ""
    infinisynapse_base_url: str = "https://app.infinisynapse.cn/api"
    host: str = "0.0.0.0"
    port: int = 8080
    analysis_timeout_sec: int = 180


def get_settings() -> Settings:
    # Allow plain env override without pydantic field alias friction
    s = Settings()
    if not s.infinisynapse_api_key:
        s.infinisynapse_api_key = os.getenv("INFINISYNAPSE_API_KEY", "")
    return s
