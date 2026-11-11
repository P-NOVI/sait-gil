"""DEM 고도로 경로의 경사 점수를 낸다."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise

from core.geo import LinePoint

# 교통약자의 이동편의 증진법 기준 1/50, 1/12 (배리어프리 core/slope.py 와 같다)
EASY_MAX_GRADE = 1 / 50
MODERATE_MAX_GRADE = 1 / 12


class GradeLevel(StrEnum):
    EASY = "easy"
    MODERATE = "moderate"
    HARD = "hard"


@dataclass(frozen=True)
class SlopeSummary:
    # 1/50 초과 1/12 이하 구간 길이(m)
    moderate_m: float
    # 1/12 초과 구간 길이(m)
    hard_m: float
    # 경사 때문에 더 걷는 셈인 거리(m). 낮을수록 완만하다.
    score: float


def grade_level(grade: float) -> GradeLevel:
    """경사(비율, 오르막 +, 내리막 -)를 3단계로 나눈다. 내리막도 절댓값으로 본다."""
    steepness = abs(grade)
    if steepness <= EASY_MAX_GRADE:
        return GradeLevel.EASY
    if steepness <= MODERATE_MAX_GRADE:
        return GradeLevel.MODERATE
    return GradeLevel.HARD


def slope_summary(
    points: Sequence[LinePoint],
    elevations: Sequence[float | None],
    skip: Callable[[float], bool],
    moderate_weight: float,
    hard_weight: float,
) -> SlopeSummary:
    """이웃한 두 점 사이 경사로 구간 길이를 단계별로 더한다.

    고도를 모르는 점, skip(구간 가운데 거리)이 참인 구간(교량·터널 등)은 뺀다.
    """
    lengths = {level: 0.0 for level in GradeLevel}
    pairs = pairwise(zip(points, elevations, strict=True))
    for (a, height_a), (b, height_b) in pairs:
        length = b.distance_m - a.distance_m
        if length <= 0 or height_a is None or height_b is None:
            continue
        if skip((a.distance_m + b.distance_m) / 2):
            continue
        lengths[grade_level((height_b - height_a) / length)] += length
    moderate_m, hard_m = lengths[GradeLevel.MODERATE], lengths[GradeLevel.HARD]
    return SlopeSummary(
        moderate_m=moderate_m,
        hard_m=hard_m,
        score=moderate_m * moderate_weight + hard_m * hard_weight,
    )
