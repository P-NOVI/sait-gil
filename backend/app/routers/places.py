from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.dependencies import SettingsDep, TmapClientDep
from app.services.place_service import parse_address, parse_places
from app.services.tmap_client import TmapError

router = APIRouter(prefix="/api/places", tags=["places"])

Longitude = Annotated[float, Query(ge=-180, le=180)]
Latitude = Annotated[float, Query(ge=-90, le=90)]


class PlaceOut(BaseModel):
    name: str
    address: str
    # 걸어서 들어가는 입구 좌표. 경로 목적지로 쓴다.
    position: tuple[float, float]
    # 검색 중심(lng, lat)에서 떨어진 거리. 중심을 주지 않으면 null
    distance_m: float | None


class PlacesResponse(BaseModel):
    places: list[PlaceOut]


class AddressResponse(BaseModel):
    # 행정동, 법정동 지번, 도로명 주소를 쉼표로 이은 전체 주소
    full_address: str
    # 음성으로 읽을 도로명 주소
    road_address: str
    road_name: str
    building_name: str


@router.get("")
async def search_places(
    client: TmapClientDep,
    settings: SettingsDep,
    query: Annotated[str, Query(min_length=1)],
    lng: Longitude | None = None,
    lat: Latitude | None = None,
) -> PlacesResponse:
    """말하거나 입력한 목적지를 찾는다. 내 위치(lng, lat)를 주면 거리도 알려 준다."""
    center = (lng, lat) if lng is not None and lat is not None else None
    try:
        response = await client.search_pois(query, center, settings.place_search_count)
    except TmapError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, error.message) from error
    return PlacesResponse(
        places=[
            PlaceOut(
                name=place.name,
                address=place.address,
                position=place.position,
                distance_m=place.distance_m if center else None,
            )
            for place in parse_places(response)
        ]
    )


@router.get("/address")
async def find_address(
    client: TmapClientDep, lng: Longitude, lat: Latitude
) -> AddressResponse:
    """좌표의 주소. "내 위치 말해 줘"에 쓴다."""
    try:
        response = await client.reverse_geocode((lng, lat))
    except TmapError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, error.message) from error
    address = parse_address(response)
    if address is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "주소를 찾지 못했습니다.")
    return AddressResponse(
        full_address=address.full_address,
        road_address=address.road_address,
        road_name=address.road_name,
        building_name=address.building_name,
    )
