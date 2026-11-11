from core.geo import LinePoint
from core.route_events import Direction, EventKind, RouteEvent, route_events
from core.tmap_route import GuidePoint


def guide(turn_type: int | None, distance_m: float) -> GuidePoint:
    return GuidePoint((127.0, 37.5), distance_m, turn_type, "")


def test_route_events_maps_turn_types_and_skips_others() -> None:
    points = [
        guide(200, 0),
        guide(11, 20),
        guide(185, 30),
        guide(13, 40),
        guide(214, 60),
        guide(127, 80),
        guide(None, 90),
        guide(201, 100),
    ]

    events = route_events(points, [])

    assert [(e.kind, e.direction, e.distance_m) for e in events] == [
        (EventKind.TURN, Direction.RIGHT, 40),
        (EventKind.CROSSWALK, Direction.SHARP_LEFT, 60),
        (EventKind.STAIRS, None, 80),
        (EventKind.DESTINATION, None, 100),
    ]


def test_route_events_merges_crowd_starts_in_order() -> None:
    crowd = LinePoint((127.0, 37.5005), 50)

    events = route_events([guide(12, 30), guide(201, 100)], [crowd])

    assert events[1] == RouteEvent(EventKind.CROWD, 50, (127.0, 37.5005))
    assert [e.distance_m for e in events] == [30, 50, 100]
