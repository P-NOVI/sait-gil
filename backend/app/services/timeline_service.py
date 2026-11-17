"""길찾기에 쓰는 시간대별 혼잡도(Timeline)를 만든다.

- 지금 시간대: S-DoT 실시간 값을 쓰고, 실시간 값이 없는 센서는 예측으로 채운다.
- 뒤 시간대: S-DoT 예측을 쓰고, 예측이 없는 센서는 실시간 값으로 채운다.
- 도시데이터 구역: 지금 시간대는 지금 시각, 뒤 시간대는 그 시간 가운데 시각의 값
  (현재값 또는 12시간 예측)을 쓴다.
DB를 읽지 못하면 실시간 S-DoT 만으로 계산한다. 시간대들은 한꺼번에 읽는다.
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.cache import KeyedTtlCache
from app.config import Settings
from app.services.citydata_service import current_areas
from app.services.forecast_service import forecast_sensors
from core.congestion import Area, Layer, Sensor, Timeline, floor_hour, hour_slots

# 뒤 시간대의 도시데이터는 그 시간의 가운데 시각 값을 쓴다.
SLOT_MIDDLE = timedelta(minutes=30)


@dataclass
class TimelineCaches:
    """시간대별 예측 센서·구역 혼잡도. 실패한 빈 결과도 들고 있는다."""

    forecasts: KeyedTtlCache[datetime, list[Sensor]]
    # (시간대, 지금 시간대인지). 같은 시간대도 지금이 되면 기준 시각이 바뀐다.
    areas: KeyedTtlCache[tuple[datetime, bool], list[Area]]

    @classmethod
    def from_settings(cls, settings: Settings) -> "TimelineCaches":
        return cls(
            KeyedTtlCache(settings.forecast_cache_ttl_s),
            KeyedTtlCache(settings.citydata_cache_ttl_s),
        )


def merge_sensors(
    primary: Sequence[Sensor], fallback: Sequence[Sensor]
) -> list[Sensor]:
    """primary 를 먼저 쓰고, primary 에 없는 위치만 fallback 으로 채운다."""
    known = {sensor.position for sensor in primary}
    return [*primary, *(sensor for sensor in fallback if sensor.position not in known)]


async def _forecast(
    settings: Settings, slot: datetime, caches: TimelineCaches
) -> list[Sensor]:
    sensors = caches.forecasts.get(slot)
    if sensors is None:
        sensors = await forecast_sensors(settings, slot)
        caches.forecasts.set(slot, sensors)
    return sensors


async def _areas(
    settings: Settings,
    slot: datetime,
    current: bool,
    moment: datetime,
    caches: TimelineCaches,
) -> list[Area]:
    areas = caches.areas.get((slot, current))
    if areas is None:
        areas = await current_areas(settings, moment)
        caches.areas.set((slot, current), areas)
    return areas


async def _layer(
    settings: Settings,
    slot: datetime,
    now: datetime,
    realtime: Sequence[Sensor],
    caches: TimelineCaches,
) -> Layer:
    current = slot == floor_hour(now)
    moment = now if current else slot + SLOT_MIDDLE
    forecast, areas = await asyncio.gather(
        _forecast(settings, slot, caches),
        _areas(settings, slot, current, moment, caches),
    )
    sensors = (
        merge_sensors(realtime, forecast)
        if current
        else merge_sensors(forecast, realtime)
    )
    return Layer(sensors, areas)


async def build_timeline(
    settings: Settings,
    now: datetime,
    until: datetime,
    realtime: Sequence[Sensor],
    caches: TimelineCaches,
) -> Timeline:
    """now 에 출발해 until 까지 걷는 동안의 시간대별 혼잡도."""
    slots = hour_slots(now, until)
    layers = await asyncio.gather(
        *(_layer(settings, slot, now, realtime, caches) for slot in slots)
    )
    return Timeline(
        now, settings.walking_speed_mps, dict(zip(slots, layers, strict=True))
    )
