"""실수(m) DEM 을 cm 정수 GeoTIFF 로 바꿔 파일을 줄인다.

실행: backend/ 에서 (rasterio 를 backend 환경에서 쓴다)
    uv run python ../pipeline/compress_dem.py <입력 DEM> <출력 DEM>
    출력은 백엔드 기본 위치인 ../data/processed/seoul_dem_5m.tif 로 둔다.
- 입력: 배리어프리 pipeline/steps/00_build_dem.py 가 만든 실수 DEM (EPSG:5186, 5m)
- 출력: 고도를 cm 단위 int32 로 반올림해 ZSTD 로 압축한 GeoTIFF.
  밴드 배율(scale)을 0.01 로 적어 두어, 백엔드는 읽은 값에 배율을 곱해 m 로 쓴다.
  서울 DEM 46.0MB → 18.2MB, 고도 차이는 반올림 오차(약 0.005m)뿐이다.
"""

import argparse
from pathlib import Path

import numpy as np
import rasterio

SCALE_M = 0.01
NODATA = np.iinfo(np.int32).min
ZSTD_LEVEL = 22
# 정수 값은 이웃 칸과의 차이를 압축하는 편이 작다(GDAL PREDICTOR=2)
HORIZONTAL_PREDICTOR = 2
BLOCK_SIZE = 512


def to_centimeters(heights: np.ndarray, nodata: float | None) -> np.ndarray:
    empty = ~np.isfinite(heights)
    if nodata is not None:
        empty |= heights == nodata
    filled = np.where(empty, 0, heights)
    return np.where(empty, NODATA, np.round(filled / SCALE_M)).astype(np.int32)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise SystemExit("입력과 출력이 같은 파일입니다.")

    with rasterio.open(args.source) as src:
        profile = src.profile
        heights = src.read(1)
    centimeters = to_centimeters(heights, profile.get("nodata"))
    profile.update(
        dtype="int32",
        nodata=NODATA,
        compress="zstd",
        zstd_level=ZSTD_LEVEL,
        predictor=HORIZONTAL_PREDICTOR,
        tiled=True,
        blockxsize=BLOCK_SIZE,
        blockysize=BLOCK_SIZE,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(args.output, "w", **profile) as dst:
        dst.write(centimeters, 1)
        dst.scales = (SCALE_M,)
        dst.offsets = (0.0,)

    with rasterio.open(args.output) as check:
        back = check.read(1, masked=True)
    valid = centimeters != NODATA
    if not np.array_equal(~back.mask, valid):
        raise SystemExit("빈 칸 위치가 원본과 다릅니다.")
    error = np.abs(back.data[valid] * SCALE_M - heights[valid]).max(initial=0.0)
    print(
        f"{args.source.stat().st_size / 1e6:.1f}MB → "
        f"{args.output.stat().st_size / 1e6:.1f}MB, 최대 고도 차이 {error:.4f}m"
    )


if __name__ == "__main__":
    main()
