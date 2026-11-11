"""DEM 파일에서 경위도 좌표의 고도를 읽는다."""

import logging
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform

from core.geo import LngLat

WGS84 = "EPSG:4326"

logger = logging.getLogger(__name__)


def sample_elevations(
    dem_path: Path, positions: Sequence[LngLat]
) -> list[float | None]:
    """좌표만 DEM 좌표계로 바꿔 읽는다. DEM 빈 칸·범위 밖은 None.

    DEM 을 재투영하지 않는다. 재투영하면 고도가 한 번 더 보간된다.
    DEM 파일이 없으면 모두 None 이다. 그러면 경사 점수가 0 이 되어 완만한 길을
    따로 고르지 않는다.
    """
    if not positions:
        return []
    if not dem_path.exists():
        logger.warning("DEM 파일이 없어 경사를 계산하지 않습니다: %s", dem_path)
        return [None] * len(positions)
    lngs = [lng for lng, _ in positions]
    lats = [lat for _, lat in positions]
    with rasterio.open(dem_path) as dem:
        xs, ys = transform(WGS84, dem.crs, lngs, lats)
        values = [
            value[0] for value in dem.sample(zip(xs, ys, strict=True), masked=True)
        ]
    return [None if np.ma.is_masked(value) else float(value) for value in values]
