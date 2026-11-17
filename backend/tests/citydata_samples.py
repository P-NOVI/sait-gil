"""서울 실시간 인구데이터(citydata_ppltn) 응답 예시.

2026-11-16 광화문·덕수궁 응답을 줄였다.
"""

from typing import Any


def forecast(time: str, level: str) -> dict[str, str]:
    return {
        "FCST_TIME": time,
        "FCST_CONGEST_LVL": level,
        "FCST_PPLTN_MIN": "44000",
        "FCST_PPLTN_MAX": "46000",
    }


def area_item(
    code: str = "POI009",
    observed: str = "2026-11-16 11:10",
    level: str = "보통",
    forecasts: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "AREA_NM": "광화문·덕수궁",
        "AREA_CD": code,
        "AREA_CONGEST_LVL": level,
        "AREA_CONGEST_MSG": "사람이 몰려있을 수 있지만 크게 붐비지는 않아요.",
        "AREA_PPLTN_MIN": "46000",
        "AREA_PPLTN_MAX": "48000",
        "PPLTN_TIME": observed,
        "FCST_YN": "Y",
        "FCST_PPLTN": (
            forecasts
            if forecasts is not None
            else [
                forecast("2026-11-16 12:00", "약간 붐빔"),
                forecast("2026-11-16 13:00", "붐빔"),
            ]
        ),
    }


def ok_body(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "SeoulRtd.citydata_ppltn": [item],
        "RESULT": {"RESULT.CODE": "INFO-000", "RESULT.MESSAGE": "정상 처리되었습니다."},
    }
