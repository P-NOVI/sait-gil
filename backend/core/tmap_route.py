"""Tmap 보행자 경로 응답(GeoJSON)을 경로 선·구간·안내점으로 바꾼다.

응답 형식: https://tmapapi.tmapmobility.com/main.html#webservice/docs/tmapRoutePedestrianDoc
- Point 는 안내점(turnType, pointType)이다.
- LineString 은 안내점 사이 구간(facilityType)이다.
- totalDistance, totalTime 은 출발지(pointType=SP) Point 에만 온다.
"""

from bisect import bisect_right
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.geo import LngLat, distance_m

# 구간 시설물(facilityType) 중 지면 높이와 다른 곳. DEM 은 이 위·아래 높이를 모른다.
# 1 교량, 2 터널, 3 고가도로, 12 육교, 14 지하보도, 18 지하철지하보도
STRUCTURE_FACILITY_TYPES = frozenset({1, 2, 3, 12, 14, 18})
START_POINT_TYPE = "SP"


@dataclass(frozen=True)
class Segment:
    start_m: float
    end_m: float
    facility_type: int | None


@dataclass(frozen=True)
class GuidePoint:
    position: LngLat
    distance_m: float
    turn_type: int | None
    description: str


@dataclass(frozen=True)
class TmapRoute:
    line: list[LngLat]
    # 출발점부터 line 의 각 꼭짓점까지 거리(m)
    distances_m: list[float]
    segments: list[Segment]
    guide_points: list[GuidePoint]
    total_time_s: int | None

    @property
    def length_m(self) -> float:
        return self.distances_m[-1] if self.distances_m else 0.0

    def on_structure(self, at_m: float) -> bool:
        """경로 위 at_m 지점이 교량·터널 같은 구조물 구간인지."""
        starts = [segment.start_m for segment in self.segments]
        index = bisect_right(starts, at_m) - 1
        if index < 0:
            return False
        segment = self.segments[index]
        return (
            at_m <= segment.end_m and segment.facility_type in STRUCTURE_FACILITY_TYPES
        )


def parse_route(response: Mapping[str, Any]) -> TmapRoute:
    """응답의 Feature 를 index 순서로 이어 붙인다."""
    features = sorted(
        response.get("features", []),
        key=lambda feature: _as_int(feature["properties"].get("index")) or 0,
    )
    line: list[LngLat] = []
    distances: list[float] = []
    segments: list[Segment] = []
    guide_points: list[GuidePoint] = []
    total_time_s: int | None = None

    for feature in features:
        geometry, properties = feature["geometry"], feature["properties"]
        if geometry["type"] == "LineString":
            start_m = distances[-1] if distances else 0.0
            for lng, lat in geometry["coordinates"]:
                point = (float(lng), float(lat))
                if line and point == line[-1]:
                    continue
                distances.append(
                    distances[-1] + distance_m(line[-1], point) if line else 0.0
                )
                line.append(point)
            segments.append(
                Segment(start_m, distances[-1], _as_int(properties.get("facilityType")))
            )
        elif geometry["type"] == "Point":
            lng, lat = geometry["coordinates"]
            guide_points.append(
                GuidePoint(
                    position=(float(lng), float(lat)),
                    distance_m=distances[-1] if distances else 0.0,
                    turn_type=_as_int(properties.get("turnType")),
                    description=str(properties.get("description", "")).strip(),
                )
            )
            if properties.get("pointType") == START_POINT_TYPE:
                total_time_s = _as_int(properties.get("totalTime"))

    return TmapRoute(line, distances, segments, guide_points, total_time_s)


def _as_int(value: Any) -> int | None:
    """코드 값이 숫자로도, 문자열로도 온다. 빈 값은 None."""
    if value is None or value == "":
        return None
    return int(value)
