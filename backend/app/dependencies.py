from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings
from app.services.sensor_service import SensorCache, realtime_sensors
from app.services.tmap_client import TmapClient, tmap_http
from core.congestion import Sensor

SettingsDep = Annotated[Settings, Depends(get_settings)]

_sensor_cache = SensorCache()


async def get_tmap_client(settings: SettingsDep) -> AsyncIterator[TmapClient]:
    if not settings.tmap_app_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "TMAP_APP_KEY 가 설정되지 않았습니다."
        )
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


TmapClientDep = Annotated[TmapClient, Depends(get_tmap_client)]
SensorsDep = Annotated[list[Sensor], Depends(get_sensors)]
