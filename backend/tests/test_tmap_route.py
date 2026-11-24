import pytest

from core.tmap_route import parse_route
from tests.helpers import LAT_STEP_M, tmap_response

VERTICES = [(127.0, 37.5), (127.0, 37.501), (127.0, 37.502), (127.0, 37.503)]


def test_parse_route_joins_lines_and_places_guide_points() -> None:
    response = tmap_response(VERTICES, [200, 212, 13, 201])
    response["features"].reverse()

    route = parse_route(response)

    assert route.line == VERTICES
    assert route.length_m == pytest.approx(3 * LAT_STEP_M, rel=1e-3)
    assert [p.turn_type for p in route.guide_points] == [200, 212, 13, 201]
    assert [p.distance_m for p in route.guide_points] == pytest.approx(
        [0, LAT_STEP_M, 2 * LAT_STEP_M, 3 * LAT_STEP_M], rel=1e-3
    )


def test_parse_route_reads_facility_codes_as_int() -> None:
    route = parse_route(tmap_response(VERTICES, [200, 11, 11, 201], [11, 1, 11]))

    assert [s.facility_type for s in route.segments] == [11, 1, 11]


def test_on_structure_only_inside_bridge_segment() -> None:
    route = parse_route(tmap_response(VERTICES, [200, 11, 11, 201], [11, 1, 11]))

    assert not route.on_structure(LAT_STEP_M / 2)
    assert route.on_structure(LAT_STEP_M * 1.5)
    assert not route.on_structure(LAT_STEP_M * 2.5)


def round_trips(turn_types: list[int], facility_types: list[int]) -> list:
    response = tmap_response(VERTICES, turn_types, facility_types)
    return parse_route(response).underpass_round_trip_starts()


def test_underpass_between_surface_segments_gives_its_start() -> None:
    assert round_trips([200, 12, 11, 201], [11, 14, 11]) == [VERTICES[1]]


def test_underpass_round_trip_counts_even_with_entry_announcement() -> None:
    assert round_trips([200, 126, 11, 201], [11, 14, 11]) == [VERTICES[1]]


def test_joined_underpass_segments_give_only_the_first_start() -> None:
    vertices = [*VERTICES, (127.0, 37.504)]
    response = tmap_response(vertices, [200, 126, 13, 12, 201], [11, 14, 14, 11])

    assert parse_route(response).underpass_round_trip_starts() == [vertices[1]]


def test_underpass_from_start_is_not_a_round_trip() -> None:
    assert round_trips([126, 13, 13, 201], [14, 11, 11]) == []


def test_underpass_to_destination_is_not_a_round_trip() -> None:
    assert round_trips([200, 126, 13, 201], [11, 11, 14]) == []


def test_each_round_trip_gives_its_own_start() -> None:
    vertices = [*VERTICES, (127.0, 37.504), (127.0, 37.505)]
    response = tmap_response(
        vertices, [200, 126, 13, 126, 13, 201], [11, 14, 11, 14, 11]
    )

    assert parse_route(response).underpass_round_trip_starts() == [
        vertices[1],
        vertices[3],
    ]


def test_route_without_underpass_has_no_round_trip() -> None:
    assert round_trips([200, 11, 11, 201], [11, 11, 11]) == []


def test_round_trip_ignores_missing_facility_codes() -> None:
    response = tmap_response(VERTICES[:2], [200, 201])
    response["features"][1]["properties"]["facilityType"] = ""

    assert parse_route(response).underpass_round_trip_starts() == []


def test_parse_route_handles_missing_codes() -> None:
    response = tmap_response(VERTICES[:2], [200, 201])
    del response["features"][0]["properties"]["turnType"]
    response["features"][1]["properties"]["facilityType"] = ""

    route = parse_route(response)

    assert route.guide_points[0].turn_type is None
    assert route.segments[0].facility_type is None


def test_parse_route_empty_response() -> None:
    route = parse_route({"type": "FeatureCollection", "features": []})

    assert route.line == []
    assert route.length_m == 0.0
