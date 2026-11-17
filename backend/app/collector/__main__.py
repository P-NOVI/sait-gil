"""도시데이터·유동인구·날씨 중 하나를 한 번 받아 수집 DB에 넣고 끝난다.

실행: backend/ 에서 uv run python -m app.collector [citydata|sdot|weather]
- citydata: 도시데이터 주요 장소 현재값·시간별 예측. 몇 시간마다(collect-citydata.yml).
  장소 목록은 영역 파일(CITYDATA_AREAS_PATH)의 장소 코드다.
- sdot: S-DoT 유동인구 이력. 하루 한 번(collect-sdot.yml).
- weather: 자치구별 기상청 실황·하루치 예보. 1시간마다(collect-weather.yml).
  자치구 위치에 센서 위치 파일(SENSORS_PATH)과 sdot_readings 를 쓴다.
필요한 환경변수: COLLECTOR_DATABASE_URL,
  SEOUL_API_KEY(citydata·sdot), KMA_API_KEY(weather)
받지 못한 것이 있으면 받은 것은 넣고 종료 코드 1로 끝난다.
"""

import argparse
import asyncio
import sys
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.cache import KeyedTtlCache
from app.collector.citydata import fetch_population_rows, store_population
from app.collector.kma import ItemCache, WeatherError, kma_http
from app.collector.sdot import collect_sdot, sdot_sync_http
from app.collector.store import STALE_SCHEMA, collector_engine
from app.collector.weather import (
    collect_weather_daily,
    collect_weather_now,
    district_grids,
)
from app.config import Settings, get_settings
from app.migrate import COLLECTOR_DB, is_up_to_date
from app.services.citydata_service import load_area_shapes
from app.services.sdot_client import KST, SdotError
from app.services.sensor_service import load_sensor_positions

JOBS = ("citydata", "sdot", "weather")
FAILURES = (SdotError, WeatherError, SQLAlchemyError)


def run(name: str, session: Session, job: Callable[[], int]) -> bool:
    """작업 하나를 하고 커밋한다. 실패하면 되돌리고 False."""
    try:
        count = job()
        session.commit()
    except FAILURES as error:
        session.rollback()
        # 예외 문구에 접속 주소·키가 섞일 수 있어 종류만 남긴다.
        print(f"{name}: 실패 ({type(error).__name__})")
        return False
    print(f"{name}: {count}행 추가")
    return True


def collect_citydata(engine: Engine, settings: Settings, now: datetime) -> bool:
    if not settings.citydata_areas_path.exists():
        print(f"영역 파일이 없습니다: {settings.citydata_areas_path}")
        return False
    area_codes = sorted(load_area_shapes(settings.citydata_areas_path))
    rows, failed = asyncio.run(fetch_population_rows(settings, area_codes, now))
    with Session(engine) as session:
        if not run("도시데이터", session, lambda: store_population(session, rows)):
            return False
    print(f"도시데이터: {len(area_codes) - len(failed)}/{len(area_codes)}곳 받음")
    if failed:
        print(f"받지 못한 장소: {', '.join(failed)}")
        return False
    return True


def collect_sdot_history(engine: Engine, settings: Settings, now: datetime) -> bool:
    with Session(engine) as session, sdot_sync_http(settings) as client:
        return run(
            "유동인구", session, lambda: collect_sdot(session, client, settings, now)
        )


def collect_weather(engine: Engine, settings: Settings, now: datetime) -> bool:
    if not settings.sensors_path.exists():
        print(f"센서 위치 파일이 없습니다: {settings.sensors_path}")
        return False
    with Session(engine) as session, kma_http(settings) as client:
        grids = district_grids(
            session,
            load_sensor_positions(settings.sensors_path),
            now - timedelta(days=settings.collector_district_days),
        )
        if not grids:
            print("최근 유동인구 수집분이 없어 자치구 위치를 모릅니다.")
            return False
        cache: ItemCache = KeyedTtlCache(settings.kma_cache_ttl_s)
        ok = run(
            "실시간 날씨",
            session,
            lambda: collect_weather_now(session, client, grids, settings, now, cache),
        )
        ok &= run(
            "하루치 날씨",
            session,
            lambda: collect_weather_daily(session, client, grids, settings, now, cache),
        )
    return ok


COLLECTORS: dict[str, Callable[[Engine, Settings, datetime], bool]] = {
    "citydata": collect_citydata,
    "sdot": collect_sdot_history,
    "weather": collect_weather,
}
KEYS = {"citydata": "seoul_api_key", "sdot": "seoul_api_key", "weather": "kma_api_key"}


def main() -> int:
    parser = argparse.ArgumentParser(description="수집 DB에 쌓는다.")
    parser.add_argument("job", choices=JOBS)
    job = parser.parse_args().job
    settings = get_settings()
    database_url = settings.collector_database_url.get_secret_value()
    if not database_url:
        print("COLLECTOR_DATABASE_URL 이 비어 있습니다.")
        return 1
    key = KEYS[job]
    if not getattr(settings, key):
        print(f"{key.upper()} 가 비어 있습니다.")
        return 1
    try:
        engine = collector_engine(database_url, settings.collector_connect_timeout_s)
        up_to_date = is_up_to_date(engine, COLLECTOR_DB)
    except SQLAlchemyError as error:
        print(f"수집 DB 연결 실패 ({type(error).__name__})")
        return 1
    if not up_to_date:
        print(STALE_SCHEMA)
        return 1
    try:
        ok = COLLECTORS[job](engine, settings, datetime.now(KST))
    except SQLAlchemyError as error:
        print(f"수집 DB 오류 ({type(error).__name__})")
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
