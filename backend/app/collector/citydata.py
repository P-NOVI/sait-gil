"""도시데이터 주요 장소의 현재값·시간별 예측을 받아 수집 DB에 넣는다."""

import asyncio
from collections.abc import Sequence
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.collector.models import CitydataPopulation
from app.collector.store import insert_new
from app.config import Settings
from app.services.citydata_client import (
    CitydataError,
    citydata_http,
    fetch_area,
    population_rows,
)


async def fetch_population_rows(
    settings: Settings,
    area_codes: Sequence[str],
    collected_at: datetime,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """장소마다 받은 행과 실패한 장소 코드. 한 곳이 실패해도 나머지는 받는다."""
    limit = asyncio.Semaphore(settings.citydata_concurrency)

    async def one(http: httpx.AsyncClient, code: str) -> list[dict[str, Any]] | None:
        async with limit:
            # 일시적인 응답 실패는 몇 번 더 시도해 본다.
            for _ in range(settings.citydata_retries + 1):
                try:
                    return population_rows(await fetch_area(http, code), collected_at)
                except CitydataError:
                    continue
            return None

    async with citydata_http(settings, transport) as http:
        results = await asyncio.gather(*(one(http, code) for code in area_codes))
    rows = [row for result in results if result for row in result]
    failed = [
        code for code, result in zip(area_codes, results, strict=True) if not result
    ]
    return rows, failed


def store_population(session: Session, rows: list[dict[str, Any]]) -> int:
    """새로 넣은 행 수. 같은 장소·관측 시각·대상 시각은 건너뛴다."""
    return insert_new(session, CitydataPopulation, rows)
