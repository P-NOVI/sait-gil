"""기상청 API허브 동네예보(초단기실황·단기예보) 호출.

배리어프리 app/services/weather_service.py 에서 수집에 쓰는 부분만 가져왔다.
키가 요청 주소의 쿼리에 들어가므로, 주소가 담긴 httpx 예외를 밖으로 넘기지 않는다.
"""

import re
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.cache import KeyedTtlCache
from app.config import Settings

OK_CODE = "00"
# 조건에 맞는 자료가 없을 때 오는 코드. 오류가 아니라 빈 결과로 다룬다.
NO_DATA_CODE = "03"

OBSERVATION_PATH = "/getUltraSrtNcst"
SHORT_FORECAST_PATH = "/getVilageFcst"

# 기상청이 자료를 내는 규칙. 기준 시각에서 이만큼 지나야 받을 수 있다.
OBSERVATION_DELAY = timedelta(minutes=10)
SHORT_FORECAST_DELAY = timedelta(minutes=10)

NO_RAIN_TEXTS = {"", "0", "-", "강수없음"}
# '1mm 미만'은 값을 알 수 없어 중간쯤으로 둔다.
RAIN_BELOW_ONE_MM = 0.5

# 강수형태 코드: 실황·초단기예보 0~3,5~7 / 단기예보 0~4
PRECIPITATION_CODES: dict[str, str] = {
    "0": "none",
    "1": "rain",
    "2": "sleet",
    "3": "snow",
    "4": "shower",
    "5": "rain",
    "6": "sleet",
    "7": "snow",
}


class WeatherError(Exception):
    """기상청 API 호출이나 응답 해석이 실패했을 때. 메시지에 키가 들어가지 않는다."""


ItemCache = KeyedTtlCache[tuple, list[dict[str, Any]]]


def kma_http(
    settings: Settings, transport: httpx.BaseTransport | None = None
) -> httpx.Client:
    return httpx.Client(
        base_url=settings.kma_base_url,
        params={"authKey": settings.kma_api_key},
        timeout=settings.kma_timeout_s,
        transport=transport,
    )


def floor_hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def observation_base(now: datetime) -> datetime:
    """받을 수 있는 가장 최근 실황 정시."""
    return floor_hour(now - OBSERVATION_DELAY)


def parse_rain_mm(text: str) -> float:
    """강수량 문구를 mm 로. 예: '강수없음', '1mm 미만', '2.0mm', '30.0~50.0mm'."""
    text = text.strip()
    if text in NO_RAIN_TEXTS:
        return 0.0
    if "미만" in text:
        return RAIN_BELOW_ONE_MM
    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)][:2]
    if not numbers:
        raise ValueError(text)
    # 범위는 가운데 값, '이상'은 그 값을 쓴다.
    return sum(numbers) / len(numbers)


def request_items(
    client: httpx.Client,
    path: str,
    base: datetime,
    grid: tuple[int, int],
    page_size: int,
    cache: ItemCache,
) -> list[dict[str, Any]]:
    """한 기준 시각·격자의 전체 행. 캐시가 살아 있으면 API를 부르지 않는다."""
    key = (path, grid, base)
    cached = cache.get(key)
    if cached is not None:
        return cached
    items: list[dict[str, Any]] = []
    page = 1
    try:
        while True:
            response = client.get(
                path,
                params={
                    "pageNo": page,
                    "numOfRows": page_size,
                    "dataType": "JSON",
                    "base_date": base.strftime("%Y%m%d"),
                    "base_time": base.strftime("%H%M"),
                    "nx": grid[0],
                    "ny": grid[1],
                },
            )
            response.raise_for_status()
            body = response.json()["response"]
            code = body["header"]["resultCode"]
            if code == NO_DATA_CODE:
                break
            if code != OK_CODE:
                raise WeatherError(f"기상청 오류 코드 {code}")
            page_items = body["body"]["items"]["item"]
            items += page_items
            if not page_items or len(items) >= int(body["body"]["totalCount"]):
                break
            page += 1
    except WeatherError:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise WeatherError(f"기상청 응답 실패: {type(error).__name__}") from None
    cache.set(key, items)
    return items
