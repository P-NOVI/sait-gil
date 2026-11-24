from collections.abc import Iterator
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.cache import KeyedTtlCache
from app.collector.copy_tables import copy_table
from app.collector.kma import kma_http
from app.collector.models import CollectorBase, SdotReading, WeatherDaily, WeatherNow
from app.collector.sdot import (
    PageLimitError,
    collect_sdot,
    is_stale,
    sdot_sync_http,
    to_record,
)
from app.collector.weather import (
    collect_weather_daily,
    collect_weather_now,
    daily_issue,
    district_grids,
)
from app.config import Settings
from app.services.sdot_client import KST, SERVICE_NAME
from core.kma_grid import to_grid

NOW = datetime(2026, 11, 3, 20, 14, tzinfo=KST)
GRID = (60, 127)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://", poolclass=StaticPool)
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def sdot_row(serial: str, time: str, count: str = "10") -> dict[str, str]:
    return {
        "SERIAL": serial,
        "SENSING_TIME": time,
        "VISITOR_COUNT": count,
        "REGION": "traditional_markets",
        "AUTONOMOUS_DISTRICT": "Jung-gu",
        "ADMINISTRATIVE_DISTRICT": "Myeong-dong",
    }


def sdot_page(rows: list[dict[str, str]]) -> dict[str, Any]:
    return {
        SERVICE_NAME: {
            "list_total_count": len(rows),
            "RESULT": {"CODE": "INFO-000"},
            "row": rows,
        }
    }


def kma_page(items: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "response": {
            "header": {"resultCode": "00"},
            "body": {"items": {"item": items}, "totalCount": len(items)},
        }
    }


def reading(code: int, district: str, at: datetime = NOW) -> SdotReading:
    return SdotReading(
        sensor_code=code,
        measured_at=at,
        visitor_count=1,
        district=district,
        collected_at=at,
    )


# --- 유동인구 ---


def test_to_record_reads_history_columns() -> None:
    record = to_record(sdot_row("00000003009", "2026-11-03_20:10:00", "251"), NOW)

    assert record == {
        "sensor_code": 3009,
        "measured_at": datetime(2026, 11, 3, 20, 10, tzinfo=KST),
        "visitor_count": 251,
        "region": "traditional_markets",
        "district": "Jung-gu",
        "dong": "Myeong-dong",
        "collected_at": NOW,
    }


def test_to_record_skips_broken_row() -> None:
    assert to_record(sdot_row("x", "2026-11-03_20:10:00"), NOW) is None
    assert to_record({"SERIAL": "1"}, NOW) is None


def sdot_client(
    settings: Settings, pages: dict[str, list[dict[str, str]]], requested: list[str]
) -> httpx.Client:
    """쪽 주소(/시작/끝/)별로 정해 둔 행을 주는 S-DoT 클라이언트."""

    def handler(request: httpx.Request) -> httpx.Response:
        tail = request.url.path.split(SERVICE_NAME)[1]
        requested.append(tail)
        return httpx.Response(200, json=sdot_page(pages[tail]))

    return sdot_sync_http(settings, httpx.MockTransport(handler))


def test_collect_sdot_first_run_takes_latest_rows(session: Session) -> None:
    pages = {
        "/1/2/": [
            sdot_row("1", "2026-11-03_20:10:00"),
            sdot_row("2", "2026-11-03_20:10:00"),
        ],
        # 쪽 사이에 새 행이 붙어 앞 쪽의 행이 한 번 더 온다.
        "/3/3/": [sdot_row("2", "2026-11-03_20:10:00")],
    }
    requested: list[str] = []
    settings = Settings(
        _env_file=None, seoul_api_key="k", sdot_page_size=2, collector_sdot_rows=3
    )
    with sdot_client(settings, pages, requested) as client:
        assert collect_sdot(session, client, settings, NOW) == 2

    assert requested == ["/1/2/", "/3/3/"]
    assert session.scalars(select(SdotReading.sensor_code)).all() == [1, 2]


