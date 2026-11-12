"""remap_labels.py 로 합친 폴더를 train/val/test 로 나누고 data.yaml 을 만든다.

실행: 저장소 루트에서
    uv run --with pyyaml python ml/scripts/split_dataset.py <합친 폴더> <출력 폴더>
- 같은 영상에서 나온 프레임은 같은 split 에 넣는다(누수 방지).
  파일 이름에서 --group-pattern 의 첫 그룹을 영상 이름으로 본다.
  기본값은 끝의 "_숫자"(프레임 번호)를 뗀 이름이다.
  예: coco_walk01_0012.jpg → coco_walk01
- 출력: images/{train,val,test}, labels/{train,val,test}, data.yaml.
  Colab 에서 /content/dataset 에 풀어 쓰도록
  data.yaml 의 path 는 --dataset-root 로 정한다.
"""

import argparse
import random
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import yaml

DEFAULT_CLASSES = Path(__file__).resolve().parent.parent / "configs" / "classes.yaml"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")


def group_key(stem: str, pattern: re.Pattern[str]) -> str:
    match = pattern.match(stem)
    return match.group(1) if match else stem


def assign_splits(
    groups: list[str], ratios: tuple[float, float, float], seed: int
) -> dict[str, str]:
    shuffled = sorted(groups)
    random.Random(seed).shuffle(shuffled)
    n_train = round(len(shuffled) * ratios[0])
    n_val = round(len(shuffled) * ratios[1])
    result = {}
    for i, group in enumerate(shuffled):
        if i < n_train:
            result[group] = "train"
        elif i < n_train + n_val:
            result[group] = "val"
        else:
            result[group] = "test"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("merged_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES)
    parser.add_argument(
        "--ratios", type=float, nargs=3, default=(0.8, 0.1, 0.1), metavar="R"
    )
    parser.add_argument("--group-pattern", default=r"^(.*?)(?:_\d+)?$")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--dataset-root", default="/content/dataset")
    args = parser.parse_args()
    if abs(sum(args.ratios) - 1) > 1e-6:
        raise SystemExit("--ratios 의 합이 1 이어야 합니다.")

    pattern = re.compile(args.group_pattern)
    images = [
        p
        for p in (args.merged_dir / "images").rglob("*")
        if p.suffix.lower() in IMAGE_SUFFIXES
    ]
    by_group: dict[str, list[Path]] = defaultdict(list)
    for image in images:
        by_group[group_key(image.stem, pattern)].append(image)
    split_of = assign_splits(list(by_group), tuple(args.ratios), args.seed)

    names = yaml.safe_load(args.classes.read_text(encoding="utf-8"))["names"]
    counts: dict[str, Counter[int]] = {s: Counter() for s in SPLITS}
    n_images: Counter[str] = Counter()
    for group, members in by_group.items():
        split = split_of[group]
        for image in members:
            rel = image.relative_to(args.merged_dir / "images")
            label = (args.merged_dir / "labels" / rel).with_suffix(".txt")
            out_image = args.output_dir / "images" / split / image.name
            out_label = (args.output_dir / "labels" / split / image.name).with_suffix(
                ".txt"
            )
            out_image.parent.mkdir(parents=True, exist_ok=True)
            out_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(image, out_image)
            text = label.read_text(encoding="utf-8") if label.exists() else ""
            out_label.write_text(text, encoding="utf-8")
            boxes = [line for line in text.splitlines() if line.strip()]
            counts[split].update(int(line.split()[0]) for line in boxes)
            n_images[split] += 1

    data_yaml = {
        "path": args.dataset_root,
        **{s: f"images/{s}" for s in SPLITS},
        "names": names,
    }
    (args.output_dir / "data.yaml").write_text(
        yaml.safe_dump(data_yaml, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    for split in SPLITS:
        print(f"{split}: 이미지 {n_images[split]}장")
        for idx, name in names.items():
            print(f"  {idx} {name}: {counts[split][int(idx)]}")


if __name__ == "__main__":
    main()
