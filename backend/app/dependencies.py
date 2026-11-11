from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.config import Settings, get_settings
from app.services.tmap_client import TmapClient, tmap_http
from core.congestion import Sensor

SettingsDep = Annotated[Settings, Depends(get_settings)]


async def get_tmap_client(settings: SettingsDep) -> AsyncIterator[TmapClient]:
    if not settings.tmap_app_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "TMAP_APP_KEY 가 설정되지 않았습니다."
        )
    async for http in tmap_http(settings):
        yield TmapClient(http)


def get_sensors() -> list[Sensor]:
    """경로 혼잡 점수에 쓰는 센서 혼잡도.

    S-DoT 실시간·예측 유동인구를 붙이기 전까지는 빈 목록이다. 그동안은 혼잡 점수가
    모두 0 이라 덜 붐비는 길을 따로 고르지 않는다.
    """
    return []


TmapClientDep = Annotated[TmapClient, Depends(get_tmap_client)]
SensorsDep = Annotated[list[Sensor], Depends(get_sensors)]
