import pytest

from core.geo import LinePoint
from core.slope import GradeLevel, grade_level, slope_summary


@pytest.mark.parametrize(
    ("grade", "level"),
    [
        (0.0, GradeLevel.EASY),
        (1 / 50, GradeLevel.EASY),
        (-0.03, GradeLevel.MODERATE),
        (1 / 12, GradeLevel.MODERATE),
        (0.1, GradeLevel.HARD),
    ],
)
def test_grade_level(grade: float, level: GradeLevel) -> None:
    assert grade_level(grade) is level


def points(count: int, step_m: float = 10.0) -> list[LinePoint]:
    return [LinePoint((127.0, 37.5), i * step_m) for i in range(count)]


def test_slope_summary_adds_lengths_by_level() -> None:
    # 구간 경사: 1%(완만), 5%(보통), 14%(가파름), 고도 모름, 고도 모름
    elevations = [0.0, 0.1, 0.6, 2.0, None, 3.0]

    summary = slope_summary(
        points(6), elevations, skip=lambda _: False, moderate_weight=0.5, hard_weight=2
    )

    assert summary.moderate_m == 10
    assert summary.hard_m == 10
    assert summary.score == 10 * 0.5 + 10 * 2


def test_slope_summary_skips_structures() -> None:
    elevations = [0.0, 5.0, 5.0]

    summary = slope_summary(
        points(3),
        elevations,
        skip=lambda at_m: at_m < 10,
        moderate_weight=0.5,
        hard_weight=2,
    )

    assert summary.hard_m == 0
    assert summary.score == 0
