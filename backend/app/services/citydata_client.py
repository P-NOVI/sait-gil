"""서울 실시간 인구데이터(citydata_ppltn)를 장소 하나씩 받는다.

요청 주소는 {CITYDATA_BASE_URL}/{키}/json/citydata_ppltn/1/5/{장소 코드} 이다.
응답은 "SeoulRtd.citydata_ppltn" 아래 장소 하나의 현재값(PPLTN_TIME, AREA_CONGEST_LVL)과
시간별 예측(FCST_PPLTN, 보통 12시간치)이다.
키가 주소에 들어 있어서, 주소가 담긴 httpx 예외를 밖으로 넘기지 않는다.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any

import httpx

from app.config import Settings
from app.services.sdot_client import KST

SERVICE_NAME = "citydata_ppltn"
PAYLOAD_KEY = f"SeoulRtd.{SERVICE_NAME}"
OK_CODE = "INFO-000"
TIME_FORMAT = "%Y-%m-%d %H:%M"
# 혼잡 단계 글자 → 1~4. 띄어쓰기는 빼고 비교한다.
CONGESTION_LEVELS = {"여유": 1, "보통": 2, "약간붐빔": 3, "붐빔": 4}


class CitydataError(Exception):
    """도시데이터 호출이나 응답 해석이 실패했을 때. 메시지에 키가 들어가지 않는다."""


class CitydataTransientError(CitydataError):
    """연결 끊김·시간 초과·5xx 처럼 다시 시도하면 될 수 있는 실패."""


def citydata_http(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=f"{settings.citydata_base_url}/{settings.seoul_api_key}/json",
        timeout=settings.citydata_timeout_s,
        transport=transport,
    )


async def fetch_area(http: httpx.AsyncClient, area_code: str) -> dict[str, Any]:
    """장소 하나의 응답 항목(AREA_CD, PPLTN_TIME, FCST_PPLTN 등)."""
    try:
        response = await http.get(f"/{SERVICE_NAME}/1/5/{area_code}")
        response.raise_for_status()
        body = response.json()
        # 결과 코드는 "RESULT.CODE" 로 오고, 인증 오류 같은 실패는 "CODE" 로 올 수 있다.
        result = body["RESULT"]
        code = result.get("RESULT.CODE", result.get("CODE"))
        items = body.get(PAYLOAD_KEY, [])
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        message = f"도시데이터 응답 실패: HTTP {status}"
        if status >= 500:
            raise CitydataTransientError(message) from None
        raise CitydataError(message) from None
    except httpx.TransportError as error:
        reason = type(error).__name__
        raise CitydataTransientError(f"도시데이터 응답 실패: {reason}") from None
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise CitydataError(f"도시데이터 응답 실패: {type(error).__name__}") from None
    if code != OK_CODE:
        raise CitydataError(f"도시데이터 오류 코드 {code}")
    if not items:
        raise CitydataError("도시데이터 응답에 장소가 없습니다.")
    return items[0]


def population_rows(
    item: Mapping[str, Any], collected_at: datetime
) -> list[dict[str, Any]]:
    """응답 항목 하나를 citydata_population 행으로. 현재값이 먼저, 예측이 다음이다.

    현재값이 깨졌으면 CitydataError, 깨진 예측 행은 뺀다.
    """
    try:
        area_code = str(item["AREA_CD"])
        observed_at = _parse_time(item["PPLTN_TIME"])
        current = _row(
            area_code,
            observed_at,
            observed_at,
            item["AREA_CONGEST_LVL"],
            item.get("AREA_PPLTN_MIN"),
            item.get("AREA_PPLTN_MAX"),
            collected_at,
        )
    except (KeyError, ValueError, TypeError) as error:
        reason = type(error).__name__
        raise CitydataError(f"도시데이터 현재값 해석 실패: {reason}") from None
    rows = [current]
    forecasts = item.get("FCST_PPLTN") if item.get("FCST_YN") == "Y" else None
    for forecast in forecasts or []:
        try:
            rows.append(
                _row(
                    area_code,
                    observed_at,
                    _parse_time(forecast["FCST_TIME"]),
                    forecast["FCST_CONGEST_LVL"],
                    forecast.get("FCST_PPLTN_MIN"),
                    forecast.get("FCST_PPLTN_MAX"),
                    collected_at,
                )
            )
        except (KeyError, ValueError, TypeError):
            continue
    return rows


def congestion_level_number(label: str) -> int:
    """혼잡 단계 글자(여유~붐빔)를 1~4 로. 모르는 글자면 ValueError."""
    level = CONGESTION_LEVELS.get(label.replace(" ", ""))
    if level is None:
        raise ValueError(f"모르는 혼잡 단계: {label}")
    return level


def _row(
    area_code: str,
    observed_at: datetime,
    target_time: datetime,
    level_label: str,
    population_min: Any,
    population_max: Any,
    collected_at: datetime,
) -> dict[str, Any]:
    return {
        "area_code": area_code,
        "observed_at": observed_at,
        "target_time": target_time,
        "is_forecast": target_time != observed_at,
        "congestion_level": congestion_level_number(level_label),
        "population_min": _optional_int(population_min),
        "population_max": _optional_int(population_max),
        "collected_at": collected_at,
    }


def _parse_time(text: str) -> datetime:
    return datetime.strptime(text, TIME_FORMAT).replace(tzinfo=KST)


def _optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    return int(float(value))
