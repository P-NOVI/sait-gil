"""S-DoT 센서 유동인구로 경로 위 점의 혼잡도(0~1)와 경로 혼잡 점수를 낸다.

센서는 서울에 백여 개뿐이라 센서 반경 안 점에만 혼잡도가 붙고, 나머지 점은 0 이다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

from core.geo import LinePoint, LngLat, distance_m


@dataclass(frozen=True)
class Sensor:
    position: LngLat
    # 0~1
    level: float


@dataclass(frozen=True)
class CongestionSummary:
    # 구간 길이 × 혼잡도를 더한 값(m). 낮을수록 덜 붐빈다.
    score: float
    # 붐비는 구간이 시작하는 점
    crowded_starts: list[LinePoint]


def congestion_level(visitor_count: float, full_count: float) -> float:
    """10분 유동인구를 0~1 로 바꾼다. full_count 명 이상이면 1."""
    return min(max(visitor_count, 0.0) / full_count, 1.0)


def point_levels(
    points: Sequence[LinePoint], sensors: Sequence[Sensor], radius_m: float
) -> list[float]:
    """점마다 radius_m 안 센서의 혼잡도. 센서가 여럿이면 큰 값을 쓴다."""
    levels = []
    for point in points:
        nearby = (
            sensor.level
            for sensor in sensors
            if distance_m(point.position, sensor.position) <= radius_m
        )
        levels.append(max(nearby, default=0.0))
    return levels


def congestion_summary(
    points: Sequence[LinePoint], levels: Sequence[float], crowded_level: float
) -> CongestionSummary:
    """혼잡 점수와, 혼잡도가 crowded_level 이상으로 올라서는 점을 찾는다."""
    score = 0.0
    for (a, level_a), (b, level_b) in pairwise(zip(points, levels, strict=True)):
        score += (b.distance_m - a.distance_m) * (level_a + level_b) / 2
    crowded_starts = [
        point
        for index, (point, level) in enumerate(zip(points, levels, strict=True))
        if level >= crowded_level and (index == 0 or levels[index - 1] < crowded_level)
    ]
    return CongestionSummary(score, crowded_starts)
