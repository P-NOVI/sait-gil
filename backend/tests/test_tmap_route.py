import pytest

from core.tmap_route import parse_route
from tests.helpers import LAT_STEP_M, tmap_response

VERTICES = [(127.0, 37.5), (127.0, 37.501), (127.0, 37.502), (127.0, 37.503)]


def test_parse_route_joins_lines_and_places_guide_points() -> None:
    response = tmap_response(VERTICES, [200, 212, 13, 201], total_time_s=240)
    response["features"].reverse()

    route = parse_route(response)

    assert route.line == VERTICES
    assert route.length_m == pytest.approx(3 * LAT_STEP_M, rel=1e-3)
    assert [p.turn_type for p in route.guide_points] == [200, 212, 13, 201]
    assert [p.distance_m for p in route.guide_points] == pytest.approx(
        [0, LAT_STEP_M, 2 * LAT_STEP_M, 3 * LAT_STEP_M], rel=1e-3
    )
    assert route.total_time_s == 240


def test_parse_route_reads_facility_codes_as_int() -> None:
    route = parse_route(tmap_response(VERTICES, [200, 11, 11, 201], [11, 1, 11]))

    assert [s.facility_type for s in route.segments] == [11, 1, 11]


def test_on_structure_only_inside_bridge_segment() -> None:
    route = parse_route(tmap_response(VERTICES, [200, 11, 11, 201], [11, 1, 11]))

    assert not route.on_structure(LAT_STEP_M / 2)
    assert route.on_structure(LAT_STEP_M * 1.5)
    assert not route.on_structure(LAT_STEP_M * 2.5)


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
