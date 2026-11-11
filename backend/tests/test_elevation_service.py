from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform

from app.services.elevation_service import WGS84, sample_elevations

# 서울 DEM 과 같은 좌표계(EPSG:5186), 5m 격자
DEM_CRS = "EPSG:5186"
CELL_M = 5.0
LEFT, TOP = 200_000.0, 550_000.0
NODATA = -9999.0


@pytest.fixture
def dem_path(tmp_path: Path) -> Path:
    path = tmp_path / "dem.tif"
    heights = np.array([[10.0, 20.0], [30.0, NODATA]], dtype="float32")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="float32",
        crs=DEM_CRS,
        transform=from_origin(LEFT, TOP, CELL_M, CELL_M),
        nodata=NODATA,
    ) as dem:
        dem.write(heights, 1)
    return path


def cell_center(row: int, col: int) -> tuple[float, float]:
    """DEM 칸 가운데의 경위도."""
    x = LEFT + (col + 0.5) * CELL_M
    y = TOP - (row + 0.5) * CELL_M
    lngs, lats = transform(DEM_CRS, WGS84, [x], [y])
    return (lngs[0], lats[0])


def test_sample_elevations_reads_cells(dem_path: Path) -> None:
    positions = [cell_center(0, 0), cell_center(0, 1), cell_center(1, 0)]

    assert sample_elevations(dem_path, positions) == [10.0, 20.0, 30.0]


def test_sample_elevations_nodata_and_outside_are_none(dem_path: Path) -> None:
    outside = cell_center(10, 10)

    assert sample_elevations(dem_path, [cell_center(1, 1), outside]) == [None, None]


def test_sample_elevations_empty(dem_path: Path) -> None:
    assert sample_elevations(dem_path, []) == []
