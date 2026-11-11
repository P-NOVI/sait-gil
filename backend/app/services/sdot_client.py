"""서울 열린데이터광장 S-DoT 실시간 유동인구(sDoTPeople)를 받는다.

요청 주소는 {SDOT_BASE_URL}/{키}/json/sDoTPeople/{시작}/{끝}/ 이고 최신 행부터 온다.
키가 주소에 들어 있어서, 주소가 담긴 httpx 예외를 밖으로 넘기지 않는다.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings

SERVICE_NAME = "sDoTPeople"
OK_CODE = "INFO-000"
# 조건에 맞는 데이터가 없을 때 오는 코드. 오류가 아니라 빈 결과로 다룬다.
NO_DATA_CODE = "INFO-200"
SENSING_TIME_FORMAT = "%Y-%m-%d_%H:%M:%S"
KST = timezone(timedelta(hours=9))


class SdotError(Exception):
    """S-DoT 호출이나 응답 해석이 실패했을 때. 메시지에 키가 들어가지 않는다."""


def sdot_http(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=f"{settings.sdot_base_url}/{settings.seoul_api_key}/json",
        timeout=settings.sdot_timeout_s,
        transport=transport,
    )


async def fetch_people_rows(
    http: httpx.AsyncClient, count: int
) -> list[dict[str, Any]]:
    """최신 count 행."""
    try:
        response = await http.get(f"/{SERVICE_NAME}/1/{count}/")
        response.raise_for_status()
        body = response.json()
        # 성공하면 서비스 이름 아래에, 인증 오류 같은 실패는 바로 RESULT 로 온다.
        payload = body.get(SERVICE_NAME, body)
        code = payload["RESULT"]["CODE"]
        rows = payload.get("row", [])
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise SdotError(f"S-DoT 응답 실패: {type(error).__name__}") from None
    if code == NO_DATA_CODE:
        return []
    if code != OK_CODE:
        raise SdotError(f"S-DoT 오류 코드 {code}")
    return rows


def latest_counts(
    rows: Sequence[Mapping[str, Any]], now: datetime, max_age: timedelta
) -> dict[int, int]:
    """센서 코드별로 가장 늦게 잰 10분 유동인구.

    센서 코드는 SERIAL 을 정수로 바꾼 값이다(sdot_sensors.json 의 code 와 같다).
    now - max_age 보다 먼저 잰 값과 값이 깨진 행은 뺀다.
    """
    oldest = now - max_age
    latest: dict[int, tuple[datetime, int]] = {}
    for row in rows:
        try:
            code = int(row["SERIAL"])
            count = int(row["VISITOR_COUNT"])
            measured_at = datetime.strptime(
                row["SENSING_TIME"], SENSING_TIME_FORMAT
            ).replace(tzinfo=KST)
        except (KeyError, ValueError, TypeError):
            continue
        if measured_at < oldest:
            continue
        known = latest.get(code)
        if known is None or measured_at > known[0]:
            latest[code] = (measured_at, count)
    return {code: count for code, (_, count) in latest.items()}
