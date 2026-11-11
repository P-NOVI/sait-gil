import pytest

from core.congestion import (
    Sensor,
    congestion_level,
    congestion_summary,
    point_levels,
)
from core.geo import LinePoint


def test_congestion_level_is_clamped() -> None:
    assert congestion_level(150, 300) == 0.5
    assert congestion_level(900, 300) == 1.0
    assert congestion_level(-5, 300) == 0.0


def test_point_levels_uses_strongest_sensor_in_radius() -> None:
    near = LinePoint((127.0, 37.5), 0)
    far = LinePoint((127.0, 37.51), 1000)
    sensors = [
        Sensor((127.0, 37.5002), 0.4),
        Sensor((127.0, 37.4998), 0.9),
        Sensor((127.0, 37.52), 1.0),
    ]

    assert point_levels([near, far], sensors, radius_m=50) == [0.9, 0.0]


def test_congestion_summary_score_and_crowded_starts() -> None:
    points = [LinePoint((127.0, 37.5 + i * 0.0001), i * 10.0) for i in range(6)]
    levels = [0.0, 0.6, 0.8, 0.2, 0.7, 0.7]

    summary = congestion_summary(points, levels, crowded_level=0.5)

    assert summary.score == pytest.approx(10 * (0.3 + 0.7 + 0.5 + 0.45 + 0.7))
    assert [p.distance_m for p in summary.crowded_starts] == [10.0, 40.0]


def test_congestion_summary_crowded_from_start() -> None:
    points = [LinePoint((127.0, 37.5), 0.0), LinePoint((127.0, 37.5001), 10.0)]

    summary = congestion_summary(points, [0.9, 0.9], crowded_level=0.5)

    assert [p.distance_m for p in summary.crowded_starts] == [0.0]
