from collections.abc import Iterator
from datetime import datetime

import httpx
import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app.collector.citydata import fetch_population_rows, store_population
from app.collector.models import CitydataPopulation, CollectorBase
from app.config import Settings
from app.migrate import COLLECTOR_DB, alembic_config, is_up_to_date
from app.services.citydata_client import population_rows
from app.services.sdot_client import KST
from tests.citydata_samples import area_item, ok_body

COLLECTED = datetime(2026, 11, 16, 11, 20, tzinfo=KST)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def settings() -> Settings:
    return Settings(
        _env_file=None,
        seoul_api_key="test-key",
        citydata_base_url="http://citydata.test",
        citydata_concurrency=2,
    )


@pytest.mark.anyio
async def test_fetch_population_rows_keeps_going_after_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        code = request.url.path.rsplit("/", 1)[-1]
        if code == "POI002":
            return httpx.Response(503)
        return httpx.Response(200, json=ok_body(area_item(code=code)))

    rows, failed = await fetch_population_rows(
        settings(),
        ["POI001", "POI002", "POI003"],
        COLLECTED,
        httpx.MockTransport(handler),
    )

    assert failed == {"POI002": "도시데이터 응답 실패: HTTP 503"}
    assert {row["area_code"] for row in rows} == {"POI001", "POI003"}
    assert len(rows) == 6


@pytest.mark.anyio
async def test_fetch_population_rows_retries_transient_failure() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        code = request.url.path.rsplit("/", 1)[-1]
        calls.append(code)
        if calls.count(code) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json=ok_body(area_item(code=code)))

    rows, failed = await fetch_population_rows(
        settings(), ["POI001"], COLLECTED, httpx.MockTransport(handler)
    )

    assert failed == {}
    assert len(rows) == 3


@pytest.mark.anyio
async def test_fetch_population_rows_gives_up_after_retries() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(503)

    rows, failed = await fetch_population_rows(
        settings(), ["POI001"], COLLECTED, httpx.MockTransport(handler)
    )

    assert rows == []
    assert list(failed) == ["POI001"]
    assert len(calls) == settings().citydata_retries + 1


@pytest.mark.anyio
async def test_fetch_population_rows_does_not_retry_client_error() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(401)

    _, failed = await fetch_population_rows(
        settings(), ["POI001"], COLLECTED, httpx.MockTransport(handler)
    )

    assert failed == {"POI001": "도시데이터 응답 실패: HTTP 401"}
    assert len(calls) == 1


def test_store_population_skips_same_snapshot(session: Session) -> None:
    rows = population_rows(area_item(), COLLECTED)

    assert store_population(session, rows) == 3
    assert store_population(session, rows) == 0
    newer = population_rows(area_item(observed="2026-11-16 17:10"), COLLECTED)
    assert store_population(session, newer) == 3
    session.commit()

    assert len(session.scalars(select(CitydataPopulation)).all()) == 6


def test_migration_creates_table_matching_model() -> None:
    engine = create_engine("sqlite://")
    config = alembic_config(COLLECTOR_DB)
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")

    assert is_up_to_date(engine, COLLECTOR_DB)
    columns = {c["name"] for c in inspect(engine).get_columns("citydata_population")}
    assert columns == set(CitydataPopulation.__table__.columns.keys())
