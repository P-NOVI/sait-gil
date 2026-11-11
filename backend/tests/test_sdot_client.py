from datetime import datetime, timedelta

import httpx
import pytest

from app.services.sdot_client import KST, SdotError, fetch_people_rows, latest_counts

KEY = "test-key"
BASE_URL = f"http://sdot.test/{KEY}/json"
NOW = datetime(2026, 11, 11, 15, 30, tzinfo=KST)


def row(serial: str, count: str, sensing_time: str) -> dict[str, str]:
    return {"SERIAL": serial, "VISITOR_COUNT": count, "SENSING_TIME": sensing_time}


def http_with(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=BASE_URL)


def ok_body(*rows: dict) -> dict:
    return {"sDoTPeople": {"RESULT": {"CODE": "INFO-000"}, "row": list(rows)}}


@pytest.mark.anyio
async def test_fetch_people_rows_requests_latest_rows() -> None:
    seen: list[httpx.Request] = []
    rows = [row("2992", "120", "2026-11-11_15:10:00")]

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=ok_body(*rows))

    async with http_with(handler) as http:
        assert await fetch_people_rows(http, 1000) == rows

    assert seen[0].url.path == f"/{KEY}/json/sDoTPeople/1/1000/"


@pytest.mark.anyio
async def test_fetch_people_rows_no_data_is_empty() -> None:
    body = {"sDoTPeople": {"RESULT": {"CODE": "INFO-200"}}}

    async with http_with(lambda _: httpx.Response(200, json=body)) as http:
        assert await fetch_people_rows(http, 10) == []


@pytest.mark.anyio
async def test_fetch_people_rows_error_code() -> None:
    # 인증 오류는 서비스 이름 없이 RESULT 만 온다.
    body = {"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 유효하지 않습니다."}}

    async with http_with(lambda _: httpx.Response(200, json=body)) as http:
        with pytest.raises(SdotError, match="INFO-100"):
            await fetch_people_rows(http, 10)


@pytest.mark.parametrize(
    "response",
    [httpx.Response(500), httpx.Response(200, text="<html>점검 중</html>")],
)
@pytest.mark.anyio
async def test_fetch_people_rows_bad_response(response: httpx.Response) -> None:
    async with http_with(lambda _: response) as http:
        with pytest.raises(SdotError):
            await fetch_people_rows(http, 10)


@pytest.mark.anyio
async def test_fetch_people_rows_hides_url_with_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("연결 실패", request=request)

    async with http_with(handler) as http:
        with pytest.raises(SdotError) as caught:
            await fetch_people_rows(http, 10)

    assert KEY not in str(caught.value)
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__


def test_latest_counts_keeps_latest_fresh_reading() -> None:
    rows = [
        row("1", "100", "2026-11-11_15:20:00"),
        row("1", "80", "2026-11-11_15:10:00"),
        row("2", "50", "2026-11-11_14:00:00"),
        row("3", "", "2026-11-11_15:20:00"),
        row("4", "70", "2026/11/11 15:20"),
        {"SERIAL": "5"},
        row("0006", "30", "2026-11-11_14:40:00"),
    ]

    counts = latest_counts(rows, NOW, timedelta(minutes=60))

    assert counts == {1: 100, 6: 30}