def test_collect_sdot_resumes_from_latest_stored(session: Session) -> None:
    session.add(reading(1, "Jung-gu", datetime(2026, 11, 3, 18, tzinfo=KST)))
    session.commit()
    # 이어 받을 지점은 18:00 - 60분 = 17:00. 그보다 이른 16:50 이 나오면 멈춘다.
    pages = {
        "/1/2/": [
            sdot_row("1", "2026-11-03_20:10:00"),
            sdot_row("1", "2026-11-03_19:00:00"),
        ],
        "/3/4/": [
            sdot_row("1", "2026-11-03_18:00:00"),
            sdot_row("1", "2026-11-03_16:50:00"),
        ],
    }
    requested: list[str] = []
    settings = Settings(
        _env_file=None,
        seoul_api_key="k",
        sdot_page_size=2,
        collector_sdot_overlap_minutes=60,
    )
    with sdot_client(settings, pages, requested) as client:
        assert collect_sdot(session, client, settings, NOW) == 3

    assert requested == ["/1/2/", "/3/4/"]


def test_collect_sdot_page_limit_inserts_nothing(session: Session) -> None:
    session.add(reading(1, "Jung-gu", datetime(2026, 11, 3, 10, tzinfo=KST)))
    session.commit()
    pages = {
        "/1/2/": [
            sdot_row("1", "2026-11-03_20:10:00"),
            sdot_row("1", "2026-11-03_20:00:00"),
        ]
    }
    settings = Settings(
        _env_file=None, seoul_api_key="k", sdot_page_size=2, collector_sdot_max_pages=1
    )
    with sdot_client(settings, pages, []) as client:
        with pytest.raises(PageLimitError):
            collect_sdot(session, client, settings, NOW)

    assert len(session.scalars(select(SdotReading)).all()) == 1


def test_collect_sdot_warns_when_api_ends_early(
    session: Session, capsys: pytest.CaptureFixture[str]
) -> None:
    session.add(reading(1, "Jung-gu", datetime(2026, 11, 3, 10, tzinfo=KST)))
    session.commit()
    # 쪽이 덜 찼는데 이어 받을 지점(09:00)에 닿지 못했다. 받은 만큼은 넣는다.
    pages = {"/1/2/": [sdot_row("1", "2026-11-03_20:10:00")]}
    settings = Settings(_env_file=None, seoul_api_key="k", sdot_page_size=2)
    with sdot_client(settings, pages, []) as client:
        assert collect_sdot(session, client, settings, NOW) == 1

    assert "빈 구간" in capsys.readouterr().out


def test_is_stale_compares_latest_reading_with_max_age(session: Session) -> None:
    max_age = timedelta(hours=48)
    assert is_stale(session, NOW, max_age)  # 비어 있으면 낡은 것으로 본다

    session.add(reading(1, "Jung-gu", NOW - timedelta(hours=47)))
    session.commit()
    assert not is_stale(session, NOW, max_age)

    session.add(reading(2, "Jung-gu", NOW - timedelta(hours=49)))
    session.commit()
    assert not is_stale(session, NOW, max_age)  # 센서 하나라도 최근이면 낡지 않다
    assert is_stale(session, NOW + timedelta(hours=2), max_age)


# --- 자치구 위치 ---


def test_district_grids_average_known_sensor_positions(session: Session) -> None:
    session.add_all(
        [
            reading(1, "Jung-gu"),
            reading(2, "Jung-gu"),
            # 위치 파일에 없는 센서는 뺀다.
            reading(3, "Mapo-gu"),
            # 기간보다 오래된 짝은 쓰지 않는다.
            reading(4, "Guro-gu", NOW - timedelta(days=5)),
        ]
    )
    session.commit()
    sensors = {
        1: (126.97, 37.56),
        2: (126.99, 37.58),
        4: (126.88, 37.49),
    }

    grids = district_grids(session, sensors, NOW - timedelta(days=2))

    assert grids == {"Jung-gu": to_grid(37.57, 126.98)}


# --- 실시간 날씨 ---


def observation(base_time: str) -> list[dict[str, str]]:
    values = {"T1H": "13.5", "RN1": "1.5", "PTY": "1", "REH": "66", "WSD": "2.1"}
    return [
        {"baseTime": base_time, "category": key, "obsrValue": value}
        for key, value in values.items()
    ]


