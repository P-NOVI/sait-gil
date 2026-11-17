"""도시데이터 주요 장소의 현재값·시간별 예측을 한 번 받아 수집 DB에 넣고 끝난다.

실행: backend/ 에서 uv run python -m app.collector citydata
- GitHub Actions 가 몇 시간마다 부른다(collect-citydata.yml).
- 장소 목록은 영역 파일(CITYDATA_AREAS_PATH)의 장소 코드다.
필요한 환경변수: COLLECTOR_DATABASE_URL, SEOUL_API_KEY
일부 장소가 실패해도 받은 곳은 넣고, 실패가 있으면 종료 코드 1로 끝난다.
"""

import argparse
import asyncio
import sys
from datetime import datetime

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.collector.citydata import fetch_population_rows, store_population
from app.collector.store import STALE_SCHEMA, collector_engine
from app.config import get_settings
from app.migrate import COLLECTOR_DB, is_up_to_date
from app.services.citydata_service import load_area_shapes
from app.services.sdot_client import KST

JOBS = ("citydata",)


def main() -> int:
    parser = argparse.ArgumentParser(description="도시데이터를 수집 DB에 쌓는다.")
    parser.add_argument("job", choices=JOBS)
    parser.parse_args()
    settings = get_settings()
    database_url = settings.collector_database_url.get_secret_value()
    if not database_url:
        print("COLLECTOR_DATABASE_URL 이 비어 있습니다.")
        return 1
    if not settings.seoul_api_key:
        print("SEOUL_API_KEY 가 비어 있습니다.")
        return 1
    if not settings.citydata_areas_path.exists():
        print(f"영역 파일이 없습니다: {settings.citydata_areas_path}")
        return 1
    area_codes = sorted(load_area_shapes(settings.citydata_areas_path))
    try:
        engine = collector_engine(database_url, settings.collector_connect_timeout_s)
        up_to_date = is_up_to_date(engine, COLLECTOR_DB)
    except SQLAlchemyError as error:
        print(f"수집 DB 연결 실패 ({type(error).__name__})")
        return 1
    if not up_to_date:
        print(STALE_SCHEMA)
        return 1

    rows, failed = asyncio.run(
        fetch_population_rows(settings, area_codes, datetime.now(KST))
    )
    try:
        with Session(engine) as session:
            count = store_population(session, rows)
            session.commit()
    except SQLAlchemyError as error:
        # 예외 문구에 접속 주소가 섞일 수 있어 종류만 남긴다.
        print(f"도시데이터 저장 실패 ({type(error).__name__})")
        return 1
    received = len(area_codes) - len(failed)
    print(f"도시데이터: {received}/{len(area_codes)}곳, {count}행 추가")
    if failed:
        print(f"받지 못한 장소: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
