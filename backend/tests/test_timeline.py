from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.collector.models import CollectorBase, FootTrafficForecast
from app.config import Settings
from app.services import citydata_service, forecast_service, timeline_service
from app.services.citydata_service import current_areas
from app.services.forecast_service import forecast_sensors, latest_forecasts
from app.services.sdot_client import KST
from app.services.timeline_service import (
    TimelineCaches,
    build_timeline,
    merge_sensors,
)
from core.congestion import Area, Layer, Sensor

NOW = datetime(2026, 11, 17, 9, 40, tzinfo=KST)
NINE = datetime(2026, 11, 17, 9, tzinfo=KST)
TEN = datetime(2026, 11, 17, 10, tzinfo=KST)
A, B = (127.0, 37.5), (127.01, 37.51)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    CollectorBase.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def forecast_row(code: int, issued_on: date, value: float) -> FootTrafficForecast:
    return FootTrafficForecast(
        sensor_code=code,
        issued_on=issued_on,
        slot_start=TEN,
        foot_traffic=value,
        model_trained_until=NINE,
        created_at=NINE,
    )


def test_latest_forecasts_takes_newest_issue_until_today(session: Session) -> None:
    today = date(2026, 11, 17)
    session.add_all(
        [
            forecast_row(1, today - timedelta(days=2), 100.0),
            forecast_row(1, today - timedelta(days=1), 120.0),
            # 오늘 뒤에 낸 예측은 쓰지 않는다.
            forecast_row(1, today + timedelta(days=1), 999.0),
            forecast_row(2, today - timedelta(days=2), 60.0),
        ]
    )
    session.commit()

    assert latest_forecasts(session, TEN, today) == {1: 120.0, 2: 60.0}


def test_merge_sensors_prefers_realtime() -> None:
    realtime = [Sensor(A, 0.1)]
    forecast = [Sensor(A, 0.9), Sensor(B, 0.5)]

    assert merge_sensors(realtime, forecast) == [Sensor(A, 0.1), Sensor(B, 0.5)]


@pytest.mark.anyio
async def test_build_timeline_uses_forecast_after_current_hour(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    forecasts = {NINE: [Sensor(A, 0.9), Sensor(B, 0.5)], TEN: [Sensor(A, 0.7)]}
    area_moments: list[datetime] = []

    async def fake_forecast(settings: Settings, slot: datetime) -> list[Sensor]:
        return forecasts[slot]

    async def fake_areas(settings: Settings, moment: datetime) -> list[Area]:
        area_moments.append(moment)
        return []

    monkeypatch.setattr(timeline_service, "forecast_sensors", fake_forecast)
    monkeypatch.setattr(timeline_service, "current_areas", fake_areas)
    settings = Settings(_env_file=None)

    timeline = await build_timeline(
        settings,
        NOW,
        NOW + timedelta(minutes=30),
        [Sensor(A, 0.1)],
        TimelineCaches.from_settings(settings),
    )

    # 지금 시간대는 실시간 값에 실시간이 없는 센서만 예측으로 채운다.
    assert timeline.layers[NINE] == Layer([Sensor(A, 0.1), Sensor(B, 0.5)], [])
    assert timeline.layers[TEN] == Layer([Sensor(A, 0.7)], [])
    # 구역은 지금 시각과 다음 시간대의 가운데 시각 값을 쓴다.
    assert sorted(area_moments) == [NOW, TEN + timedelta(minutes=30)]


@pytest.mark.anyio
async def test_build_timeline_without_forecast_keeps_realtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_forecast(settings: Settings, slot: datetime) -> list[Sensor]:
        return []

    async def no_areas(settings: Settings, moment: datetime) -> list[Area]:
        return []

    monkeypatch.setattr(timeline_service, "forecast_sensors", no_forecast)
    monkeypatch.setattr(timeline_service, "current_areas", no_areas)
    settings = Settings(_env_file=None)
    realtime = [Sensor(A, 0.1)]

    timeline = await build_timeline(
        settings,
        NOW,
        NOW + timedelta(minutes=30),
        realtime,
        TimelineCaches.from_settings(settings),
    )

    assert [layer.sensors for layer in timeline.layers.values()] == [
        realtime,
        realtime,
    ]


@pytest.mark.anyio
async def test_build_timeline_fills_missing_forecast_with_realtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def partial_forecast(settings: Settings, slot: datetime) -> list[Sensor]:
        return [Sensor(A, 0.7)] if slot == TEN else []

    async def no_areas(settings: Settings, moment: datetime) -> list[Area]:
        return []

    monkeypatch.setattr(timeline_service, "forecast_sensors", partial_forecast)
    monkeypatch.setattr(timeline_service, "current_areas", no_areas)
    settings = Settings(_env_file=None)

    timeline = await build_timeline(
        settings,
        NOW,
        NOW + timedelta(minutes=30),
        [Sensor(A, 0.1), Sensor(B, 0.2)],
        TimelineCaches.from_settings(settings),
    )

    # 뒤 시간대는 예측을 먼저 쓰고, 예측이 없는 센서만 실시간 값으로 채운다.
    assert timeline.layers[TEN].sensors == [Sensor(A, 0.7), Sensor(B, 0.2)]


@pytest.mark.anyio
async def test_build_timeline_rereads_areas_when_slot_becomes_current(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    area_moments: list[datetime] = []

    async def no_forecast(settings: Settings, slot: datetime) -> list[Sensor]:
        return []

    async def fake_areas(settings: Settings, moment: datetime) -> list[Area]:
        area_moments.append(moment)
        return []

    monkeypatch.setattr(timeline_service, "forecast_sensors", no_forecast)
    monkeypatch.setattr(timeline_service, "current_areas", fake_areas)
    settings = Settings(_env_file=None)
    caches = TimelineCaches.from_settings(settings)
    earlier = NOW - timedelta(hours=1)

    await build_timeline(settings, earlier, earlier + timedelta(minutes=30), [], caches)
    await build_timeline(settings, NOW, NOW + timedelta(minutes=10), [], caches)

    # 9시 대는 뒤 시간대일 때 9시 30분 값을 캐시했지만, 지금이 되면 다시 읽는다.
    assert area_moments[-1] == NOW


@pytest.mark.anyio
async def test_route_reads_use_short_db_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    timeouts: list[int] = []

    def failing_engine(database_url: str, connect_timeout_s: int) -> None:
        timeouts.append(connect_timeout_s)
        raise SQLAlchemyError("접속 실패")

    monkeypatch.setattr(forecast_service, "collector_engine", failing_engine)
    monkeypatch.setattr(citydata_service, "collector_engine", failing_engine)
    sensors_path = tmp_path / "sensors.json"
    sensors_path.write_text("{}", encoding="utf-8")
    areas_path = tmp_path / "areas.json"
    areas_path.write_text('{"areas": []}', encoding="utf-8")
    settings = Settings(
        _env_file=None,
        collector_database_url="postgresql://u:p@h/db",
        collector_connect_timeout_s=10,
        route_db_connect_timeout_s=3,
        sensors_path=sensors_path,
        citydata_areas_path=areas_path,
    )

    assert await forecast_sensors(settings, TEN) == []
    assert await current_areas(settings, NOW) == []
    assert timeouts == [3, 3]
