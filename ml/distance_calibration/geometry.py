"""모델 출력을 사람 박스로 바꾸고 거리 보정값(K)을 구하는 순수 계산.

앱(YoloDecoder.kt)과 같은 규칙이라 사진에서 구한 K 를 앱에 그대로 쓸 수 있다.
모델 추론과 파일 읽기는 detect.py 가 맡고, 여기에는 넣지 않는다(가짜 값 테스트용).
"""

from dataclasses import dataclass
from statistics import median
from typing import Any

import numpy as np

# 출력 채널 0~3 은 박스(가운데 x·y, 너비, 높이), 4 부터는 클래스별 점수다.
BOX_CHANNELS = 4


@dataclass(frozen=True)
class Box:
    """사람 박스. 좌표는 영상 크기로 나눈 0~1 값이다(왼쪽 위가 0)."""

    left: float
    top: float
    width: float
    height: float
    score: float

    @property
    def right(self) -> float:
        return self.left + self.width

    @property
    def bottom(self) -> float:
        return self.top + self.height

    @property
    def center_x(self) -> float:
        return self.left + self.width / 2


@dataclass(frozen=True)
class Letterbox:
    """영상을 정사각형 입력에 비율을 지켜 넣은 배치. 남는 쪽은 양쪽에 같은 여백이다."""

    image_width: int
    image_height: int
    input_size: int

    @property
    def scale(self) -> float:
        return min(
            self.input_size / self.image_width, self.input_size / self.image_height
        )

    @property
    def pad_x(self) -> float:
        return (self.input_size - self.image_width * self.scale) / 2

    @property
    def pad_y(self) -> float:
        return (self.input_size - self.image_height * self.scale) / 2

    def to_image_x(self, x: float) -> float:
        """입력 기준 0~1 가로 위치를 영상 기준 0~1 로. 여백은 영상 끝으로 자른다."""
        value = (x * self.input_size - self.pad_x) / (self.image_width * self.scale)
        return min(max(value, 0.0), 1.0)

    def to_image_y(self, y: float) -> float:
        value = (y * self.input_size - self.pad_y) / (self.image_height * self.scale)
        return min(max(value, 0.0), 1.0)


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    """가운데 x·y, 너비, 높이 박스 둘이 겹치는 정도."""
    overlap_w = min(a[0] + a[2] / 2, b[0] + b[2] / 2) - max(
        a[0] - a[2] / 2, b[0] - b[2] / 2
    )
    overlap_h = min(a[1] + a[3] / 2, b[1] + b[3] / 2) - max(
        a[1] - a[3] / 2, b[1] - b[3] / 2
    )
    if overlap_w <= 0 or overlap_h <= 0:
        return 0.0
    overlap = overlap_w * overlap_h
    return float(overlap / (a[2] * a[3] + b[2] * b[3] - overlap))


def decode_persons(
    output: np.ndarray, letterbox: Letterbox, settings: dict[str, Any]
) -> list[Box]:
    """출력(채널, 후보)에서 사람 박스만 뽑는다.

    앱의 decodeDetections·toDetectionFrame 과 같은 규칙이다.

    후보마다 점수가 가장 높은 클래스 하나만 쓰고, 점수 컷 아래는 버리고, 같은 클래스끼리
    겹친 박스는 점수가 낮은 쪽을 버린다. 여백에만 있는 박스는 버린다.
    """
    scores = output[BOX_CHANNELS : BOX_CHANNELS + settings["class_count"]]
    best = scores.argmax(axis=0)
    best_score = scores.max(axis=0)
    keep = (best == settings["person_class"]) & (best_score >= settings["min_score"])
    candidates = np.flatnonzero(keep)
    candidates = candidates[np.argsort(-best_score[candidates])]

    kept: list[int] = []
    for index in candidates:
        box = output[:BOX_CHANNELS, index]
        if all(_iou(output[:BOX_CHANNELS, k], box) < settings["nms_iou"] for k in kept):
            kept.append(int(index))

    persons = []
    for index in kept:
        cx, cy, w, h = (float(v) for v in output[:BOX_CHANNELS, index])
        left = letterbox.to_image_x(cx - w / 2)
        top = letterbox.to_image_y(cy - h / 2)
        width = letterbox.to_image_x(cx + w / 2) - left
        height = letterbox.to_image_y(cy + h / 2) - top
        if width > 0 and height > 0:
            persons.append(Box(left, top, width, height, float(best_score[index])))
    return persons


def sector_of(x: float, sector_count: int) -> int:
    """영상 가로 위치(0~1)가 속한 칸 번호. 칸은 영상 가로를 같은 폭으로 나눈다."""
    return min(max(int(x * sector_count), 0), sector_count - 1)


def clipped_vertically(box: Box, edge: float) -> bool:
    """박스 위나 아래가 영상 끝에 닿아 잘렸는지. 앱의 isClippedVertically 와 같다."""
    return box.top <= edge or box.bottom >= 1 - edge


def clipped_sideways(box: Box, edge: float) -> bool:
    """박스 왼쪽이나 오른쪽이 영상 끝에 닿아 잘렸는지."""
    return box.left <= edge or box.right >= 1 - edge


@dataclass(frozen=True)
class Measurement:
    """사진 한 장에서 잰 값. distance_m 은 줄자로 잰 실제 거리다."""

    name: str
    distance_m: float
    expected_sector: int
    box: Box
    sector: int
    image_width: int
    image_height: int


@dataclass(frozen=True)
class SectorK:
    """칸 하나의 보정값.

    거리 = height_k ÷ 박스 높이 비율, 거리 = width_k ÷ 박스 폭 비율.
    """

    height_k: float | None
    width_k: float | None
    height_samples: int
    width_samples: int


def fit_k(measurements: list[Measurement], settings: dict[str, Any]) -> list[SectorK]:
    """칸마다 K 를 구한다. 거리 × 박스 비율은 같은 칸에서 거의 일정하므로 중앙값을 쓴다.

    위아래가 잘린 사진은 폭 K 에, 온전한 사진은 높이 K 에 넣는다(앱이 거리를 재는 방식).
    폭 K 는 좌우가 잘린 사진을 뺀다. 재료가 없는 칸의 K 는 None 이다.
    """
    edge = settings["clipped_edge"]
    result = []
    for sector in range(len(settings["sectors"])):
        mine = [m for m in measurements if m.sector == sector]
        heights = [
            m.distance_m * m.box.height
            for m in mine
            if not clipped_vertically(m.box, edge)
        ]
        widths = [
            m.distance_m * m.box.width
            for m in mine
            if clipped_vertically(m.box, edge) and not clipped_sideways(m.box, edge)
        ]
        result.append(
            SectorK(
                height_k=median(heights) if heights else None,
                width_k=median(widths) if widths else None,
                height_samples=len(heights),
                width_samples=len(widths),
            )
        )
    return result


def estimate_distance(box: Box, k: SectorK, settings: dict[str, Any]) -> float | None:
    """보정값으로 거리를 추정한다. 앱과 같게 위아래가 잘리면 폭, 아니면 높이를 쓴다."""
    if clipped_vertically(box, settings["clipped_edge"]):
        return k.width_k / box.width if k.width_k is not None else None
    return k.height_k / box.height if k.height_k is not None else None
