from pathlib import Path
from functools import lru_cache
from typing import Literal, Annotated

from pydantic import Field, SecretStr, StringConstraints, model_validator, AliasChoices, AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict



PROJECT_ROOT = Path(__file__).resolve().parents[4]

NonEmptyString = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, 
        min_length=1,
    ),
]

ProviderName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=50,
        pattern=r"^[a-z][a-z0-9_-]*$",
    ),
]


class AISettings(BaseSettings):
    """Configuration for AI subsystem"""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="AI_",
        case_sensitive=False,
        extra="ignore",
        validate_default=True,
        frozen=True,
    )

    environment:Literal["development", "test", "production"] = "development"
     
    debug : bool = False

    redis_url: SecretStr | None = None

    default_provider : ProviderName = "openrouter"

    default_model : NonEmptyString 

    openrouter_api_key : SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "OPENROUTER_API_KEY",
            "AI_OPENROUTER_API_KEY",
            ),
    )

    tavily_api_key :SecretStr = Field(
        validation_alias=AliasChoices(
            "TAVILY_API_KEY",
            "_AI_TAVILY_API_KEY",
        ),
    )

    openrouter_base_url: AnyHttpUrl = (
        "https://openrouter.ai/api/v1"
    )

    request_timeout_seconds : Annotated[
        float,
        Field(gt=0, le=600),
    ] = 60.0

    max_retries : Annotated[
        int,
        Field(ge=0, le=10)
    ] = 2

    log_level : Literal[
        "DEBUG",
        "INFO",
        "WARNING",
        "ERROR",
        "CRITICAL",
    ] = "INFO"

    @model_validator(mode="after")
    def validate_environment(self) -> "AISettings":
        if self.environment == "production" and self.debug:
            raise ValueError(
                "Debug mode must be disabled in production"
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    

@lru_cache(maxsize=1)
def get_setting() -> AISettings:
    """return application's cache setting"""
    return AISettings()