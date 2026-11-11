"""Tmap 장소 검색·리버스 지오코딩 응답을 앱에서 쓰는 형태로 바꾼다."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.geo import LngLat

METERS_PER_KM = 1000
# 장소 좌표 우선순위: 보행자 입구점, 시설물 입구, 중심점
POSITION_KEYS = (("pnsLon", "pnsLat"), ("frontLon", "frontLat"), ("noorLon", "noorLat"))


@dataclass(frozen=True)
class Place:
    name: str
    address: str
    # 걸어서 들어가는 입구 좌표. 경로 목적지로 쓴다.
    position: LngLat
    # 검색 중심에서 떨어진 거리. 중심을 주지 않으면 None
    distance_m: float | None


@dataclass(frozen=True)
class Address:
    # 주소 타입 A10 이라 "행정동,법정동 지번,도로명 주소" 를 쉼표로 이어 준다.
    full_address: str
    # full_address 의 마지막 부분(도로명 주소). 음성으로 읽기에 쓴다.
    road_address: str
    road_name: str
    building_name: str


def parse_places(response: Mapping[str, Any]) -> list[Place]:
    """장소 검색 응답(searchPoiInfo.pois.poi). 좌표가 없는 장소는 뺀다."""
    pois = response.get("searchPoiInfo", {}).get("pois", {}).get("poi", [])
    places = []
    for poi in pois:
        position = _position(poi)
        if position is None:
            continue
        places.append(
            Place(
                name=str(poi.get("name", "")).strip(),
                address=_poi_address(poi),
                position=position,
                distance_m=_distance_m(poi.get("radius")),
            )
        )
    return places


def parse_address(response: Mapping[str, Any]) -> Address | None:
    info = response.get("addressInfo")
    if not info:
        return None
    full_address = str(info.get("fullAddress", "")).strip()
    parts = [part.strip() for part in full_address.split(",") if part.strip()]
    return Address(
        full_address=full_address,
        road_address=parts[-1] if parts else "",
        road_name=str(info.get("roadName", "")).strip(),
        building_name=str(info.get("buildingName", "")).strip(),
    )


def _position(poi: Mapping[str, Any]) -> LngLat | None:
    """좌표 값이 문자열로 오고, 없는 좌표는 빈 값이나 0 으로 온다."""
    for lng_key, lat_key in POSITION_KEYS:
        lng, lat = _as_float(poi.get(lng_key)), _as_float(poi.get(lat_key))
        if lng and lat:
            return (lng, lat)
    return None


def _poi_address(poi: Mapping[str, Any]) -> str:
    """도로명 주소가 있으면 그것을, 없으면 지번 주소를 쓴다."""
    new_addresses = poi.get("newAddressList", {}).get("newAddress", [])
    if new_addresses and new_addresses[0].get("fullAddressRoad"):
        return str(new_addresses[0]["fullAddressRoad"]).strip()
    lot = "-".join(
        number
        for number in (poi.get("firstNo"), poi.get("secondNo"))
        if number and number != "0"
    )
    parts = [
        poi.get(key) for key in ("upperAddrName", "middleAddrName", "lowerAddrName")
    ]
    return " ".join(str(part) for part in [*parts, lot] if part)


def _distance_m(radius_km: Any) -> float | None:
    value = _as_float(radius_km)
    return None if value is None else value * METERS_PER_KM


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)
