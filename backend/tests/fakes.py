from collections.abc import Mapping, Sequence
from typing import Any

from app.services.tmap_client import TmapError
from core.geo import LngLat


class FakeTmap:
    """검색 옵션별 응답(또는 오류)을 돌려주는 Tmap 클라이언트 대역."""

    def __init__(
        self,
        routes: Mapping[int, dict | TmapError] | None = None,
        pois: dict | TmapError | None = None,
        address: dict | TmapError | None = None,
    ) -> None:
        self.routes = routes or {}
        self.pois: dict | TmapError = pois or {}
        self.address: dict | TmapError = address or {}
        self.route_options: list[int] = []

    async def pedestrian_route(
        self,
        start: LngLat,
        end: LngLat,
        search_option: int,
        start_name: str,
        end_name: str,
        pass_points: Sequence[LngLat] = (),
    ) -> dict[str, Any]:
        self.route_options.append(search_option)
        result = self.routes[search_option]
        if isinstance(result, TmapError):
            raise result
        return result

    async def search_pois(
        self, keyword: str, center: LngLat | None, count: int
    ) -> dict[str, Any]:
        if isinstance(self.pois, TmapError):
            raise self.pois
        return self.pois

    async def reverse_geocode(self, position: LngLat) -> dict[str, Any]:
        if isinstance(self.address, TmapError):
            raise self.address
        return self.address
