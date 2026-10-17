from pathlib import Path
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict



project_root = Path(__file__).resolve().parents[5]


class Setting(BaseSettings):
    """Configuration for Yoku's AI subsystem"""

    model_config = SettingsConfigDict(
        env_file=project_root / ".env",
        env_file_encoding="utf-8",
        env_prefix="YOKU_",
        case_sensitive=False,
        extra="ignore",
    )

    app_env:Literal["development", "test", "production"] = "development"

    default_model : str = (
        "openrouter:nvidia/nemotron-3.5-lightning:free"
    )

    openrouter_api_key:SecretStr | None = Field(
        default=None,
        validation_alias="OPENROUTER_API_KEY"
    )

@lru_cache(maxsize=1)
def get_setting() -> Setting:
    """return application's cache setting"""
    return Setting()