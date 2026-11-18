import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings
from app.services.sensor_service import SensorCache, realtime_sensors
from app.services.timeline_service import TimelineCaches, build_timeline
from app.services.tmap_client import TmapClient, tmap_http
from core.congestion import Sensor, Timeline

logger = logging.getLogger(__name__)

SettingsDep = Annotated[Settings, Depends(get_settings)]

TMAP_UNAVAILABLE = "지도 서비스를 지금 쓸 수 없습니다."

_sensor_cache = SensorCache()
_timeline_caches: TimelineCaches | None = None

# (출발 시각, 걷기를 마치는 시각) → 시간대별 혼잡도
TimelineReader = Callable[[datetime, datetime], Awaitable[Timeline]]


async def get_tmap_client(settings: SettingsDep) -> AsyncIterator[TmapClient]:
    if not settings.tmap_app_key:
        # 앱이 detail 을 화면·음성으로 내보내므로 설정 이름은 로그에만 남긴다.
        logger.error("TMAP_APP_KEY 가 설정되지 않았습니다.")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, TMAP_UNAVAILABLE)
    async for http in tmap_http(settings):
        yield TmapClient(http)


def get_sensor_cache() -> SensorCache:
    return _sensor_cache


async def get_sensors(
    settings: SettingsDep, cache: Annotated[SensorCache, Depends(get_sensor_cache)]
) -> list[Sensor]:
    """경로 혼잡 점수에 쓰는 센서 혼잡도(S-DoT 실시간).

    SDOT_CACHE_TTL_S 동안 같은 값을 쓴다. 실패한 빈 결과도 들고 있어서 S-DoT 장애
    동안 길찾기마다 S-DoT 응답을 기다리지 않는다.
    """
    sensors = cache.get(settings.sdot_cache_ttl_s)
    if sensors is None:
        sensors = await realtime_sensors(settings)
        cache.set(sensors)
    return sensors


def get_timeline_caches(settings: SettingsDep) -> TimelineCaches:
    global _timeline_caches
    if _timeline_caches is None:
        _timeline_caches = TimelineCaches.from_settings(settings)
    return _timeline_caches


def get_timeline_reader(
    settings: SettingsDep,
    sensors: Annotated[list[Sensor], Depends(get_sensors)],
    caches: Annotated[TimelineCaches, Depends(get_timeline_caches)],
) -> TimelineReader:
    """경로 혼잡 점수에 쓰는 시간대별 혼잡도(실시간·예측 S-DoT, 도시데이터 구역)."""

    async def read(now: datetime, until: datetime) -> Timeline:
        return await build_timeline(settings, now, until, sensors, caches)

    return read


TmapClientDep = Annotated[TmapClient, Depends(get_tmap_client)]
TimelineReaderDep = Annotated[TimelineReader, Depends(get_timeline_reader)]
