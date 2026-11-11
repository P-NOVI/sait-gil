"""DEM 파일에서 경위도 좌표의 고도를 읽는다."""

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform

from core.geo import LngLat

WGS84 = "EPSG:4326"


def sample_elevations(
    dem_path: Path, positions: Sequence[LngLat]
) -> list[float | None]:
    """좌표만 DEM 좌표계로 바꿔 읽는다. DEM 빈 칸·범위 밖은 None.

    DEM 을 재투영하지 않는다. 재투영하면 고도가 한 번 더 보간된다.
    """
    if not positions:
        return []
    lngs = [lng for lng, _ in positions]
    lats = [lat for _, lat in positions]
    with rasterio.open(dem_path) as dem:
        xs, ys = transform(WGS84, dem.crs, lngs, lats)
        values = [
            value[0] for value in dem.sample(zip(xs, ys, strict=True), masked=True)
        ]
    return [None if np.ma.is_masked(value) else float(value) for value in values]
