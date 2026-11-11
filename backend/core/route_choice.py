"""추천 경로와 후보 경로에서 띄울 세 경로(추천, 덜 붐비는 길, 완만한 길)를 고른다."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum


class RouteKind(StrEnum):
    RECOMMENDED = "recommended"
    LESS_CROWDED = "less_crowded"
    GENTLE = "gentle"


@dataclass(frozen=True)
class ScoredRoute:
    distance_m: float
    congestion_score: float
    slope_score: float


@dataclass(frozen=True)
class RouteOption:
    # choose_routes 에 넘긴 routes 안 위치
    index: int
    kinds: tuple[RouteKind, ...]


def choose_routes(
    routes: Sequence[ScoredRoute], congestion_margin: float, slope_margin: float
) -> list[RouteOption]:
    """routes[0] 은 추천 경로, 나머지는 후보다.

    추천, 덜 붐비는 길, 완만한 길 순으로 돌려준다.

    - 후보가 추천 경로보다 margin 넘게 낫지 않으면 추천 경로를 그 기준의 경로로 본다.
    - 한 경로가 여러 기준에 뽑히면 한 번만 넣고 kinds 를 합친다.
    """
    if not routes:
        return []
    picks = [
        (0, RouteKind.RECOMMENDED),
        (
            _best(routes, lambda route: route.congestion_score, congestion_margin),
            RouteKind.LESS_CROWDED,
        ),
        (
            _best(routes, lambda route: route.slope_score, slope_margin),
            RouteKind.GENTLE,
        ),
    ]
    kinds_by_index: dict[int, list[RouteKind]] = {}
    for index, kind in picks:
        kinds_by_index.setdefault(index, []).append(kind)
    return [RouteOption(index, tuple(kinds)) for index, kinds in kinds_by_index.items()]


def _best(
    routes: Sequence[ScoredRoute], score: Callable[[ScoredRoute], float], margin: float
) -> int:
    """점수가 가장 낮은 후보. 점수가 같으면 짧은 경로를 고른다."""
    best = min(
        range(1, len(routes)),
        key=lambda index: (score(routes[index]), routes[index].distance_m),
        default=0,
    )
    if score(routes[0]) - score(routes[best]) <= margin:
        return 0
    return best
