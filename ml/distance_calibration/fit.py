"""실측 사진으로 방향(칸)별 거리 보정값(K)을 구한다.

사진은 {DATA_DIR}/calibration/{거리}m/{방향}.jpg 에 둔다.
예: 3m/12.jpg, 방향은 10·11·12·1·2.
앱 모델로 사진마다 사람 박스를 뽑고, 칸마다 거리 = K ÷ 박스 비율의 K 를 구한 뒤,
거리별 오차와 기존 공식의 오차를 표로 낸다. 구한 값은 VisionConfig 에 사람이 옮긴다.

    uv run --group calibration python -m distance_calibration.fit
"""

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

from distance_calibration.geometry import (
    Box,
    Measurement,
    SectorK,
    clipped_vertically,
    estimate_distance,
    fit_k,
    sector_of,
)
from foot_traffic.common import data_path, load_config, repo_path

PHOTO_SUFFIXES = {".jpg", ".jpeg", ".png"}
DISTANCE_DIR = re.compile(r"^(\d+(?:\.\d+)?)m$")
DIRECTION_NAME = re.compile(r"^(\d+)(?:_\d+)?$")


def parse_photo(path: Path, sectors: list[int]) -> tuple[float, int] | None:
    """폴더(거리)와 파일명(방향)에서 (거리 m, 칸 번호)를 읽는다. 안 맞으면 None."""
    distance = DISTANCE_DIR.match(path.parent.name)
    direction = DIRECTION_NAME.match(path.stem)
    if not distance or not direction or int(direction.group(1)) not in sectors:
        return None
    return float(distance.group(1)), sectors.index(int(direction.group(1)))


def find_photos(photo_dir: Path, sectors: list[int]) -> list[tuple[Path, float, int]]:
    """규칙에 맞는 사진을 거리, 칸 순으로 돌려준다."""
    found = []
    for path in photo_dir.glob("*/*"):
        parsed = (
            parse_photo(path, sectors)
            if path.suffix.lower() in PHOTO_SUFFIXES
            else None
        )
        if parsed:
            found.append((path, parsed[0], parsed[1]))
    return sorted(found, key=lambda item: (item[1], item[2], item[0].name))


def old_estimate(m: Measurement, settings: dict[str, Any]) -> float:
    """기존 공식(화각 가정 + 평균 키·폭)으로 낸 거리. 앱의 estimateDistanceM 과 같다."""
    longest = max(m.image_width, m.image_height)
    focal_px = (longest / 2) / math.tan(
        math.radians(settings["old_long_side_fov_deg"] / 2)
    )
    if clipped_vertically(m.box, settings["clipped_edge"]):
        return focal_px * settings["old_person_width_m"] / (m.box.width * m.image_width)
    return focal_px * settings["old_person_height_m"] / (m.box.height * m.image_height)


def error_pct(estimate: float | None, actual: float) -> float | None:
    return None if estimate is None else (estimate - actual) / actual * 100


def fmt(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def report(
    measurements: list[Measurement], ks: list[SectorK], settings: dict[str, Any]
) -> str:
    sectors = settings["sectors"]
    lines = ["칸별 보정값 (거리 = K ÷ 박스 비율)"]
    lines.append("칸   높이 K (장)   폭 K (장)")
    for index, k in enumerate(ks):
        lines.append(
            f"{sectors[index]:>2}시  {fmt(k.height_k, 3):>6} ({k.height_samples})"
            f"   {fmt(k.width_k, 3):>6} ({k.width_samples})"
        )
    lines += ["", "사진별 오차 (%) = (추정 - 실제) ÷ 실제"]
    lines.append(
        "실제m  방향  칸   방식  높이비 폭비   보정추정  보정오차  기존추정  기존오차"
    )
    for m in measurements:
        by_width = clipped_vertically(m.box, settings["clipped_edge"])
        fitted = estimate_distance(m.box, ks, settings)
        old = old_estimate(m, settings)
        mark = "" if m.sector == m.expected_sector else "  (칸 다름)"
        lines.append(
            f"{m.distance_m:>4.1f}  {sectors[m.expected_sector]:>3}시 "
            f"{sectors[m.sector]:>3}시 {'폭' if by_width else '높이'}   "
            f"{m.box.height:.3f} {m.box.width:.3f}  {fmt(fitted):>7}  "
            f"{fmt(error_pct(fitted, m.distance_m), 1):>7}  {fmt(old):>7}  "
            f"{fmt(error_pct(old, m.distance_m), 1):>7}{mark}"
        )
    return "\n".join(lines)


def measure(photos: list[tuple[Path, float, int]], settings: dict[str, Any]):
    """사진마다 사람 박스를 뽑는다. (측정 목록, 사람을 못 찾은 사진 이름)을 돌려준다."""
    from distance_calibration.detect import load_interpreter, person_boxes, read_image

    interpreter = load_interpreter(repo_path(str(settings["model"])))
    measurements: list[Measurement] = []
    missed: list[str] = []
    for path, distance, expected in photos:
        image = read_image(path)
        boxes = person_boxes(interpreter, image, settings)
        name = f"{path.parent.name}/{path.name}"
        if not boxes:
            missed.append(name)
            continue
        # 한 명만 찍었으므로 점수가 가장 높은 박스를 쓴다.
        box: Box = boxes[0]
        measurements.append(
            Measurement(
                name=name,
                distance_m=distance,
                expected_sector=expected,
                box=box,
                sector=sector_of(box.center_x, len(settings["sectors"])),
                image_width=image.width,
                image_height=image.height,
            )
        )
    return measurements, missed


def main() -> None:
    settings = load_config()["distance_calibration"]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--photos", type=Path, help="사진 폴더(기본: DATA_DIR/설정값)")
    parser.add_argument("--json", type=Path, help="칸별 K 를 JSON 으로 저장할 경로")
    parser.add_argument(
        "--model",
        type=Path,
        help="추론할 .tflite(기본: 설정값). int8 등으로 다시 구할 때",
    )
    args = parser.parse_args()

    photo_dir = args.photos or data_path(settings["photo_dir"])
    photos = find_photos(photo_dir, settings["sectors"])
    if not photos:
        raise SystemExit(
            f"규칙에 맞는 사진이 없습니다: {photo_dir}/{{거리}}m/{{방향}}.jpg"
        )

    if args.model:
        settings = {**settings, "model": args.model.resolve()}
    measurements, missed = measure(photos, settings)
    ks = fit_k(measurements, settings)
    print(f"사진 {len(photos)}장 중 사람을 찾은 사진 {len(measurements)}장\n")
    print(report(measurements, ks, settings))
    if missed:
        print("\n사람을 못 찾은 사진: " + ", ".join(missed))
    if args.json:
        payload = {
            str(settings["sectors"][i]): {
                "height_k": k.height_k,
                "width_k": k.width_k,
            }
            for i, k in enumerate(ks)
        }
        args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")


if __name__ == "__main__":
    main()