def test_collect_weather_now_fills_only_missing_hours(session: Session) -> None:
    session.add(
        WeatherNow(
            district="Jung-gu",
            observed_at=datetime(2026, 11, 3, 19, tzinfo=KST),
            nx=GRID[0],
            ny=GRID[1],
            collected_at=NOW,
        )
    )
    session.commit()
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        base_time = request.url.params["base_time"]
        requested.append(base_time)
        return httpx.Response(200, json=kma_page(observation(base_time)))

    settings = Settings(_env_file=None, kma_api_key="k", collector_backfill_hours=3)
    with kma_http(settings, httpx.MockTransport(handler)) as client:
        added = collect_weather_now(
            session, client, {"Jung-gu": GRID}, settings, NOW, KeyedTtlCache(60)
        )

    assert added == 2
    assert requested == ["2000", "1800"]
    row = session.scalars(
        select(WeatherNow).where(WeatherNow.temp_c.is_not(None)).limit(1)
    ).one()
    assert (row.temp_c, row.rain_mm, row.precipitation, row.humidity, row.wind_ms) == (
        13.5,
        1.5,
        "rain",
        66.0,
        2.1,
    )


# --- 하루치 날씨 ---


def test_daily_issue_waits_for_publication() -> None:
    assert daily_issue(datetime(2026, 11, 3, 5, 5, tzinfo=KST), 5) == datetime(
        2026, 11, 2, 5, tzinfo=KST
    )
    assert daily_issue(datetime(2026, 11, 3, 5, 20, tzinfo=KST), 5) == datetime(
        2026, 11, 3, 5, tzinfo=KST
    )


def forecast(date: str, time: str) -> list[dict[str, str]]:
    values = {"TMP": "9", "PCP": "강수없음", "POP": "20", "PTY": "0", "SKY": "3"}
    return [
        {"fcstDate": date, "fcstTime": time, "category": key, "fcstValue": value}
        for key, value in values.items()
    ]


def test_collect_weather_daily_keeps_24_hours_after_issue(session: Session) -> None:
    items = (
        forecast("20261103", "0500")
        + forecast("20261103", "0600")
        + forecast("20261104", "0500")
        + forecast("20261104", "0600")
    )
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        assert request.url.params["base_time"] == "0500"
        return httpx.Response(200, json=kma_page(items))

    # 발표 뒤 collector_daily_hours 만 남기는 규칙을 본다(기본값은 67시간).
    settings = Settings(_env_file=None, kma_api_key="k", collector_daily_hours=24)
    with kma_http(settings, httpx.MockTransport(handler)) as client:
        first = collect_weather_daily(
            session, client, {"Jung-gu": GRID}, settings, NOW, KeyedTtlCache(60)
        )
        again = collect_weather_daily(
            session, client, {"Jung-gu": GRID}, settings, NOW, KeyedTtlCache(60)
        )

    assert (first, again, calls) == (2, 0, 1)
    rows = session.scalars(
        select(WeatherDaily).order_by(WeatherDaily.forecast_at)
    ).all()
    assert [row.forecast_at.hour for row in rows] == [6, 5]
    assert (rows[0].temp_c, rows[0].rain_mm, rows[0].rain_prob, rows[0].sky) == (
        9.0,
        0.0,
        20,
        3,
    )


# --- 다른 수집 DB에서 옮기기 ---


def test_copy_table_moves_rows_once(session: Session) -> None:
    engine = create_engine("sqlite://", poolclass=StaticPool)
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as source:
        source.add_all([reading(code, "Jung-gu") for code in (1, 2, 3)])
        source.commit()

        assert copy_table(source, session, SdotReading, size=2) == 3
        assert copy_table(source, session, SdotReading) == 0

    rows = session.scalars(select(SdotReading)).all()
    assert [(row.sensor_code, row.district) for row in rows] == [
        (1, "Jung-gu"),
        (2, "Jung-gu"),
        (3, "Jung-gu"),
    ]
