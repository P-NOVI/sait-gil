from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.dependencies import get_tmap_client
from app.main import app
from app.services.tmap_client import TmapError
from tests.fakes import FakeTmap
from tests.helpers import tmap_response

START, MID, END = (127.0, 37.5), (127.0, 37.501), (127.0, 37.502)
STRAIGHT = tmap_response([START, MID, END], [200, 13, 201], total_time_s=150)
DETOUR = tmap_response(
    [START, (127.001, 37.5), (127.001, 37.502), END], [200, 12, 12, 201]
)
ROUTE_BODY = {
    "start": {"lng": 127.0, "lat": 37.5},
    "end": {"lng": 127.0, "lat": 37.502},
}


@pytest.fixture
def tmap() -> FakeTmap:
    return FakeTmap()


@pytest.fixture
def client(tmap: FakeTmap, tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        _env_file=None,
        tmap_app_key="test",
        tmap_search_options=[0, 10],
        dem_path=tmp_path / "missing.tif",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_tmap_client] = lambda: tmap
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_routes_returns_recommended_first(client: TestClient, tmap: FakeTmap) -> None:
    tmap.routes = {0: STRAIGHT, 10: DETOUR}

    response = client.post("/api/routes", json=ROUTE_BODY)

    assert response.status_code == 200
    routes = response.json()["routes"]
    # 센서·DEM 이 없으면 점수가 모두 0 이라 추천 경로가 세 기준을 모두 맡는다.
    assert [r["kinds"] for r in routes] == [["recommended", "less_crowded", "gentle"]]
    route = routes[0]
    assert route["coordinates"][0] == [127.0, 37.5]
    assert route["distances_m"][0] == 0
    assert route["distance_m"] == pytest.approx(222.4, abs=0.1)
    assert route["time_s"] == 150
    assert route["events"][0]["kind"] == "turn"
    assert route["events"][0]["direction"] == "right"
    assert tmap.route_options == [0, 10]


def test_routes_bad_request_from_tmap(client: TestClient, tmap: FakeTmap) -> None:
    tmap.routes = {0: TmapError(400, "출발지와 도착지가 같습니다."), 10: DETOUR}

    response = client.post("/api/routes", json=ROUTE_BODY)

    assert response.status_code == 400
    assert response.json()["detail"] == "출발지와 도착지가 같습니다."


def test_routes_tmap_down(client: TestClient, tmap: FakeTmap) -> None:
    tmap.routes = {0: TmapError(502, "Tmap 연결 실패"), 10: DETOUR}

    assert client.post("/api/routes", json=ROUTE_BODY).status_code == 502


def test_routes_validates_coordinates(client: TestClient) -> None:
    body = {**ROUTE_BODY, "end": {"lng": 200, "lat": 37.5}}

    assert client.post("/api/routes", json=body).status_code == 422


def test_routes_without_key_is_unavailable() -> None:
    settings = Settings(_env_file=None, tmap_app_key="")
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        response = TestClient(app).post("/api/routes", json=ROUTE_BODY)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503


def test_places_search(client: TestClient, tmap: FakeTmap) -> None:
    tmap.pois = {
        "searchPoiInfo": {
            "pois": {
                "poi": [
                    {
                        "name": "서울역",
                        "pnsLon": "126.9706",
                        "pnsLat": "37.5547",
                        "upperAddrName": "서울",
                        "middleAddrName": "중구",
                        "lowerAddrName": "봉래동2가",
                        "radius": "0.5",
                    }
                ]
            }
        }
    }

    with_center = client.get(
        "/api/places", params={"query": "서울역", "lng": 127, "lat": 37.5}
    )
    without_center = client.get("/api/places", params={"query": "서울역"})

    assert with_center.json()["places"] == [
        {
            "name": "서울역",
            "address": "서울 중구 봉래동2가",
            "position": [126.9706, 37.5547],
            "distance_m": 500.0,
        }
    ]
    assert without_center.json()["places"][0]["distance_m"] is None


def test_places_requires_query(client: TestClient) -> None:
    assert client.get("/api/places").status_code == 422


def test_address(client: TestClient, tmap: FakeTmap) -> None:
    tmap.address = {"addressInfo": {"fullAddress": "서울 중구 을지로 65"}}

    response = client.get("/api/places/address", params={"lng": 126.98, "lat": 37.566})

    assert response.json() == {
        "full_address": "서울 중구 을지로 65",
        "road_address": "서울 중구 을지로 65",
        "road_name": "",
        "building_name": "",
    }


def test_address_not_found(client: TestClient) -> None:
    response = client.get("/api/places/address", params={"lng": 126.98, "lat": 37.566})

    assert response.status_code == 404
