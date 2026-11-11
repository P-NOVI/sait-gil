"""S-DoT 센서 위치 파일을 읽고, 센서별 유동인구를 혼잡도로 바꾼다."""

import json
import logging
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import httpx

from app.config import Settings
from app.services.sdot_client import (
    KST,
    SdotError,
    fetch_people_rows,
    latest_counts,
    sdot_http,
)
from core.congestion import Sensor, congestion_level
from core.geo import LngLat

logger = logging.getLogger(__name__)


@lru_cache
def load_sensor_positions(path: Path) -> dict[int, LngLat]:
    """pipeline/ 이 만든 sdot_sensors.json({"sensors": [{code, lon, lat}]})을 읽는다."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        int(sensor["code"]): (float(sensor["lon"]), float(sensor["lat"]))
        for sensor in data["sensors"]
    }


def sensors_with_levels(
    positions: Mapping[int, LngLat], counts: Mapping[int, float], full_count: float
) -> list[Sensor]:
    """센서 코드별 10분 유동인구(실시간 또는 예측)를 혼잡도로 바꾼다.

    위치를 모르는 센서는 뺀다.
    """
    return [
        Sensor(positions[code], congestion_level(count, full_count))
        for code, count in counts.items()
        if code in positions
    ]


async def realtime_sensors(
    settings: Settings,
    transport: httpx.AsyncBaseTransport | None = None,
    now: datetime | None = None,
) -> list[Sensor]:
    """S-DoT 실시간 유동인구로 센서 혼잡도를 만든다.

    키나 센서 위치 파일이 없거나 S-DoT 가 실패하면 경고를 남기고 빈 목록이다.
    그러면 혼잡 점수가 모두 0 이라 덜 붐비는 길을 따로 고르지 않는다.
    """
    if not settings.seoul_api_key:
        logger.warning("SEOUL_API_KEY 가 없어 혼잡도 없이 경로를 고릅니다.")
        return []
    if not settings.sensors_path.exists():
        logger.warning(
            "센서 위치 파일이 없어 혼잡도 없이 경로를 고릅니다: %s",
            settings.sensors_path,
        )
        return []
    positions = load_sensor_positions(settings.sensors_path)
    try:
        async with sdot_http(settings, transport) as http:
            rows = await fetch_people_rows(http, settings.sdot_page_size)
    except SdotError as error:
        logger.warning("혼잡도 없이 경로를 고릅니다. %s", error)
        return []
    counts = latest_counts(
        rows,
        now or datetime.now(KST),
        timedelta(minutes=settings.sdot_max_age_minutes),
    )
    return sensors_with_levels(positions, counts, settings.congestion_full_count)


class SensorCache:
    """센서 혼잡도 한 벌을 잠시 들고 있는다."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._entry: tuple[float, list[Sensor]] | None = None

    def get(self, ttl_s: float) -> list[Sensor] | None:
        if self._entry is None or self._clock() - self._entry[0] >= ttl_s:
            return None
        return self._entry[1]

    def set(self, sensors: list[Sensor]) -> None:
        self._entry = (self._clock(), sensors)
