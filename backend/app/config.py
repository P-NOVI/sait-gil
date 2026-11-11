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
    tmap_timeout_s: float = 10.0
    # 경로 후보를 받을 보행자 경로 검색 옵션. 첫 번째로 받은 경로가 추천 경로다.
    # 0 추천, 4 추천+대로우선, 10 최단, 30 최단거리+계단제외.
    # 길찾기 한 번에 이 개수만큼 경로 호출(Free 하루 1,000건)을 쓴다.
    tmap_search_options: list[int] = [0, 4, 10, 30]
    # 장소 검색 결과 수
    place_search_count: int = 10
    seoul_api_key: str = ""
    # S-DoT 실시간 유동인구(서울 열린데이터광장 sDoTPeople, SEOUL_API_KEY).
    # 이 주소는 HTTP 만 받는다. 키가 주소에 들어가므로 주소를 로그에 남기지 않는다.
    sdot_base_url: str = "http://openapi.seoul.go.kr:8088"
    sdot_timeout_s: float = 5.0
    # 최신순으로 받을 행 수. 센서 백여 개가 10분마다 보내서 1,000행이 약 90분치다.
    sdot_page_size: int = 1000
    # 받은 센서 혼잡도를 다시 쓰는 시간(초). 실패한 빈 결과도 이 동안 쓴다.
    sdot_cache_ttl_s: float = 60.0
    # 이보다 오래전에 잰 값은 쓰지 않는다(분)
    sdot_max_age_minutes: float = 60.0
    kma_api_key: str = ""

    database_url: str = ""
    collector_database_url: str = ""

    frontend_url: str = "http://localhost:5173"
    allowed_origins: list[str] = ["http://localhost:5173"]

    # 경로 점수(B안)에 쓰는 데이터. pipeline/ 이 만들고 커밋하지 않는다.
    dem_path: Path = PROCESSED_DIR / "seoul_dem_5m.tif"
    sensors_path: Path = PROCESSED_DIR / "sdot_sensors.json"

    # 경로 점수 기준 (CLAUDE.md "경로 결정 방식"). 초안 값이다.
    # 경로 선 위에 점을 찍는 간격
    route_sample_interval_m: float = 10.0
    # 점 주변 S-DoT 센서를 찾는 반경, 혼잡도 1 로 보는 10분 유동인구 (배리어프리와 같다)
    congestion_radius_m: float = 50.0
    congestion_full_count: float = 300.0
    # 혼잡도가 이 값 이상으로 올라서는 곳을 혼잡 구간 시작으로 알린다
    crowded_level: float = 0.5
    # 1/50~1/12 구간, 1/12 초과 구간 길이에 곱하는 경사 점수 배율
    slope_moderate_weight: float = 0.5
    slope_hard_weight: float = 2.0
    # 후보가 추천 경로보다 점수로 이만큼 넘게 낫지 않으면 따로 띄우지 않는다
    route_congestion_margin_m: float = 10.0
    route_slope_margin_m: float = 10.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
