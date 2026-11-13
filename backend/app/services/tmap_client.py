"""Tmap API 호출. 응답은 문자열 속 제어 문자만 공백으로 바꾸고 그대로 돌려준다.

문서: https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRoutePedestrianDoc
앱 키는 URL 대신 appKey 헤더로 보낸다. 로그·프록시에 키가 남지 않게 한다.
"""

import json
import re
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from app.config import Settings
from core.geo import LngLat

API_VERSION = "1"
COORD_TYPE = "WGS84GEO"
# 경유지는 경도,위도를 _ 로 잇는다. 최대 5곳
MAX_PASS_POINTS = 5
# 리버스 지오코딩 주소 타입: 행정동 + 법정동 + 도로명
REVERSE_ADDRESS_TYPE = "A10"
# Tmap 이 문자열에 제어 문자를 이스케이프하지 않고 넣을 때가 있다.
# 예: 안내 지점 이름 "서울역 1번출구\x00올리브영 서울역점"
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class TmapError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class TmapClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def pedestrian_route(
        self,
        start: LngLat,
        end: LngLat,
        search_option: int,
        start_name: str,
        end_name: str,
        pass_points: Sequence[LngLat] = (),
    ) -> dict[str, Any]:
        """보행자 경로(GeoJSON FeatureCollection)."""
        if len(pass_points) > MAX_PASS_POINTS:
            raise ValueError(f"경유지는 최대 {MAX_PASS_POINTS}곳입니다.")
        form = {
            "startX": start[0],
            "startY": start[1],
            "endX": end[0],
            "endY": end[1],
            "startName": start_name,
            "endName": end_name,
            "searchOption": search_option,
            "reqCoordType": COORD_TYPE,
            "resCoordType": COORD_TYPE,
        }
        if pass_points:
            form["passList"] = "_".join(f"{lng},{lat}" for lng, lat in pass_points)
        return await self._request(
            "POST", "/routes/pedestrian", params={"version": API_VERSION}, data=form
        )

    async def search_pois(
        self, keyword: str, center: LngLat | None, count: int
    ) -> dict[str, Any]:
        """장소 통합 검색. 결과가 없으면 빈 dict."""
        params: dict[str, Any] = {
            "version": API_VERSION,
            "searchKeyword": keyword,
            "count": count,
            "reqCoordType": COORD_TYPE,
            "resCoordType": COORD_TYPE,
        }
        if center:
            params["centerLon"], params["centerLat"] = center
        return await self._request("GET", "/pois", params=params)

    async def reverse_geocode(self, position: LngLat) -> dict[str, Any]:
        """좌표의 주소."""
        return await self._request(
            "GET",
            "/geo/reversegeocoding",
            params={
                "version": API_VERSION,
                "lon": position[0],
                "lat": position[1],
                "coordType": COORD_TYPE,
                "addressType": REVERSE_ADDRESS_TYPE,
            },
        )

    async def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = await self._http.request(method, path, **kwargs)
        except httpx.HTTPError as error:
            raise TmapError(502, f"Tmap 연결 실패: {type(error).__name__}") from error
        if response.is_error:
            raise TmapError(response.status_code, _error_message(response))
        # 장소 검색은 결과가 없으면 204 와 빈 본문을 준다.
        if not response.content:
            return {}
        return _read_json(response)


def _read_json(response: httpx.Response) -> dict[str, Any]:
    """응답 JSON. 문자열 속 제어 문자는 공백으로 바꾼다. 읽지 못하면 TmapError."""
    try:
        # strict=False: 이스케이프하지 않은 제어 문자도 문자열로 받는다.
        data = json.loads(response.text, strict=False)
    except ValueError as error:
        raise TmapError(502, "Tmap 응답을 읽지 못했습니다.") from error
    return _without_control_chars(data)


def _without_control_chars(value: Any) -> Any:
    if isinstance(value, str):
        return CONTROL_CHARS.sub(" ", value)
    if isinstance(value, dict):
        return {key: _without_control_chars(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_without_control_chars(item) for item in value]
    return value


def _error_message(response: httpx.Response) -> str:
    """Tmap 오류 응답의 메시지. JSON 이 아니면 상태 코드만 쓴다."""
    try:
        error = response.json().get("error", {})
    except ValueError:
        error = {}
    return str(error.get("message") or f"Tmap 오류 {response.status_code}")


async def tmap_http(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        base_url=settings.tmap_base_url,
        headers={"appKey": settings.tmap_app_key, "Accept": "application/json"},
        timeout=settings.tmap_timeout_s,
    ) as http:
        yield http
