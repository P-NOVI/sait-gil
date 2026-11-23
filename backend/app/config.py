from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
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
    # 서울 실시간 인구데이터(citydata_ppltn, SEOUL_API_KEY). 한 번에 한 장소만 준다.
    # 이 주소도 HTTP 만 받고 키가 주소에 들어간다.
    citydata_base_url: str = "http://openapi.seoul.go.kr:8088"
    citydata_timeout_s: float = 10.0
    # 수집기가 동시에 보내는 요청 수
    citydata_concurrency: int = 5
    # 기상청 API허브 단기예보(날씨 수집). 키가 요청 주소의 쿼리에 들어가므로
    # 주소를 로그에 남기지 않는다.
    kma_api_key: str = ""
    kma_base_url: str = (
        "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0"
    )
    kma_timeout_s: float = 10.0
    # 한 번에 받는 행 수. 단기예보는 1,000건이 넘어서 쪽을 나눠 받는다.
    kma_page_size: int = 1000
    # 수집 한 번 안에서 같은 격자·기준 시각을 다시 부르지 않는 시간(초)
    kma_cache_ttl_s: float = 600.0

    database_url: str = ""
    # 수집 DB. 로컬은 Docker PostgreSQL, 배포는 Neon 이다. 주소에 비밀번호가 들어 있다.
    collector_database_url: SecretStr = SecretStr("")
    collector_connect_timeout_s: int = 10
    # 길찾기 중 수집 DB(예측·도시데이터)에 접속을 기다리는 시간(초).
    # 수집기보다 짧게 두어 DB 장애 때 길찾기가 오래 멈추지 않게 한다.
    route_db_connect_timeout_s: int = 3
    # S-DoT 이력은 DB의 최신 측정 시각에서 이만큼 앞까지 최신 쪽부터 거슬러 받는다.
    # 늦게 올라온 행도 받으려고 겹쳐 받는다(이미 있는 행은 건너뛴다).
    collector_sdot_overlap_minutes: int = 60
    # 한 번에 받는 최대 쪽 수. 1000행이 약 1.5시간치라 하루가 약 12쪽, 300쪽은 약 25일.
    # 여기에 걸리면 넣지 않고 실패로 끝나 다음 실행이 같은 지점부터 다시 받는다.
    collector_sdot_max_pages: int = 300
    # 수집 DB가 비었을 때만 받는 S-DoT 최신 행 수
    collector_sdot_rows: int = 2000
    # 날씨 실황은 지난 이 시간 안에서 DB에 없는 정시만 받는다.
    # 기상청은 24시간 안만 준다.
    collector_backfill_hours: int = 12
    # 하루치 단기예보는 이 시(時) 발표분을 발표 뒤 이 시간만큼 받는다.
    # 67시간은 05시 발표부터 모레 24시까지다.
    # 유동인구 예측이 오늘·내일·모레 날씨로 쓴다.
    collector_daily_issue_hour: int = 5
    collector_daily_hours: int = 67
    # 자치구 위치를 구할 때 쓰는 최근 S-DoT 수집 기간(일). 유동인구는 하루 한 번
    # 받으므로, 그 실행이 며칠 빠져도 날씨가 멈추지 않게 넉넉히 둔다.
    collector_district_days: int = 7

    frontend_url: str = "http://localhost:5173"
    # Android WebView 기본 Origin, iOS Capacitor Origin.
    # 웹은 개발(Vite 프록시)·배포(Render rewrite) 모두 /api 를
    # 같은 주소로 넘겨 받아 CORS 가 필요 없다.
    allowed_origins: list[str] = [
        "https://localhost",
        "capacitor://localhost",
    ]

    # 경로 점수(B안)에 쓰는 데이터. pipeline/ 이 만들고 커밋하지 않는다.
    dem_path: Path = PROCESSED_DIR / "seoul_dem_5m.tif"
    sensors_path: Path = PROCESSED_DIR / "sdot_sensors.json"
    citydata_areas_path: Path = PROCESSED_DIR / "citydata_areas.json"

    # 경로 점수 기준 (CLAUDE.md "경로 결정 방식"). 초안 값이다.
    # 경로 선 위에 점을 찍는 간격
    route_sample_interval_m: float = 10.0
    # 점 주변 S-DoT 센서를 찾는 반경, 혼잡도 1 로 보는 10분 유동인구 (배리어프리와 같다)
    congestion_radius_m: float = 50.0
    congestion_full_count: float = 300.0
    # 혼잡도가 이 값 이상으로 올라서는 곳을 혼잡 구간 시작으로 알린다
    crowded_level: float = 0.5
    # 도시데이터 혼잡 단계(여유, 보통, 약간 붐빔, 붐빔)를 바꾼 혼잡도.
    # 단계는 그 장소의 최근 28일 대비 값이라 S-DoT 혼잡도와 기준이 다르다.
    citydata_level_values: list[float] = [0.0, 0.25, 0.5, 1.0]
    # 가장 최근 수집분이 이보다 오래되면 도시데이터를 쓰지 않는다(시간).
    # 예측이 12시간치라 수집 간격(6시간)보다 넉넉히 둔다.
    citydata_max_age_h: float = 12.0
    # 지금 시각과 이만큼 안에 있는 값(현재값·시간별 예측)만 쓴다(분)
    citydata_match_window_minutes: float = 40.0
    # DB에서 읽은 구역 혼잡도를 다시 쓰는 시간(초)
    citydata_cache_ttl_s: float = 300.0
    # 시각장애인 걸음 속도(m/s). 경로의 걷는 시간(거리 ÷ 이 속도)과
    # 경로 위 점마다 도착 시각(출발 + 걸은 거리 ÷ 이 속도)의 혼잡도에 쓴다.
    # 일반인 평균 보행 속도(약 1.29m/s)의 70%로 잡았다.
    walking_speed_mps: float = 0.9
    # 예측 유동인구(명/시간)를 10분 유동인구로 바꿀 때 나누는 값(한 시간의 10분
    # 구간 수). 그래서 예측도 congestion_full_count 와 같은 기준으로 혼잡도가 된다.
    forecast_bins_per_hour: int = 6
    # 시간대별 예측 혼잡도를 다시 쓰는 시간(초). 예측은 하루 한 번 바뀐다.
    forecast_cache_ttl_s: float = 600.0
    # 1/50~1/12 구간, 1/12 초과 구간 길이에 곱하는 경사 점수 배율
    slope_moderate_weight: float = 0.5
    slope_hard_weight: float = 2.0
    # 후보가 추천 경로보다 점수로 이만큼 넘게 낫지 않으면 따로 띄우지 않는다
    route_congestion_margin_m: float = 10.0
    route_slope_margin_m: float = 10.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
