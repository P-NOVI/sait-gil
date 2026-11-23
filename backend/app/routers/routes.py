from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.dependencies import SettingsDep, TimelineReaderDep, TmapClientDep
from app.routers.tmap_errors import tmap_http_error
from app.services.route_candidates import fetch_routes
from app.services.route_service import PlannedRoute, plan_routes, walk_end
from app.services.sdot_client import KST
from app.services.tmap_client import TmapError
from core.route_choice import RouteKind
from core.route_events import Direction, EventKind

router = APIRouter(prefix="/api/routes", tags=["routes"])

# 응답 거리 소수 자릿수 (0.1m)
DISTANCE_DIGITS = 1

# Tmap 이 출발·도착 값을 받지 않았을 때(4xx) 사용자에게 보일 문장
BAD_POINTS = "이 출발지와 도착지로는 경로를 찾지 못했습니다."


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
    time_s: int
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
    read_timeline: TimelineReaderDep,
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
        raise tmap_http_error(error, BAD_POINTS) from error
    # 경로 위 점마다 지금 출발해 그 점에 닿는 시간대의 혼잡도를 쓴다.
    now = datetime.now(KST)
    timeline = await read_timeline(
        now, walk_end(responses, now, settings.walking_speed_mps)
    )
    planned = await run_in_threadpool(plan_routes, responses, timeline, settings)
    if not planned:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "경로를 찾지 못했습니다.")
    return RoutesResponse(
        routes=[_route_out(route, settings.walking_speed_mps) for route in planned]
    )


def _route_out(planned: PlannedRoute, walking_speed_mps: float) -> RouteOut:
    route = planned.route
    return RouteOut(
        kinds=list(planned.kinds),
        coordinates=route.line,
        distances_m=[round(d, DISTANCE_DIGITS) for d in route.distances_m],
        distance_m=round(route.length_m, DISTANCE_DIGITS),
        # Tmap totalTime 은 어떤 걸음 속도로 잰 값인지 몰라 쓰지 않는다.
        time_s=round(route.length_m / walking_speed_mps),
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
