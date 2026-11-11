from urllib.parse import parse_qs

import httpx
import pytest

from app.services.tmap_client import TmapClient, TmapError

BASE_URL = "https://tmap.test/tmap"


def client_with(handler) -> TmapClient:
    transport = httpx.MockTransport(handler)
    return TmapClient(
        httpx.AsyncClient(
            transport=transport, base_url=BASE_URL, headers={"appKey": "test-key"}
        )
    )


@pytest.mark.anyio
async def test_pedestrian_route_sends_form_with_key_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"type": "FeatureCollection", "features": []})

    client = client_with(handler)
    result = await client.pedestrian_route(
        (127.0, 37.5),
        (127.01, 37.51),
        10,
        "출발",
        "도착",
        pass_points=[(127.005, 37.505), (127.006, 37.506)],
    )

    request = seen[0]
    form = {
        key: values[0] for key, values in parse_qs(request.content.decode()).items()
    }
    assert result == {"type": "FeatureCollection", "features": []}
    assert request.method == "POST"
    assert request.url.path == "/tmap/routes/pedestrian"
    assert request.url.params["version"] == "1"
    assert request.headers["appKey"] == "test-key"
    assert "appKey" not in request.url.params
    assert form["startX"] == "127.0"
    assert form["endY"] == "37.51"
    assert form["searchOption"] == "10"
    assert form["startName"] == "출발"
    assert form["passList"] == "127.005,37.505_127.006,37.506"
    assert form["resCoordType"] == "WGS84GEO"


@pytest.mark.anyio
async def test_pedestrian_route_rejects_too_many_pass_points() -> None:
    client = client_with(lambda request: httpx.Response(200, json={}))

    with pytest.raises(ValueError):
        await client.pedestrian_route(
            (127.0, 37.5), (127.01, 37.51), 0, "출발", "도착", [(127.0, 37.5)] * 6
        )


@pytest.mark.anyio
async def test_error_response_becomes_tmap_error() -> None:
    body = {
        "error": {"id": "400", "code": "3102", "message": "출발지와 도착지가 같습니다."}
    }
    client = client_with(lambda request: httpx.Response(400, json=body))

    with pytest.raises(TmapError) as raised:
        await client.pedestrian_route((127.0, 37.5), (127.0, 37.5), 0, "출발", "도착")

    assert raised.value.status_code == 400
    assert raised.value.message == "출발지와 도착지가 같습니다."


@pytest.mark.anyio
async def test_error_without_json_body() -> None:
    client = client_with(lambda request: httpx.Response(500, text="oops"))

    with pytest.raises(TmapError) as raised:
        await client.reverse_geocode((127.0, 37.5))

    assert raised.value.message == "Tmap 오류 500"


@pytest.mark.anyio
async def test_connection_error_becomes_502() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=request)

    with pytest.raises(TmapError) as raised:
        await client_with(handler).search_pois("광화문", None, 10)

    assert raised.value.status_code == 502


@pytest.mark.anyio
async def test_search_pois_empty_result() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204)

    result = await client_with(handler).search_pois("없는곳", (127.0, 37.5), 5)

    params = seen[0].url.params
    assert result == {}
    assert params["searchKeyword"] == "없는곳"
    assert params["centerLon"] == "127.0"
    assert params["count"] == "5"


@pytest.mark.anyio
async def test_reverse_geocode_params() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"addressInfo": {"fullAddress": "서울"}})

    result = await client_with(handler).reverse_geocode((126.97, 37.56))

    params = seen[0].url.params
    assert result == {"addressInfo": {"fullAddress": "서울"}}
    assert seen[0].url.path == "/tmap/geo/reversegeocoding"
    assert (params["lon"], params["lat"]) == ("126.97", "37.56")
    assert params["addressType"] == "A10"
