import pytest

from app.services.route_candidates import fetch_routes
from app.services.tmap_client import TmapError
from tests.fakes import FakeTmap

START, END = (127.0, 37.5), (127.0, 37.502)


def route(name: str) -> dict:
    return {"type": "FeatureCollection", "name": name, "features": []}


@pytest.mark.anyio
async def test_fetch_routes_keeps_option_order() -> None:
    tmap = FakeTmap({0: route("추천"), 10: route("최단"), 30: route("계단 제외")})

    responses = await fetch_routes(tmap, START, END, [0, 10, 30], "출발", "도착")

    assert [r["name"] for r in responses] == ["추천", "최단", "계단 제외"]


@pytest.mark.anyio
async def test_fetch_routes_skips_failed_candidates() -> None:
    tmap = FakeTmap(
        {0: route("추천"), 10: TmapError(500, "실패"), 30: route("계단 제외")}
    )

    responses = await fetch_routes(tmap, START, END, [0, 10, 30], "출발", "도착")

    assert [r["name"] for r in responses] == ["추천", "계단 제외"]


@pytest.mark.anyio
async def test_fetch_routes_fails_without_recommended() -> None:
    tmap = FakeTmap({0: TmapError(400, "너무 가깝습니다"), 10: route("최단")})

    with pytest.raises(TmapError):
        await fetch_routes(tmap, START, END, [0, 10], "출발", "도착")
