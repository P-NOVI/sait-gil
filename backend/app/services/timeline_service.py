"""길찾기에 쓰는 시간대별 혼잡도(Timeline)를 만든다.

- 지금 시간대: S-DoT 실시간 값을 쓰고, 실시간 값이 없는 센서는 예측으로 채운다.
- 뒤 시간대: S-DoT 예측을 쓴다. 예측이 하나도 없으면 실시간 값을 그대로 쓴다.
- 도시데이터 구역: 지금 시간대는 지금 시각, 뒤 시간대는 그 시간 가운데 시각의 값
  (현재값 또는 12시간 예측)을 쓴다.
DB를 읽지 못하면 실시간 S-DoT 만으로 계산한다.
"""

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
    areas: KeyedTtlCache[datetime, list[Area]]

    @classmethod
    def from_settings(cls, settings: Settings) -> "TimelineCaches":
        return cls(
            KeyedTtlCache(settings.forecast_cache_ttl_s),
            KeyedTtlCache(settings.citydata_cache_ttl_s),
        )


def merge_sensors(
    realtime: Sequence[Sensor], forecast: Sequence[Sensor]
) -> list[Sensor]:
    """실시간 값을 먼저 쓰고, 실시간 값이 없는 위치만 예측으로 채운다."""
    known = {sensor.position for sensor in realtime}
    return [*realtime, *(sensor for sensor in forecast if sensor.position not in known)]


async def _forecast(
    settings: Settings, slot: datetime, caches: TimelineCaches
) -> list[Sensor]:
    sensors = caches.forecasts.get(slot)
    if sensors is None:
        sensors = await forecast_sensors(settings, slot)
        caches.forecasts.set(slot, sensors)
    return sensors


async def _areas(
    settings: Settings, slot: datetime, moment: datetime, caches: TimelineCaches
) -> list[Area]:
    areas = caches.areas.get(slot)
    if areas is None:
        areas = await current_areas(settings, moment)
        caches.areas.set(slot, areas)
    return areas


async def build_timeline(
    settings: Settings,
    now: datetime,
    until: datetime,
    realtime: Sequence[Sensor],
    caches: TimelineCaches,
) -> Timeline:
    """now 에 출발해 until 까지 걷는 동안의 시간대별 혼잡도."""
    current = floor_hour(now)
    layers: dict[datetime, Layer] = {}
    for slot in hour_slots(now, until):
        forecast = await _forecast(settings, slot, caches)
        if slot == current:
            sensors = merge_sensors(realtime, forecast)
            moment = now
        else:
            sensors = forecast or list(realtime)
            moment = slot + SLOT_MIDDLE
        layers[slot] = Layer(sensors, await _areas(settings, slot, moment, caches))
    return Timeline(now, settings.walking_speed_mps, layers)
