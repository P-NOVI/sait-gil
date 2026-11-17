"""도시데이터 주요 장소 영역 파일과 수집 DB의 혼잡 단계로 구역 혼잡도를 만든다.

길찾기 때는 도시데이터를 부르지 않는다. 수집기(app.collector)가 몇 시간마다 넣어 둔
현재값·시간별 예측에서, 장소마다 가장 최근 관측분의 지금 시각에 가장 가까운 값을 쓴다.
"""

import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.collector.models import CitydataPopulation
from app.collector.store import as_kst, collector_engine
from app.config import Settings
from app.services.sdot_client import KST
from core.congestion import Area, Ring, area_level

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AreaShape:
    name: str
    rings: tuple[Ring, ...]


@lru_cache
def load_area_shapes(path: Path) -> dict[str, AreaShape]:
    """pipeline/ 이 만든 영역 파일({"areas": [{code, name, rings}]})을 읽는다."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        str(area["code"]): AreaShape(
            name=str(area["name"]),
            rings=tuple(
                tuple((float(lng), float(lat)) for lng, lat in ring)
                for ring in area["rings"]
            ),
        )
        for area in data["areas"]
    }


def latest_levels(
    session: Session, now: datetime, max_age: timedelta, window: timedelta
) -> dict[str, int]:
    """장소마다 가장 최근 관측분에서 now 와 window 안으로 가장 가까운 혼잡 단계.

    now - max_age 보다 먼저 관측한 묶음은 쓰지 않는다.
    """
    newest = (
        select(
            CitydataPopulation.area_code,
            func.max(CitydataPopulation.observed_at).label("observed_at"),
        )
        .where(CitydataPopulation.observed_at >= now - max_age)
        .group_by(CitydataPopulation.area_code)
        .subquery()
    )
    rows = session.execute(
        select(
            CitydataPopulation.area_code,
            CitydataPopulation.target_time,
            CitydataPopulation.congestion_level,
        ).join(
            newest,
            (CitydataPopulation.area_code == newest.c.area_code)
            & (CitydataPopulation.observed_at == newest.c.observed_at),
        )
    ).all()
    best: dict[str, tuple[timedelta, int]] = {}
    for area_code, target_time, level in rows:
        gap = abs(as_kst(target_time) - now)
        if gap > window:
            continue
        known = best.get(area_code)
        if known is None or gap < known[0]:
            best[area_code] = (gap, level)
    return {area_code: level for area_code, (_, level) in best.items()}


def areas_with_levels(
    shapes: Mapping[str, AreaShape],
    levels: Mapping[str, int],
    level_values: Sequence[float],
) -> list[Area]:
    """장소 코드별 혼잡 단계를 구역 혼잡도로 바꾼다. 영역을 모르는 장소는 뺀다."""
    return [
        Area(shapes[code].rings, area_level(level, level_values))
        for code, level in levels.items()
        if code in shapes
    ]


async def current_areas(settings: Settings, now: datetime | None = None) -> list[Area]:
    """수집 DB에서 지금 시각의 구역 혼잡도를 만든다.

    DB 주소나 영역 파일이 없거나 DB가 실패하면 경고를 남기고 빈 목록이다.
    그러면 S-DoT 센서만으로 혼잡 점수를 낸다.
    """
    database_url = settings.collector_database_url.get_secret_value()
    if not database_url:
        logger.warning("COLLECTOR_DATABASE_URL 이 없어 도시데이터 없이 고릅니다.")
        return []
    if not settings.citydata_areas_path.exists():
        logger.warning(
            "도시데이터 영역 파일이 없어 도시데이터 없이 경로를 고릅니다: %s",
            settings.citydata_areas_path,
        )
        return []
    shapes = load_area_shapes(settings.citydata_areas_path)
    moment = now or datetime.now(KST)

    def read() -> dict[str, int]:
        engine = collector_engine(database_url, settings.route_db_connect_timeout_s)
        with Session(engine) as session:
            return latest_levels(
                session,
                moment,
                timedelta(hours=settings.citydata_max_age_h),
                timedelta(minutes=settings.citydata_match_window_minutes),
            )

    try:
        levels = await run_in_threadpool(read)
    except SQLAlchemyError as error:
        # 예외 문구에 접속 주소가 섞일 수 있어 종류만 남긴다.
        logger.warning(
            "도시데이터 없이 경로를 고릅니다. 수집 DB 실패 (%s)", type(error).__name__
        )
        return []
    if not levels:
        logger.warning("최근 도시데이터가 없어 도시데이터 없이 경로를 고릅니다.")
    return areas_with_levels(shapes, levels, settings.citydata_level_values)
