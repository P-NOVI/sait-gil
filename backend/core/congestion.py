"""경로 위 점의 혼잡도(0~1)와 경로 혼잡 점수를 낸다.

S-DoT 센서는 서울에 백여 개뿐이라, 서울 실시간 도시데이터의 주요 장소 구역 혼잡도로
빈 곳을 채운다. 점마다 반경 안 센서와 점을 품은 구역 중 가장 큰 혼잡도를 쓰고,
어디에도 걸리지 않는 점은 0 이다.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import chain, pairwise

from core.geo import LinePoint, LngLat, distance_m


@dataclass(frozen=True)
class Sensor:
    position: LngLat
    # 0~1
    level: float


Ring = Sequence[LngLat]


@dataclass(frozen=True)
class Area:
    """도시데이터 주요 장소 구역. rings 는 외곽선·구멍·여러 조각을 모두 담는다."""

    rings: Sequence[Ring]
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


def area_level(congestion_level: int, level_values: Sequence[float]) -> float:
    """도시데이터 혼잡 단계(1 여유 ~ 4 붐빔)를 단계별 설정값으로 바꾼다."""
    if not 1 <= congestion_level <= len(level_values):
        raise ValueError(f"혼잡 단계가 범위를 벗어났습니다: {congestion_level}")
    return level_values[congestion_level - 1]


def point_in_rings(position: LngLat, rings: Sequence[Ring]) -> bool:
    """짝홀 규칙. 모든 고리를 함께 세므로 구멍은 밖, 여러 조각은 각각 안이다."""
    x, y = position
    inside = False
    for ring in rings:
        for (x1, y1), (x2, y2) in pairwise([*ring, ring[0]] if ring else []):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def point_levels(
    points: Sequence[LinePoint],
    sensors: Sequence[Sensor],
    radius_m: float,
    areas: Sequence[Area] = (),
) -> list[float]:
    """점마다 radius_m 안 센서와 점을 품은 구역의 혼잡도 중 큰 값."""
    boxes = [_bounding_box(area.rings) for area in areas]
    levels = []
    for point in points:
        nearby = (
            sensor.level
            for sensor in sensors
            if distance_m(point.position, sensor.position) <= radius_m
        )
        covering = (
            area.level
            for area, box in zip(areas, boxes, strict=True)
            if _in_box(point.position, box)
            and point_in_rings(point.position, area.rings)
        )
        levels.append(max(chain(nearby, covering), default=0.0))
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


def _bounding_box(rings: Sequence[Ring]) -> tuple[float, float, float, float]:
    xs = [x for ring in rings for x, _ in ring]
    ys = [y for ring in rings for _, y in ring]
    if not xs:
        return (0.0, 0.0, -1.0, -1.0)
    return (min(xs), min(ys), max(xs), max(ys))


def _in_box(position: LngLat, box: tuple[float, float, float, float]) -> bool:
    """구역마다 짝홀 계산을 하기 전에 바깥 사각형으로 먼저 거른다."""
    x, y = position
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]
