"""서울 실시간 도시데이터 주요 장소 영역(shp)을 백엔드가 읽는 JSON 으로 바꾼다.

실행: backend/ 에서 (좌표 변환에 backend 의 rasterio 를 쓴다)
    uv run --with pyshp python ../pipeline/export_citydata_areas.py \\
        <영역 zip 또는 shp> ../data/processed/citydata_areas.json
- 입력: 서울 열린데이터광장 "서울시 실시간 인구데이터"(OA-21778)의
  "서울시 주요 121장소 영역.zip". zip 은 그대로 넣어도 된다.
- 출력: {"areas": [{"code", "name", "rings": [[[lon, lat], ...], ...]}]}
  rings 는 외곽선·구멍·여러 조각을 모두 담는다. 백엔드는 짝홀 규칙으로 안팎을 본다.
- 좌표계는 .prj 에서 읽어 WGS84 로 바꾼다. .prj 가 없으면 --source-crs 로 준다.
"""

import argparse
import json
import tempfile
import zipfile
from pathlib import Path

import shapefile
from rasterio.crs import CRS
from rasterio.warp import transform

WGS84 = "EPSG:4326"
# 경위도 소수 자릿수. 6자리는 약 0.1m 다.
COORD_DIGITS = 6
# .cpg 가 없을 때 dbf 글자 인코딩 (서울시 shp 는 보통 cp949)
DEFAULT_ENCODING = "cp949"


def find_shp(source: Path, workdir: Path) -> Path:
    if source.suffix.lower() != ".zip":
        return source
    with zipfile.ZipFile(source) as archive:
        archive.extractall(workdir)
    found = sorted(workdir.rglob("*.shp"))
    if len(found) != 1:
        raise SystemExit(f"zip 안의 shp 가 1개가 아닙니다: {len(found)}개")
    return found[0]


def read_crs(shp: Path, fallback: str | None) -> CRS:
    prj = shp.with_suffix(".prj")
    if prj.exists():
        return CRS.from_wkt(prj.read_text(encoding="utf-8", errors="ignore"))
    if fallback is None:
        raise SystemExit(".prj 가 없습니다. --source-crs 로 좌표계를 주세요.")
    return CRS.from_user_input(fallback)


def read_encoding(shp: Path) -> str:
    cpg = shp.with_suffix(".cpg")
    if cpg.exists():
        return cpg.read_text(encoding="ascii", errors="ignore").strip() or (
            DEFAULT_ENCODING
        )
    return DEFAULT_ENCODING


def field_index(fields: list[str], name: str) -> int:
    upper = [field.upper() for field in fields]
    if name.upper() not in upper:
        raise SystemExit(f"속성 {name} 이 없습니다. 있는 속성: {fields}")
    return upper.index(name.upper())


def to_rings(shape: shapefile.Shape, crs: CRS) -> list[list[tuple[float, float]]]:
    """shp 조각(parts)마다 WGS84 고리 하나."""
    starts = [*shape.parts, len(shape.points)]
    rings = []
    for start, end in zip(starts, starts[1:], strict=False):
        xs, ys = zip(*shape.points[start:end], strict=True)
        lons, lats = transform(crs, WGS84, list(xs), list(ys))
        rings.append(
            [
                (round(lon, COORD_DIGITS), round(lat, COORD_DIGITS))
                for lon, lat in zip(lons, lats, strict=True)
            ]
        )
    return rings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--code-field", default="AREA_CD")
    parser.add_argument("--name-field", default="AREA_NM")
    parser.add_argument("--source-crs", help=".prj 가 없을 때 좌표계 (예: EPSG:5186)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as workdir:
        shp = find_shp(args.source, Path(workdir))
        crs = read_crs(shp, args.source_crs)
        with shapefile.Reader(str(shp), encoding=read_encoding(shp)) as reader:
            fields = [field[0] for field in reader.fields[1:]]
            code_at = field_index(fields, args.code_field)
            name_at = field_index(fields, args.name_field)
            areas = [
                {
                    "code": str(record[code_at]).strip(),
                    "name": str(record[name_at]).strip(),
                    "rings": to_rings(shape, crs),
                }
                for shape, record in zip(reader.shapes(), reader.records(), strict=True)
            ]

    codes = [area["code"] for area in areas]
    if len(set(codes)) != len(codes):
        raise SystemExit("장소 코드가 겹칩니다.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps({"areas": areas}, ensure_ascii=False), encoding="utf-8"
    )
    print(f"{len(areas)}곳 → {args.output} ({args.output.stat().st_size / 1e3:.0f}KB)")


if __name__ == "__main__":
    main()
