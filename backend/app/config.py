from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore"
    )

    tmap_app_key: str = ""
    seoul_api_key: str = ""
    kma_api_key: str = ""

    database_url: str = ""
    collector_database_url: str = ""

    frontend_url: str = "http://localhost:5173"
    allowed_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
