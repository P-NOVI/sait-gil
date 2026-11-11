import json
import logging
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.services.sdot_client import KST
from app.services.sensor_service import (
    SensorCache,
    load_sensor_positions,
    realtime_sensors,
    sensors_with_levels,
)
from core.congestion import Sensor

NOW = datetime(2026, 11, 11, 15, 30, tzinfo=KST)


def write_positions(path: Path) -> Path:
    sensors = [
        {"code": 1, "lon": 127.0, "lat": 37.5, "address": "주소"},
        {"code": 2, "lon": 127.01, "lat": 37.51, "address": "주소"},
    ]
    path.write_text(json.dumps({"sensors": sensors}), encoding="utf-8")
    return path


def sdot_settings(tmp_path: Path, **fields: object) -> Settings:
    base = {
        "_env_file": None,
        "seoul_api_key": "test-key",
        "sdot_base_url": "http://sdot.test",
        "sensors_path": write_positions(tmp_path / "sdot_sensors.json"),
        "sdot_page_size": 3,
    }
    return Settings(**{**base, **fields})


def reading(serial: str, count: str) -> dict[str, str]:
    return {
        "SERIAL": serial,
        "VISITOR_COUNT": count,
        "SENSING_TIME": "2026-11-11_15:10:00",
    }


def test_load_sensor_positions(tmp_path: Path) -> None:
    path = tmp_path / "sdot_sensors.json"
    sensors = [{"code": 2992, "lon": 126.833076, "lat": 37.532463, "address": "주소"}]
    path.write_text(json.dumps({"sensors": sensors}), encoding="utf-8")

    assert load_sensor_positions(path) == {2992: (126.833076, 37.532463)}


def test_sensors_with_levels_skips_unknown_codes() -> None:
    positions = {1: (127.0, 37.5)}

    sensors = sensors_with_levels(positions, {1: 150, 2: 300}, full_count=300)

    assert sensors == [Sensor((127.0, 37.5), 0.5)]


@pytest.mark.anyio
async def test_realtime_sensors_turns_counts_into_levels(tmp_path: Path) -> None:
    seen: list[httpx.URL] = []
    rows = [reading("1", "150"), reading("2", "600"), reading("9", "300")]
    body = {"sDoTPeople": {"RESULT": {"CODE": "INFO-000"}, "row": rows}}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json=body)

    sensors = await realtime_sensors(
        sdot_settings(tmp_path), httpx.MockTransport(handler), now=NOW
    )

    assert sensors == [Sensor((127.0, 37.5), 0.5), Sensor((127.01, 37.51), 1.0)]
    assert str(seen[0]) == "http://sdot.test/test-key/json/sDoTPeople/1/3/"


@pytest.mark.parametrize(
    "fields",
    [{"seoul_api_key": ""}, {"sensors_path": Path("missing/sdot_sensors.json")}],
)
@pytest.mark.anyio
async def test_realtime_sensors_without_key_or_positions(
    tmp_path: Path, fields: dict, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("S-DoT 를 부르면 안 된다")

    with caplog.at_level(logging.WARNING):
        sensors = await realtime_sensors(
            sdot_settings(tmp_path, **fields), httpx.MockTransport(handler), now=NOW
        )

    assert sensors == []
    assert "혼잡도 없이" in caplog.text


@pytest.mark.anyio
async def test_realtime_sensors_sdot_failure_is_empty(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(503))

    with caplog.at_level(logging.WARNING):
        sensors = await realtime_sensors(sdot_settings(tmp_path), transport, now=NOW)

    assert sensors == []
    assert "S-DoT 응답 실패" in caplog.text
    assert "test-key" not in caplog.text


def test_sensor_cache_expires_after_ttl() -> None:
    clock = [0.0]
    cache = SensorCache(clock=lambda: clock[0])
    sensors = [Sensor((127.0, 37.5), 0.5)]

    assert cache.get(60) is None
    cache.set(sensors)
    clock[0] = 59.9
    assert cache.get(60) == sensors
    clock[0] = 60.0
    assert cache.get(60) is None
