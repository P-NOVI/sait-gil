"""YOLO 형식 데이터셋의 클래스 번호를 통일 클래스(configs/classes.yaml)로 바꾼다.

실행: 저장소 루트에서
    uv run --with pyyaml python ml/scripts/remap_labels.py \\
        <원본 데이터셋 폴더> <출력 폴더> --source coco
- 입력: Ultralytics·Roboflow·CVAT 가 내보낸 YOLO 형식 폴더.
  data.yaml(names) 과 images/, labels/ 가 있어야 한다. 하위 폴더 구조는 그대로 둔다.
- 출력: 같은 구조로 이미지를 복사하고, 라벨은 통일 id 로 바꾼 txt 로 쓴다.
  매핑에 없는 클래스의 박스는 버린다.
  박스가 하나도 안 남은 이미지도 배경 이미지로 남긴다.
- 출력 파일 이름 앞에 데이터셋 이름을 붙여,
  여러 데이터셋을 한 폴더로 합쳐도 겹치지 않게 한다.
"""

import argparse
import shutil
from collections import Counter
from pathlib import Path

import yaml

DEFAULT_CLASSES = Path(__file__).resolve().parent.parent / "configs" / "classes.yaml"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def load_names(names: dict[int, str] | list[str]) -> dict[int, str]:
    if isinstance(names, list):
        return dict(enumerate(names))
    return {int(k): v for k, v in names.items()}


def build_id_map(
    source_names: dict[int, str],
    target_names: dict[int, str],
    mapping: dict[str, str],
) -> dict[int, int]:
    target_ids = {name: idx for idx, name in target_names.items()}
    unknown = set(mapping.values()) - target_ids.keys()
    if unknown:
        raise SystemExit(f"classes.yaml names 에 없는 클래스: {sorted(unknown)}")
    return {
        src_id: target_ids[mapping[name]]
        for src_id, name in source_names.items()
        if name in mapping
    }


def remap_lines(lines: list[str], id_map: dict[int, int]) -> list[str]:
    out = []
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        src_id = int(parts[0])
        if src_id in id_map:
            out.append(" ".join([str(id_map[src_id]), *parts[1:]]))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--source", required=True, help="classes.yaml sources 의 키")
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES)
    args = parser.parse_args()

    config = yaml.safe_load(args.classes.read_text(encoding="utf-8"))
    if args.source not in config["sources"]:
        raise SystemExit(f"classes.yaml sources 에 없는 데이터셋: {args.source}")
    source_yaml = yaml.safe_load(
        (args.source_dir / "data.yaml").read_text(encoding="utf-8")
    )
    id_map = build_id_map(
        load_names(source_yaml["names"]),
        load_names(config["names"]),
        config["sources"][args.source],
    )

    target_names = load_names(config["names"])
    counts: Counter[int] = Counter()
    images = [
        p
        for p in (args.source_dir / "images").rglob("*")
        if p.suffix.lower() in IMAGE_SUFFIXES
    ]
    for image in images:
        rel = image.relative_to(args.source_dir / "images")
        new_name = f"{args.source}_{rel.name}"
        label = (args.source_dir / "labels" / rel).with_suffix(".txt")
        lines = label.read_text(encoding="utf-8").splitlines() if label.exists() else []
        remapped = remap_lines(lines, id_map)
        counts.update(int(line.split()[0]) for line in remapped)

        out_image = args.output_dir / "images" / rel.parent / new_name
        out_label = (args.output_dir / "labels" / rel.parent / new_name).with_suffix(
            ".txt"
        )
        out_image.parent.mkdir(parents=True, exist_ok=True)
        out_label.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image, out_image)
        out_label.write_text("\n".join(remapped), encoding="utf-8")

    print(f"이미지 {len(images)}장")
    for idx, name in target_names.items():
        print(f"  {idx} {name}: {counts[idx]}")


if __name__ == "__main__":
    main()
