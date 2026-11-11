"""경위도 좌표 계산. 걷는 거리 안에서는 평면으로 봐도 오차가 작다."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

EARTH_RADIUS_M = 6_371_000.0
METERS_PER_DEGREE = EARTH_RADIUS_M * math.pi / 180
# 같은 경로인지 볼 때 좌표를 맞추는 자릿수. 소수 5자리는 약 1m 다.
LINE_KEY_DIGITS = 5

LngLat = tuple[float, float]


@dataclass(frozen=True)
class LinePoint:
    position: LngLat
    # 출발점부터 경로 선을 따라 간 거리
    distance_m: float


def distance_m(a: LngLat, b: LngLat) -> float:
    """두 좌표 사이 거리(m)."""
    cos = math.cos(math.radians((a[1] + b[1]) / 2))
    dx = (b[0] - a[0]) * METERS_PER_DEGREE * cos
    dy = (b[1] - a[1]) * METERS_PER_DEGREE
    return math.hypot(dx, dy)


def cumulative_distances(line: Sequence[LngLat]) -> list[float]:
    """출발점부터 각 꼭짓점까지 경로를 따라 간 거리(m)."""
    distances = [0.0] if line else []
    for a, b in pairwise(line):
        distances.append(distances[-1] + distance_m(a, b))
    return distances


def sample_line(line: Sequence[LngLat], interval_m: float) -> list[LinePoint]:
    """경로 선 위에 interval_m 간격으로 점을 찍는다. 끝점은 간격과 상관없이 넣는다."""
    if interval_m <= 0:
        raise ValueError("interval_m 은 0보다 커야 합니다.")
    if not line:
        return []
    distances = cumulative_distances(line)
    total = distances[-1]
    points: list[LinePoint] = []
    segment = 0
    target = 0.0
    while target < total:
        while distances[segment + 1] < target:
            segment += 1
        points.append(LinePoint(_point_at(line, distances, segment, target), target))
        target += interval_m
    points.append(LinePoint(line[-1], total))
    return points


def line_key(line: Sequence[LngLat]) -> tuple[LngLat, ...]:
    """좌표를 약 1m 단위로 맞춘 값. 이 값이 같으면 같은 경로로 본다."""
    return tuple(
        (round(lng, LINE_KEY_DIGITS), round(lat, LINE_KEY_DIGITS)) for lng, lat in line
    )


def _point_at(
    line: Sequence[LngLat], distances: Sequence[float], segment: int, target: float
) -> LngLat:
    start, end = distances[segment], distances[segment + 1]
    t = 0.0 if end == start else (target - start) / (end - start)
    (lng1, lat1), (lng2, lat2) = line[segment], line[segment + 1]
    return (lng1 + t * (lng2 - lng1), lat1 + t * (lat2 - lat1))
