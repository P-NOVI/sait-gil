"""Tmap 에서 추천 경로와 후보 경로를 받는다."""

import asyncio
import logging
from collections.abc import Sequence
from typing import Any

from app.services.tmap_client import TmapClient, TmapError
from core.geo import LngLat

logger = logging.getLogger(__name__)


async def fetch_routes(
    client: TmapClient,
    start: LngLat,
    end: LngLat,
    search_options: Sequence[int],
    start_name: str,
    end_name: str,
) -> list[dict[str, Any]]:
    """검색 옵션마다 경로를 동시에 받는다. 첫 번째가 추천 경로다.

    추천 경로를 못 받으면 오류를 낸다. 후보는 못 받아도 빼고 넘어간다.
    """
    results = await asyncio.gather(
        *(
            client.pedestrian_route(start, end, option, start_name, end_name)
            for option in search_options
        ),
        return_exceptions=True,
    )
    responses: list[dict[str, Any]] = []
    for index, (option, result) in enumerate(zip(search_options, results, strict=True)):
        if isinstance(result, TmapError) and index > 0:
            logger.warning("Tmap 후보 경로(옵션 %s) 실패: %s", option, result.message)
            continue
        if isinstance(result, BaseException):
            raise result
        responses.append(result)
    return responses
