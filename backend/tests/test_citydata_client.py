from datetime import datetime

import httpx
import pytest

from app.services.citydata_client import (
    CitydataError,
    congestion_level_number,
    fetch_area,
    population_rows,
)
from app.services.sdot_client import KST
from tests.citydata_samples import area_item, forecast, ok_body

KEY = "test-key"
BASE_URL = f"http://citydata.test/{KEY}/json"
COLLECTED = datetime(2026, 11, 16, 11, 20, tzinfo=KST)


def http_with(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=BASE_URL)


@pytest.mark.anyio
async def test_fetch_area_requests_one_place() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ok_body(area_item()))

    async with http_with(handler) as http:
        item = await fetch_area(http, "POI009")

    assert item["AREA_CD"] == "POI009"
    assert seen[0].url.path == f"/{KEY}/json/citydata_ppltn/1/5/POI009"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"RESULT": {"CODE": "INFO-100", "MESSAGE": "키"}}),
        httpx.Response(200, json={"RESULT": {"RESULT.CODE": "INFO-000"}}),
    ],
)
@pytest.mark.anyio
async def test_fetch_area_failures_hide_key(response: httpx.Response) -> None:
    async with http_with(lambda _: response) as http:
        with pytest.raises(CitydataError) as error:
            await fetch_area(http, "POI009")

    assert KEY not in str(error.value)


@pytest.mark.anyio
async def test_fetch_area_timeout_hides_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(f"timeout {request.url}")

    async with http_with(handler) as http:
        with pytest.raises(CitydataError) as error:
            await fetch_area(http, "POI009")

    assert KEY not in str(error.value)
    assert error.value.__cause__ is None


def test_population_rows_current_then_forecasts() -> None:
    rows = population_rows(area_item(), COLLECTED)

    observed = datetime(2026, 11, 16, 11, 10, tzinfo=KST)
    assert [(r["target_time"].hour, r["congestion_level"]) for r in rows] == [
        (11, 2),
        (12, 3),
        (13, 4),
    ]
    assert all(r["observed_at"] == observed for r in rows)
    assert [r["is_forecast"] for r in rows] == [False, True, True]
    assert rows[0]["population_min"] == 46000
    assert rows[1]["population_max"] == 46000
    assert rows[0]["collected_at"] == COLLECTED


def test_population_rows_skips_broken_forecast() -> None:
    item = area_item(
        forecasts=[forecast("깨진 시각", "보통"), forecast("2026-11-16 12:00", "모름")]
    )

    assert len(population_rows(item, COLLECTED)) == 1


def test_population_rows_without_forecast_flag() -> None:
    item = {**area_item(), "FCST_YN": "N"}

    assert len(population_rows(item, COLLECTED)) == 1


def test_population_rows_broken_current_value() -> None:
    with pytest.raises(CitydataError):
        population_rows(area_item(level="모름"), COLLECTED)


def test_congestion_level_number_ignores_spaces() -> None:
    assert congestion_level_number("약간 붐빔") == 3
    assert congestion_level_number("약간붐빔") == 3
    with pytest.raises(ValueError):
        congestion_level_number("혼잡")
