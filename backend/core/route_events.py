"""고른 경로의 미리 알림 이벤트(회전, 횡단보도, 계단, 혼잡 구간 시작 등)를 만든다.

회전·시설물은 Tmap 안내점의 turnType 으로 정한다.
혼잡 구간 시작은 경로 위 점의 혼잡도로 정한다.
앱은 이벤트까지 남은 거리가 이벤트 종류별 알림 거리 안에 들어오면 알린다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from core.geo import LinePoint, LngLat
from core.tmap_route import GuidePoint


class EventKind(StrEnum):
    TURN = "turn"
    CROSSWALK = "crosswalk"
    STAIRS = "stairs"
    RAMP = "ramp"
    OVERPASS = "overpass"
    UNDERPASS = "underpass"
    ELEVATOR = "elevator"
    CROWD = "crowd"
    DESTINATION = "destination"


class Direction(StrEnum):
    LEFT = "left"
    RIGHT = "right"
    UTURN = "uturn"
    # 8시 방향
    SHARP_LEFT = "sharp_left"
    # 10시 방향
    SLIGHT_LEFT = "slight_left"
    # 2시 방향
    SLIGHT_RIGHT = "slight_right"
    # 4시 방향
    SHARP_RIGHT = "sharp_right"


# Tmap turnType → (이벤트, 방향). 표에 없는 코드는 알리지 않는다:
# 1~7 안내 없음, 11 직진, 184~189 경유지(후보 경로를 만들려고 넣은 점),
# 200 출발지, 233 직진 임시
TURN_TYPE_EVENTS: dict[int, tuple[EventKind, Direction | None]] = {
    12: (EventKind.TURN, Direction.LEFT),
    13: (EventKind.TURN, Direction.RIGHT),
    14: (EventKind.TURN, Direction.UTURN),
    16: (EventKind.TURN, Direction.SHARP_LEFT),
    17: (EventKind.TURN, Direction.SLIGHT_LEFT),
    18: (EventKind.TURN, Direction.SLIGHT_RIGHT),
    19: (EventKind.TURN, Direction.SHARP_RIGHT),
    125: (EventKind.OVERPASS, None),
    126: (EventKind.UNDERPASS, None),
    127: (EventKind.STAIRS, None),
    128: (EventKind.RAMP, None),
    129: (EventKind.STAIRS, None),
    201: (EventKind.DESTINATION, None),
    211: (EventKind.CROSSWALK, None),
    212: (EventKind.CROSSWALK, Direction.LEFT),
    213: (EventKind.CROSSWALK, Direction.RIGHT),
    214: (EventKind.CROSSWALK, Direction.SHARP_LEFT),
    215: (EventKind.CROSSWALK, Direction.SLIGHT_LEFT),
    216: (EventKind.CROSSWALK, Direction.SLIGHT_RIGHT),
    217: (EventKind.CROSSWALK, Direction.SHARP_RIGHT),
    218: (EventKind.ELEVATOR, None),
}


@dataclass(frozen=True)
class RouteEvent:
    kind: EventKind
    # 출발점부터 경로를 따라 이벤트 지점까지 거리
    distance_m: float
    position: LngLat
    direction: Direction | None = None


def route_events(
    guide_points: Sequence[GuidePoint], crowded_starts: Sequence[LinePoint]
) -> list[RouteEvent]:
    """경로 위 거리 순서로 정렬한 이벤트 목록."""
    events = [
        RouteEvent(kind, point.distance_m, point.position, direction)
        for point in guide_points
        if point.turn_type in TURN_TYPE_EVENTS
        for kind, direction in [TURN_TYPE_EVENTS[point.turn_type]]
    ]
    events += [
        RouteEvent(EventKind.CROWD, point.distance_m, point.position)
        for point in crowded_starts
    ]
    return sorted(events, key=lambda event: event.distance_m)
