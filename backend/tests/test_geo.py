import pytest

from core.geo import cumulative_distances, distance_m, line_key, sample_line
from tests.helpers import LAT_STEP_M


def test_distance_m_north_step() -> None:
    assert distance_m((127.0, 37.5), (127.0, 37.501)) == pytest.approx(
        LAT_STEP_M, rel=1e-3
    )


def test_cumulative_distances_adds_segments() -> None:
    line = [(127.0, 37.5), (127.0, 37.501), (127.0, 37.502)]

    assert cumulative_distances(line) == pytest.approx(
        [0.0, LAT_STEP_M, 2 * LAT_STEP_M], rel=1e-3
    )


def test_sample_line_keeps_interval_and_end() -> None:
    points = sample_line([(127.0, 37.5), (127.0, 37.501)], interval_m=50)

    assert [p.distance_m for p in points] == pytest.approx(
        [0, 50, 100, LAT_STEP_M], rel=1e-3
    )
    assert points[1].position[1] == pytest.approx(37.5 + 0.001 * 50 / LAT_STEP_M)
    assert points[-1].position == (127.0, 37.501)


def test_sample_line_crosses_vertices() -> None:
    line = [(127.0, 37.5), (127.0, 37.501), (127.0, 37.502)]

    points = sample_line(line, interval_m=100)

    assert points[2].distance_m == 200
    assert points[2].position[1] == pytest.approx(37.5 + 0.002 * 200 / 222.38, 1e-6)


def test_sample_line_single_point() -> None:
    points = sample_line([(127.0, 37.5)], interval_m=10)

    assert [(p.position, p.distance_m) for p in points] == [((127.0, 37.5), 0.0)]


def test_sample_line_rejects_bad_interval() -> None:
    with pytest.raises(ValueError):
        sample_line([(127.0, 37.5), (127.0, 37.501)], interval_m=0)


def test_line_key_ignores_sub_meter_noise() -> None:
    assert line_key([(127.0, 37.5)]) == line_key([(127.000001, 37.500001)])
    assert line_key([(127.0, 37.5)]) != line_key([(127.0001, 37.5)])
