from pathlib import Path

import numpy as np

from distance_calibration.fit import error_pct, find_photos, parse_photo
from distance_calibration.geometry import (
    Box,
    Letterbox,
    Measurement,
    SectorK,
    clipped_sideways,
    clipped_vertically,
    decode_persons,
    estimate_distance,
    fit_k,
    height_k_at,
    sector_of,
)

SETTINGS = {
    "sectors": [10, 11, 12, 1, 2],
    "input_size": 640,
    "min_score": 0.25,
    "nms_iou": 0.7,
    "class_count": 8,
    "person_class": 0,
    "clipped_edge": 0.02,
}


def measurement(distance: float, box: Box, expected: int = 2) -> Measurement:
    return Measurement(
        name="x",
        distance_m=distance,
        expected_sector=expected,
        box=box,
        sector=sector_of(box.center_x, 5),
        image_width=1536,
        image_height=2048,
    )


def test_parse_photo_reads_distance_folder_and_direction_name() -> None:
    sectors = SETTINGS["sectors"]
    assert parse_photo(Path("calibration/3m/12.jpg"), sectors) == (3.0, 2)
    assert parse_photo(Path("calibration/5m/10.jpg"), sectors) == (5.0, 0)
    assert parse_photo(Path("calibration/1m/2_1.jpg"), sectors) == (1.0, 4)


def test_parse_photo_skips_names_outside_the_rule() -> None:
    sectors = SETTINGS["sectors"]
    assert parse_photo(Path("calibration/3m/7.jpg"), sectors) is None
    assert parse_photo(Path("calibration/far/12.jpg"), sectors) is None
    assert parse_photo(Path("calibration/3m/desktop.ini"), sectors) is None


def test_find_photos_sorts_by_distance_then_sector(tmp_path: Path) -> None:
    for name in ["5m/10.jpg", "1m/2.jpg", "1m/10.jpg", "1m/desktop.ini", "x/12.jpg"]:
        path = tmp_path / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b"")

    found = find_photos(tmp_path, SETTINGS["sectors"])

    assert [(d, s) for _, d, s in found] == [(1.0, 0), (1.0, 4), (5.0, 0)]


def test_sector_of_splits_width_into_equal_sectors() -> None:
    assert [sector_of(x, 5) for x in (0.0, 0.19, 0.2, 0.5, 0.79, 1.0)] == [
        0,
        0,
        1,
        2,
        3,
        4,
    ]


def test_letterbox_maps_input_coordinates_back_to_the_portrait_image() -> None:
    # 1536×2048 을 640 정사각형에 넣으면 가로 여백이 양쪽 80px 씩이다.
    box = Letterbox(1536, 2048, 640)

    assert box.scale == 640 / 2048
    assert box.pad_x == 80
    assert box.pad_y == 0
    assert box.to_image_x(0.5) == 0.5
    assert box.to_image_x(0.0) == 0.0  # 여백은 영상 끝으로 자른다
    assert box.to_image_y(1.0) == 1.0


def fake_output(candidates: list[tuple[int, float, float, float, float, float]]):
    """(클래스, 점수, 가운데 x·y, 너비, 높이) 목록으로 (12, 후보) 출력을 만든다."""
    out = np.zeros((12, len(candidates)), dtype=np.float32)
    for i, (kind, score, cx, cy, w, h) in enumerate(candidates):
        out[:4, i] = (cx, cy, w, h)
        out[4 + kind, i] = score
    return out


def test_decode_persons_keeps_only_confident_person_boxes() -> None:
    output = fake_output(
        [
            (0, 0.9, 0.5, 0.5, 0.2, 0.4),  # 사람
            (0, 0.1, 0.5, 0.5, 0.2, 0.4),  # 점수 컷 아래
            (2, 0.9, 0.3, 0.5, 0.2, 0.4),  # 사람이 아닌 클래스
        ]
    )

    persons = decode_persons(output, Letterbox(640, 640, 640), SETTINGS)

    assert len(persons) == 1
    assert persons[0].height == np.float32(0.4)
    assert persons[0].width > 0.19


def test_decode_persons_drops_overlapping_lower_score_box() -> None:
    output = fake_output(
        [
            (0, 0.9, 0.5, 0.5, 0.2, 0.4),
            (0, 0.6, 0.5, 0.51, 0.2, 0.4),
        ]
    )

    persons = decode_persons(output, Letterbox(640, 640, 640), SETTINGS)

    assert [round(p.score, 1) for p in persons] == [0.9]


def test_clipped_checks_use_image_edges() -> None:
    assert clipped_vertically(Box(0.4, 0.0, 0.2, 0.9, 0.9), 0.02)
    assert clipped_vertically(Box(0.4, 0.2, 0.2, 0.8, 0.9), 0.02)
    assert not clipped_vertically(Box(0.4, 0.2, 0.2, 0.5, 0.9), 0.02)
    assert clipped_sideways(Box(0.0, 0.2, 0.2, 0.5, 0.9), 0.02)


def test_fit_k_uses_median_per_sector_and_recovers_distances() -> None:
    # 12시 칸에서 거리 × 높이가 1.25 로 일정한 박스 세 장과, 튀는 한 장
    measurements = [
        measurement(d, Box(0.45, 0.2, 0.1, 1.25 / d, 0.9)) for d in (2.0, 3.0, 4.0)
    ] + [measurement(5.0, Box(0.45, 0.2, 0.1, 1.25 / 5.0 * 1.3, 0.9))]

    ks = fit_k(measurements, SETTINGS)

    assert ks[2].height_k is not None
    assert abs(ks[2].height_k - 1.25) < 0.01
    assert ks[2].height_samples == 4
    assert ks[0].height_k is None  # 사진이 없는 칸
    box = Box(0.45, 0.2, 0.1, 0.5, 0.9)
    assert abs(estimate_distance(box, ks, SETTINGS) - 2.5) < 0.05


def test_fit_k_splits_vertically_clipped_photos_into_width_k() -> None:
    near = measurement(1.0, Box(0.12, 0.0, 0.36, 1.0, 0.9))  # 위아래 잘림
    sideways = measurement(
        1.0, Box(0.0, 0.0, 0.42, 1.0, 0.9), expected=0
    )  # 좌우도 잘림
    far = measurement(3.0, Box(0.45, 0.3, 0.1, 0.42, 0.9))

    ks = fit_k([near, sideways, far], SETTINGS)

    assert ks[1].width_k is not None
    assert abs(ks[1].width_k - 0.36) < 1e-6
    assert ks[0].width_k is None  # 좌우로 잘린 사진은 폭 K 에 쓰지 않는다
    assert ks[2].height_k is not None


def test_estimate_distance_is_none_without_k() -> None:
    ks = fit_k([], SETTINGS)

    assert estimate_distance(Box(0.45, 0.2, 0.1, 0.5, 0.9), ks, SETTINGS) is None


def test_error_pct() -> None:
    assert error_pct(None, 3.0) is None
    assert round(error_pct(3.3, 3.0), 1) == 10.0


def test_height_k_is_interpolated_between_sector_centers() -> None:
    none = SectorK(None, None, 0, 0)
    ks = [SectorK(1.4, None, 3, 0), none, SectorK(1.2, None, 3, 0), none, none]

    assert height_k_at(0.1, ks) == 1.4  # 칸 가운데
    assert abs(height_k_at(0.3, ks) - 1.3) < 1e-9  # K 없는 칸은 건너뛰고 잇는다
    assert height_k_at(0.9, ks) == 1.2  # 끝 밖은 끝 값
    assert height_k_at(0.5, [none] * 5) is None
