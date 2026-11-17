"""시간대별 S-DoT 예측 유동인구를 센서 혼잡도로 바꾼다.

예측은 매일 예측 배치(ml foot_traffic.daily, forecast-daily.yml)가 수집 DB의
foot_traffic_forecasts 에 쌓는다. 같은 시각을 사흘 연속 예측하므로, 오늘까지 예측한
것 중 가장 최근 것을 쓴다. 배리어프리 forecast_congestion_service.py 와 같은 방식이다.
"""

import logging
from datetime import date, datetime

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.collector.models import FootTrafficForecast
from app.collector.store import collector_engine
from app.config import Settings
from app.services.sensor_service import load_sensor_positions, sensors_with_levels
from core.congestion import Sensor

logger = logging.getLogger(__name__)


def latest_forecasts(session: Session, slot: datetime, today: date) -> dict[int, float]:
    """센서 코드 → slot 시작 한 시간의 예측 유동인구(명/시간).

    센서마다 issued_on 이 today 이하인 것 중 가장 최근 예측을 쓴다.
    """
    latest = (
        select(
            FootTrafficForecast.sensor_code,
            func.max(FootTrafficForecast.issued_on).label("issued_on"),
        )
        .where(
            FootTrafficForecast.slot_start == slot,
            FootTrafficForecast.issued_on <= today,
        )
        .group_by(FootTrafficForecast.sensor_code)
        .subquery()
    )
    rows = session.execute(
        select(FootTrafficForecast.sensor_code, FootTrafficForecast.foot_traffic)
        .join(
            latest,
            (FootTrafficForecast.sensor_code == latest.c.sensor_code)
            & (FootTrafficForecast.issued_on == latest.c.issued_on),
        )
        .where(FootTrafficForecast.slot_start == slot)
    ).all()
    return {int(code): float(value) for code, value in rows}


async def forecast_sensors(settings: Settings, slot: datetime) -> list[Sensor]:
    """slot 시작 한 시간의 예측 센서 혼잡도.

    DB 주소나 센서 위치 파일이 없거나 DB가 실패하면 빈 목록이다.
    """
    database_url = settings.collector_database_url.get_secret_value()
    if not database_url or not settings.sensors_path.exists():
        return []

    def read() -> dict[int, float]:
        engine = collector_engine(database_url, settings.route_db_connect_timeout_s)
        with Session(engine) as session:
            # slot 날짜보다 뒤에 낸 예측은 아직 없으므로 오늘까지 낸 것 중 최신과 같다.
            return latest_forecasts(session, slot, slot.date())

    try:
        counts = await run_in_threadpool(read)
    except SQLAlchemyError as error:
        # 예외 문구에 접속 주소가 섞일 수 있어 종류만 남긴다.
        logger.warning("예측 혼잡도를 읽지 못했습니다 (%s)", type(error).__name__)
        return []
    per_bin = {
        code: count / settings.forecast_bins_per_hour for code, count in counts.items()
    }
    return sensors_with_levels(
        load_sensor_positions(settings.sensors_path),
        per_bin,
        settings.congestion_full_count,
    )
