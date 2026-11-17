"""다른 수집 DB(배리어프리)의 유동인구·날씨 이력을 이 수집 DB로 옮긴다(일회용).

실행: backend/ 에서 uv run python -m app.collector.copy_tables
- 원본 주소는 환경변수 SOURCE_COLLECTOR_DATABASE_URL, 대상은
  COLLECTOR_DATABASE_URL 이다. 두 주소 모두 출력하지 않는다.
- 유동인구 예측은 센서마다 최근 8주 수준을 피처로 쓰는데, S-DoT API 는 11일 전까지만
  준다. 그래서 처음 한 번 원본에 쌓인 이력을 옮겨 둔다.
- 표 구조는 배리어프리 수집 DB와 같다. 이미 있는 키는 건너뛰므로 여러 번 실행해도 된다.
"""

import os
import sys
from collections.abc import Iterator
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.collector.models import CollectorBase, SdotReading, WeatherDaily, WeatherNow
from app.collector.store import STALE_SCHEMA, collector_engine, insert_new
from app.config import get_settings
from app.migrate import COLLECTOR_DB, is_up_to_date

SOURCE_ENV = "SOURCE_COLLECTOR_DATABASE_URL"
TABLES: tuple[type[CollectorBase], ...] = (SdotReading, WeatherNow, WeatherDaily)
# 한 번에 읽어 넣고 커밋하는 행 수
BATCH_ROWS = 10_000


def read_batches(
    source: Session, model: type[CollectorBase], size: int
) -> Iterator[list[dict[str, Any]]]:
    """원본 표의 모든 행을 size 개씩 열 이름 → 값으로 준다."""
    columns = list(model.__table__.columns)
    result = source.execute(
        select(*columns).execution_options(yield_per=size)
    ).mappings()
    for chunk in result.partitions(size):
        yield [dict(row) for row in chunk]


def copy_table(
    source: Session, target: Session, model: type[CollectorBase], size: int = BATCH_ROWS
) -> int:
    """새로 넣은 행 수. 묶음마다 커밋한다."""
    inserted = 0
    for rows in read_batches(source, model, size):
        inserted += insert_new(target, model, rows)
        target.commit()
    return inserted


def connect(database_url: str, timeout_s: int) -> Engine:
    engine = collector_engine(database_url, timeout_s)
    if not is_up_to_date(engine, COLLECTOR_DB):
        raise SystemExit(STALE_SCHEMA)
    return engine


def main() -> int:
    settings = get_settings()
    target_url = settings.collector_database_url.get_secret_value()
    source_url = os.environ.get(SOURCE_ENV, "").strip()
    if not target_url or not source_url:
        print(f"COLLECTOR_DATABASE_URL 과 {SOURCE_ENV} 를 모두 넣어 주세요.")
        return 1
    timeout_s = settings.collector_connect_timeout_s
    try:
        source_engine = collector_engine(source_url, timeout_s)
        target_engine = connect(target_url, timeout_s)
        with Session(source_engine) as source, Session(target_engine) as target:
            for model in TABLES:
                count = copy_table(source, target, model)
                print(f"{model.__tablename__}: {count}행 옮김", flush=True)
    except SQLAlchemyError as error:
        # 예외 문구에 접속 주소가 섞일 수 있어 종류만 남긴다.
        print(f"옮기기 실패 ({type(error).__name__})")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
