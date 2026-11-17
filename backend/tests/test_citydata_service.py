import json
import logging
from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.collector.citydata import store_population
from app.collector.models import CollectorBase
from app.config import Settings
from app.services.citydata_client import population_rows
from app.services.citydata_service import (
    AreaCache,
    areas_with_levels,
    current_areas,
    latest_levels,
    load_area_shapes,
)
from app.services.sdot_client import KST
from core.congestion import Area
from tests.citydata_samples import area_item, forecast

COLLECTED = datetime(2026, 11, 16, 11, 20, tzinfo=KST)
MAX_AGE = timedelta(hours=12)
WINDOW = timedelta(minutes=40)
RING = [[127.0, 37.5], [127.01, 37.5], [127.01, 37.51], [127.0, 37.51]]


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def write_areas(path: Path) -> Path:
    areas = [
        {"code": "POI009", "name": "광화문·덕수궁", "rings": [RING]},
        {"code": "POI010", "name": "명동", "rings": [RING]},
    ]
    path.write_text(json.dumps({"areas": areas}, ensure_ascii=False), "utf-8")
    return path


def store(session: Session, **item_fields: object) -> None:
    store_population(session, population_rows(area_item(**item_fields), COLLECTED))
    session.commit()


def test_load_area_shapes(tmp_path: Path) -> None:
    shapes = load_area_shapes(write_areas(tmp_path / "areas.json"))

    assert set(shapes) == {"POI009", "POI010"}
    assert shapes["POI009"].name == "광화문·덕수궁"
    assert shapes["POI009"].rings[0][0] == (127.0, 37.5)


@pytest.mark.parametrize(
    ("now", "level"),
    [
        # 현재값(11:10)과 가깝다
        (datetime(2026, 11, 16, 11, 20, tzinfo=KST), 2),
        # 12시 예측
        (datetime(2026, 11, 16, 12, 10, tzinfo=KST), 3),
        # 13시 예측
        (datetime(2026, 11, 16, 13, 25, tzinfo=KST), 4),
    ],
)
def test_latest_levels_picks_closest_time(
    session: Session, now: datetime, level: int
) -> None:
    store(session)

    assert latest_levels(session, now, MAX_AGE, WINDOW) == {"POI009": level}


def test_latest_levels_uses_newest_snapshot(session: Session) -> None:
    store(session, forecasts=[forecast("2026-11-16 17:00", "붐빔")])
    store(session, observed="2026-11-16 16:50", level="여유", forecasts=[])
    now = datetime(2026, 11, 16, 17, 0, tzinfo=KST)

    # 새 묶음의 현재값(16:50 여유)을 쓰고, 옛 묶음의 17시 예측은 보지 않는다.
    assert latest_levels(session, now, MAX_AGE, WINDOW) == {"POI009": 1}


def test_latest_levels_ignores_old_snapshot_and_far_times(session: Session) -> None:
    store(session)

    too_old = datetime(2026, 11, 17, 0, 0, tzinfo=KST)
    past_forecasts = datetime(2026, 11, 16, 14, 0, tzinfo=KST)
    assert latest_levels(session, too_old, MAX_AGE, WINDOW) == {}
    assert latest_levels(session, past_forecasts, MAX_AGE, WINDOW) == {}


def test_areas_with_levels_skips_unknown_codes(tmp_path: Path) -> None:
    shapes = load_area_shapes(write_areas(tmp_path / "areas.json"))

    areas = areas_with_levels(shapes, {"POI009": 4, "POI999": 4}, [0, 0.25, 0.5, 1])

    assert areas == [Area(shapes["POI009"].rings, 1)]


@pytest.mark.anyio
async def test_current_areas_reads_collector_db(tmp_path: Path) -> None:
    database = tmp_path / "collector.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as session:
        store(session)
    engine.dispose()
    settings = Settings(
        _env_file=None,
        collector_database_url=SecretStr(f"sqlite:///{database.as_posix()}"),
        citydata_areas_path=write_areas(tmp_path / "areas.json"),
    )

    areas = await current_areas(settings, now=COLLECTED)

    assert [area.level for area in areas] == [0.25]


@pytest.mark.parametrize(
    "fields",
    [
        {"collector_database_url": SecretStr("")},
        {"citydata_areas_path": Path("missing/areas.json")},
    ],
)
@pytest.mark.anyio
async def test_current_areas_without_db_or_file(
    tmp_path: Path, fields: dict, caplog: pytest.LogCaptureFixture
) -> None:
    base = {
        "_env_file": None,
        "collector_database_url": SecretStr("sqlite:///unused.db"),
        "citydata_areas_path": write_areas(tmp_path / "areas.json"),
    }

    with caplog.at_level(logging.WARNING):
        areas = await current_areas(Settings(**{**base, **fields}), now=COLLECTED)

    assert areas == []
    assert "도시데이터 없이" in caplog.text


@pytest.mark.anyio
async def test_current_areas_db_failure_hides_url(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    # 테이블이 없는 빈 DB라 조회가 실패한다.
    url = f"sqlite:///{(tmp_path / 'empty.db').as_posix()}"
    settings = Settings(
        _env_file=None,
        collector_database_url=SecretStr(url),
        citydata_areas_path=write_areas(tmp_path / "areas.json"),
    )

    with caplog.at_level(logging.WARNING):
        areas = await current_areas(settings, now=COLLECTED)

    assert areas == []
    assert "수집 DB 실패" in caplog.text
    assert url not in caplog.text


def test_area_cache_expires_after_ttl() -> None:
    clock = [0.0]
    cache = AreaCache(clock=lambda: clock[0])
    areas = [Area([[(127.0, 37.5)]], 0.5)]

    assert cache.get(300) is None
    cache.set(areas)
    clock[0] = 299.9
    assert cache.get(300) == areas
    clock[0] = 300.0
    assert cache.get(300) is None
