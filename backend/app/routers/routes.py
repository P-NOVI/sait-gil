from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.dependencies import SensorsDep, SettingsDep, TmapClientDep
from app.services.route_candidates import fetch_routes
from app.services.route_service import PlannedRoute, plan_routes
from app.services.tmap_client import TmapError
from core.route_choice import RouteKind
from core.route_events import Direction, EventKind

router = APIRouter(prefix="/api/routes", tags=["routes"])

# 응답 거리 소수 자릿수 (0.1m)
DISTANCE_DIGITS = 1


class Point(BaseModel):
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)


class RouteRequest(BaseModel):
    start: Point
    end: Point
    start_name: str = Field("출발지", min_length=1)
    end_name: str = Field("도착지", min_length=1)


class RouteEventOut(BaseModel):
    kind: EventKind
    distance_m: float
    position: tuple[float, float]
    direction: Direction | None


class SlopeOut(BaseModel):
    moderate_m: float
    hard_m: float
    score: float


class RouteOut(BaseModel):
    """kinds 는 이 경로가 뽑힌 기준. 한 경로가 여러 기준에 뽑히면 함께 적는다."""

    kinds: list[RouteKind]
    coordinates: list[tuple[float, float]]
    distances_m: list[float]
    distance_m: float
    time_s: int | None
    congestion_score: float
    slope: SlopeOut
    events: list[RouteEventOut]


class RoutesResponse(BaseModel):
    """추천 경로, 덜 붐비는 길, 완만한 길 순서. 같은 경로는 한 번만 들어 있다."""

    routes: list[RouteOut]


@router.post("")
async def find_routes(
    request: RouteRequest,
    client: TmapClientDep,
    sensors: SensorsDep,
    settings: SettingsDep,
) -> RoutesResponse:
    start = (request.start.lng, request.start.lat)
    end = (request.end.lng, request.end.lat)
    try:
        responses = await fetch_routes(
            client,
            start,
            end,
            settings.tmap_search_options,
            request.start_name,
            request.end_name,
        )
    except TmapError as error:
        raise _http_error(error) from error
    planned = await run_in_threadpool(plan_routes, responses, sensors, settings)
    if not planned:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "경로를 찾지 못했습니다.")
    return RoutesResponse(routes=[_route_out(route) for route in planned])


def _http_error(error: TmapError) -> HTTPException:
    """출발·도착 값 문제(4xx)는 400 으로, Tmap 쪽 문제는 502 로 알린다."""
    if 400 <= error.status_code < 500 and error.status_code not in (401, 403, 429):
        return HTTPException(status.HTTP_400_BAD_REQUEST, error.message)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, error.message)


def _route_out(planned: PlannedRoute) -> RouteOut:
    route = planned.route
    return RouteOut(
        kinds=list(planned.kinds),
        coordinates=route.line,
        distances_m=[round(d, DISTANCE_DIGITS) for d in route.distances_m],
        distance_m=round(route.length_m, DISTANCE_DIGITS),
        time_s=route.total_time_s,
        congestion_score=round(planned.congestion_score, DISTANCE_DIGITS),
        slope=SlopeOut(
            moderate_m=round(planned.slope.moderate_m, DISTANCE_DIGITS),
            hard_m=round(planned.slope.hard_m, DISTANCE_DIGITS),
            score=round(planned.slope.score, DISTANCE_DIGITS),
        ),
        events=[
            RouteEventOut(
                kind=event.kind,
                distance_m=round(event.distance_m, DISTANCE_DIGITS),
                position=event.position,
                direction=event.direction,
            )
            for event in planned.events
        ],
    )
