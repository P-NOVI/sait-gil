from collections.abc import Sequence

from app.config import Settings
from app.services.route_service import plan_routes
from core.congestion import Sensor
from core.geo import LngLat
from core.route_choice import RouteKind
from core.route_events import EventKind
from tests.helpers import LAT_STEP_M, tmap_response

START = (127.0, 37.5)
END = (127.0, 37.502)
# 추천 경로: 북쪽으로 곧장 (가파르고, 가운데에 붐비는 센서)
RECOMMENDED = tmap_response([START, (127.0, 37.501), END], [200, 11, 201])
# 후보: 동쪽으로 돌아감 (평지, 센서 반경 밖)
DETOUR = tmap_response(
    [START, (127.001, 37.5), (127.001, 37.502), END], [200, 12, 12, 201]
)
SENSORS = [Sensor((127.0, 37.501), 1.0)]


def flat_detour(positions: Sequence[LngLat]) -> list[float | None]:
    """경도 127.0 위는 가운데가 솟은 10% 언덕, 나머지는 평지. 출발·도착은 0m."""
    heights: list[float | None] = []
    for lng, lat in positions:
        north_m = (lat - START[1]) / 0.001 * LAT_STEP_M
        from_end_m = 2 * LAT_STEP_M - north_m
        heights.append(0.1 * min(north_m, from_end_m) if lng == START[0] else 0.0)
    return heights


def settings() -> Settings:
    return Settings(_env_file=None)


def test_plan_routes_picks_detour_as_less_crowded_and_gentle() -> None:
    planned = plan_routes([RECOMMENDED, DETOUR], SENSORS, settings(), flat_detour)

    assert [p.kinds for p in planned] == [
        (RouteKind.RECOMMENDED,),
        (RouteKind.LESS_CROWDED, RouteKind.GENTLE),
    ]
    recommended, detour = planned
    assert recommended.congestion_score > 0
    assert recommended.slope.hard_m > 0
    assert detour.congestion_score == 0
    assert detour.slope.score == 0


def test_plan_routes_events_include_crowd_start() -> None:
    recommended = plan_routes([RECOMMENDED], SENSORS, settings(), flat_detour)[0]

    kinds = [event.kind for event in recommended.events]
    assert kinds == [EventKind.CROWD, EventKind.DESTINATION]


def test_plan_routes_counts_same_route_once() -> None:
    planned = plan_routes([RECOMMENDED, RECOMMENDED], SENSORS, settings(), flat_detour)

    assert len(planned) == 1
    assert planned[0].kinds == (
        RouteKind.RECOMMENDED,
        RouteKind.LESS_CROWDED,
        RouteKind.GENTLE,
    )


def test_plan_routes_without_routes() -> None:
    assert plan_routes([], SENSORS, settings(), flat_detour) == []
