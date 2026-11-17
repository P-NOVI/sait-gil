"""수집 DB(COLLECTOR_DATABASE_URL)의 테이블. 테이블은 migrations/collector 가 만든다."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, SmallInteger, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class CollectorBase(DeclarativeBase):
    """수집 테이블의 부모."""


class CitydataPopulation(CollectorBase):
    """서울 실시간 인구데이터(citydata_ppltn) 장소별 현재값과 시간별 예측.

    한 번 받을 때 현재값 한 행(target_time == observed_at)과 예측 행(보통 12개)이
    들어간다. 같은 관측 시각을 다시 받으면 키가 겹쳐 넣지 않는다. 지우지 않고 쌓는다.
    """

    __tablename__ = "citydata_population"

    # 장소 코드(AREA_CD, 예: POI009)
    area_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    # 현재값을 잰 시각(PPLTN_TIME). 예측도 이 시각 기준으로 나온 값이다.
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, index=True
    )
    # 값이 가리키는 시각. 현재값은 observed_at, 예측은 FCST_TIME 이다.
    target_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    is_forecast: Mapped[bool]
    # 1 여유, 2 보통, 3 약간 붐빔, 4 붐빔
    congestion_level: Mapped[int] = mapped_column(SmallInteger)
    population_min: Mapped[int | None] = mapped_column(Integer)
    population_max: Mapped[int | None] = mapped_column(Integer)
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
