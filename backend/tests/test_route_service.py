from collections.abc import Sequence
from datetime import datetime

from app.config import Settings
from app.services.route_service import plan_routes
from app.services.sdot_client import KST
from core.congestion import Layer, Sensor, constant_timeline
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
TIMELINE = constant_timeline(
    Layer([Sensor((127.0, 37.501), 1.0)]), datetime(2026, 11, 17, 9, tzinfo=KST)
)


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
    planned = plan_routes([RECOMMENDED, DETOUR], TIMELINE, settings(), flat_detour)

    assert [p.kinds for p in planned] == [
        (RouteKind.RECOMMENDED,),
        (RouteKind.LESS_CROWDED, RouteKind.GENTLE),
    ]
    recommended, detour = planned
    assert recommended.congestion_score > 0
    assert recommended.slope.hard_m > 0
    assert detour.congestion_score == 0
    assert detour.slope.score == 0


def detour_with_facility(turn: int) -> dict:
    """DETOUR 와 같은 선. 두 번째 구간만 시설물 14 이고, 그 앞 안내점은 turn 이다."""
    return tmap_response(
        [START, (127.001, 37.5), (127.001, 37.502), END],
        [200, turn, 12, 201],
        [11, 14, 11],
    )


def test_plan_routes_skips_candidate_with_unannounced_facility() -> None:
    risky = detour_with_facility(12)

    planned = plan_routes([RECOMMENDED, risky], TIMELINE, settings(), flat_detour)

    assert [p.kinds for p in planned] == [
        (RouteKind.RECOMMENDED, RouteKind.LESS_CROWDED, RouteKind.GENTLE)
    ]


def test_plan_routes_keeps_candidate_with_announced_underpass() -> None:
    underpass = detour_with_facility(126)

    planned = plan_routes([RECOMMENDED, underpass], TIMELINE, settings(), flat_detour)

    assert [p.kinds for p in planned][1] == (RouteKind.LESS_CROWDED, RouteKind.GENTLE)


def test_plan_routes_keeps_candidate_sharing_the_recommended_facility() -> None:
    # 둘 다 출발점에서 안내 없이 14 로 시작한다. 같은 곳이라 후보를 거르지 않는다.
    recommended = tmap_response([START, (127.0, 37.501), END], [200, 11, 201], [14, 11])
    shared = tmap_response(
        [START, (127.001, 37.5), (127.001, 37.502), END],
        [200, 12, 12, 201],
        [14, 11, 11],
    )

    planned = plan_routes([recommended, shared], TIMELINE, settings(), flat_detour)

    assert [p.kinds for p in planned][1] == (RouteKind.LESS_CROWDED, RouteKind.GENTLE)


def test_plan_routes_skips_candidate_with_its_own_unannounced_facility() -> None:
    # 추천 경로도 안내 없는 14 구간이 있지만, 후보의 14 구간은 다른 곳이다.
    recommended = tmap_response([START, (127.0, 37.501), END], [200, 11, 201], [14, 11])
    risky = detour_with_facility(12)

    planned = plan_routes([recommended, risky], TIMELINE, settings(), flat_detour)

    assert [p.kinds for p in planned] == [
        (RouteKind.RECOMMENDED, RouteKind.LESS_CROWDED, RouteKind.GENTLE)
    ]


def test_plan_routes_events_include_crowd_start() -> None:
    recommended = plan_routes([RECOMMENDED], TIMELINE, settings(), flat_detour)[0]

    kinds = [event.kind for event in recommended.events]
    assert kinds == [EventKind.CROWD, EventKind.DESTINATION]


def test_plan_routes_counts_same_route_once() -> None:
    planned = plan_routes([RECOMMENDED, RECOMMENDED], TIMELINE, settings(), flat_detour)

    assert len(planned) == 1
    assert planned[0].kinds == (
        RouteKind.RECOMMENDED,
        RouteKind.LESS_CROWDED,
        RouteKind.GENTLE,
    )


def test_plan_routes_without_routes() -> None:
    assert plan_routes([], TIMELINE, settings(), flat_detour) == []
