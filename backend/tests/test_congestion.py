from datetime import datetime, timedelta, timezone

import pytest

from core.congestion import (
    Area,
    Layer,
    Sensor,
    Timeline,
    area_level,
    congestion_level,
    congestion_summary,
    hour_slots,
    point_in_rings,
    point_levels,
    timed_point_levels,
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


SQUARE = [(127.0, 37.5), (127.01, 37.5), (127.01, 37.51), (127.0, 37.51)]
# ㄷ 자 모양 오목 다각형. 가운데 홈(127.003~127.007, 37.503 위)은 밖이다.
NOTCHED = [
    (127.0, 37.5),
    (127.01, 37.5),
    (127.01, 37.51),
    (127.007, 37.51),
    (127.007, 37.503),
    (127.003, 37.503),
    (127.003, 37.51),
    (127.0, 37.51),
]
HOLE = [(127.004, 37.504), (127.006, 37.504), (127.006, 37.506), (127.004, 37.506)]


def test_area_level_maps_steps_to_values() -> None:
    values = [0.0, 0.25, 0.5, 1.0]

    assert [area_level(step, values) for step in (1, 2, 3, 4)] == values
    with pytest.raises(ValueError):
        area_level(5, values)
    with pytest.raises(ValueError):
        area_level(0, values)


@pytest.mark.parametrize(
    ("position", "rings", "inside"),
    [
        ((127.005, 37.505), [SQUARE], True),
        ((127.02, 37.505), [SQUARE], False),
        ((127.001, 37.508), [NOTCHED], True),
        ((127.005, 37.508), [NOTCHED], False),
        ((127.005, 37.501), [NOTCHED], True),
        ((127.005, 37.505), [SQUARE, HOLE], False),
        ((127.002, 37.505), [SQUARE, HOLE], True),
        ((127.005, 37.505), [], False),
    ],
)
def test_point_in_rings(
    position: tuple[float, float], rings: list, inside: bool
) -> None:
    assert point_in_rings(position, rings) is inside


def test_point_levels_takes_larger_of_sensor_and_area() -> None:
    in_area_near_sensor = LinePoint((127.005, 37.505), 0)
    in_area_only = LinePoint((127.002, 37.502), 400)
    outside = LinePoint((127.02, 37.505), 1500)
    sensors = [Sensor((127.005, 37.5052), 0.9)]
    areas = [Area([SQUARE], 0.5)]

    levels = point_levels(
        [in_area_near_sensor, in_area_only, outside], sensors, radius_m=50, areas=areas
    )

    assert levels == [0.9, 0.5, 0.0]


# --- 도착 시간대 ---

KST = timezone(timedelta(hours=9))
DEPART = datetime(2026, 11, 17, 9, 50, tzinfo=KST)


def test_hour_slots_cover_walk() -> None:
    assert hour_slots(DEPART, DEPART + timedelta(minutes=75)) == [
        datetime(2026, 11, 17, 9, tzinfo=KST),
        datetime(2026, 11, 17, 10, tzinfo=KST),
        datetime(2026, 11, 17, 11, tzinfo=KST),
    ]


def test_timeline_slot_and_fallback_layer() -> None:
    nine, ten = (datetime(2026, 11, 17, h, tzinfo=KST) for h in (9, 10))
    first = Layer([Sensor((127.0, 37.5), 0.2)])
    timeline = Timeline(DEPART, 1.0, {nine: first})

    # 1.0m/s 로 600m 는 10분 뒤 10:00 이다.
    assert timeline.slot_at(599) == nine
    assert timeline.slot_at(600) == ten
    # 10시 값이 없으면 9시 값을 쓰고, 그 앞도 없으면 빈 값이다.
    assert timeline.layer(ten) == first
    assert timeline.layer(nine - timedelta(hours=1)) == Layer()


def test_timed_point_levels_use_arrival_slot() -> None:
    nine, ten = (datetime(2026, 11, 17, h, tzinfo=KST) for h in (9, 10))
    sensor_at = (127.0, 37.5)
    timeline = Timeline(
        DEPART,
        1.0,
        {nine: Layer([Sensor(sensor_at, 0.2)]), ten: Layer([Sensor(sensor_at, 0.9)])},
    )
    # 같은 자리라도 9시대에 닿는 점과 10시대에 닿는 점의 혼잡도가 다르다.
    points = [LinePoint(sensor_at, 0.0), LinePoint(sensor_at, 900.0)]

    assert timed_point_levels(points, timeline, 50) == [0.2, 0.9]
