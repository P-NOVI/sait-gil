from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
PROCESSED_DIR = REPO_ROOT / "data" / "processed"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore"
    )

    tmap_app_key: str = ""
    tmap_base_url: str = "https://apis.openapi.sk.com/tmap"
    seoul_api_key: str = ""
    kma_api_key: str = ""

    database_url: str = ""
    collector_database_url: str = ""

    frontend_url: str = "http://localhost:5173"
    allowed_origins: list[str] = ["http://localhost:5173"]

    # 경로 점수(B안)에 쓰는 데이터. pipeline/ 이 만들고 커밋하지 않는다.
    dem_path: Path = PROCESSED_DIR / "seoul_dem_5m.tif"
    sensors_path: Path = PROCESSED_DIR / "sdot_sensors.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
