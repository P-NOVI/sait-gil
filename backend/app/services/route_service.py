"""Tmap 경로 응답들로 띄울 세 경로(추천, 덜 붐비는 길, 완만한 길)를 만든다.

Tmap 호출은 여기서 하지 않는다. 받은 응답(추천 경로가 먼저, 후보가 다음)과
시간대별 센서·구역 혼잡도(Timeline)로 경로마다 혼잡·경사 점수를 매기고,
고른 경로의 미리 알림 이벤트를 만든다. 경로 위 점은 그 점에 닿는 시간대의 혼잡도를 쓴다.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from typing import Any

from app.config import Settings
from app.services.elevation_service import sample_elevations
from core.congestion import (
    CongestionSummary,
    Timeline,
    congestion_summary,
    timed_point_levels,
)
from core.geo import LinePoint, LngLat, distance_m, line_key, sample_line
from core.route_choice import RouteKind, ScoredRoute, choose_routes
from core.route_events import RouteEvent, route_events
from core.slope import SlopeSummary, slope_summary
from core.tmap_route import (
    ANNOUNCING_TURN_TYPES,
    SAME_PLACE_M,
    UNVERIFIED_FACILITY_TYPES,
    TmapRoute,
    parse_route,
)

ElevationReader = Callable[[Sequence[LngLat]], list[float | None]]


@dataclass(frozen=True)
class PlannedRoute:
    kinds: tuple[RouteKind, ...]
    route: TmapRoute
    congestion_score: float
    slope: SlopeSummary
    events: list[RouteEvent]


@dataclass(frozen=True)
class _Measured:
    route: TmapRoute
    congestion: CongestionSummary
    slope: SlopeSummary


def plan_routes(
    responses: Sequence[Mapping[str, Any]],
    timeline: Timeline,
    settings: Settings,
    read_elevations: ElevationReader | None = None,
) -> list[PlannedRoute]:
    """responses[0] 은 기본 옵션으로 받은 추천 경로다. 같은 경로는 한 번만 센다."""
    if read_elevations is None:
        read_elevations = partial(sample_elevations, settings.dem_path)
    routes = _unique_routes(responses)
    samples = [
        sample_line(route.line, settings.route_sample_interval_m) for route in routes
    ]
    elevations = _read_all(samples, read_elevations)
    measured = [
        _measure(route, points, heights, timeline, settings)
        for route, points, heights in zip(routes, samples, elevations, strict=True)
    ]
    # 안내 없이 시작하는 시설물 구간(14 등)이 있는데 추천 경로에는 같은 곳이 없으면,
    # 그 후보는 덜 붐비는 길·완만한 길에서 뺀다.
    recommended_starts = _unannounced_starts(measured[0].route) if measured else []
    options = choose_routes(
        [
            ScoredRoute(
                m.route.length_m,
                m.congestion.score,
                m.slope.score,
                eligible=all(
                    _near_any(start, recommended_starts)
                    for start in _unannounced_starts(m.route)
                ),
            )
            for m in measured
        ],
        settings.route_congestion_margin_m,
        settings.route_slope_margin_m,
    )
    return [
        PlannedRoute(
            kinds=option.kinds,
            route=measured[option.index].route,
            congestion_score=measured[option.index].congestion.score,
            slope=measured[option.index].slope,
            events=route_events(
                measured[option.index].route.guide_points,
                measured[option.index].congestion.crowded_starts,
            ),
        )
        for option in options
    ]


def walk_end(
    responses: Sequence[Mapping[str, Any]], departed_at: datetime, speed_mps: float
) -> datetime:
    """가장 긴 경로를 speed_mps 로 다 걸었을 때의 시각."""
    longest = max((route.length_m for route in _unique_routes(responses)), default=0)
    return departed_at + timedelta(seconds=longest / speed_mps)


def _unannounced_starts(route: TmapRoute) -> list[LngLat]:
    return route.unannounced_facility_starts(
        UNVERIFIED_FACILITY_TYPES, ANNOUNCING_TURN_TYPES
    )


def _near_any(position: LngLat, others: Sequence[LngLat]) -> bool:
    return any(distance_m(position, other) <= SAME_PLACE_M for other in others)


def _unique_routes(responses: Sequence[Mapping[str, Any]]) -> list[TmapRoute]:
    routes: list[TmapRoute] = []
    seen: set[tuple[LngLat, ...]] = set()
    for response in responses:
        route = parse_route(response)
        key = line_key(route.line)
        if len(route.line) < 2 or key in seen:
            continue
        seen.add(key)
        routes.append(route)
    return routes


def _read_all(
    samples: Sequence[Sequence[LinePoint]], read_elevations: ElevationReader
) -> list[list[float | None]]:
    """DEM 파일을 한 번만 열도록 모든 경로의 점을 모아 읽고 경로별로 나눈다."""
    heights = read_elevations(
        [point.position for points in samples for point in points]
    )
    split: list[list[float | None]] = []
    start = 0
    for points in samples:
        split.append(heights[start : start + len(points)])
        start += len(points)
    return split


def _measure(
    route: TmapRoute,
    points: Sequence[LinePoint],
    heights: Sequence[float | None],
    timeline: Timeline,
    settings: Settings,
) -> _Measured:
    levels = timed_point_levels(points, timeline, settings.congestion_radius_m)
    return _Measured(
        route=route,
        congestion=congestion_summary(points, levels, settings.crowded_level),
        slope=slope_summary(
            points,
            heights,
            skip=route.on_structure,
            moderate_weight=settings.slope_moderate_weight,
            hard_weight=settings.slope_hard_weight,
        ),
    )
