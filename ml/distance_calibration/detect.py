"""앱이 쓰는 LiteRT 모델로 사진에서 사람 박스를 뽑는다.

전처리는 앱(LiteRtDetector)과 같다. 사진을 레터박스로 640×640 에 넣고(여백 회색)
0~1 로 나눈 (1, 3, 640, 640) float32 를 넣는다.
출력은 (1, 4 + 클래스 수, 후보 수) 다.
"""

from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

from distance_calibration.geometry import Box, Letterbox, decode_persons


def load_interpreter(model_path: Path) -> Any:
    """모델을 읽는다. 무거운 라이브러리라 쓸 때 가져온다."""
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    return interpreter


def read_image(path: Path) -> Image.Image:
    """사진을 세운 화면 기준으로 읽는다. 휴대폰 사진의 회전 정보를 적용한다."""
    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).convert("RGB")


def prepare_input(image: Image.Image, settings: dict[str, Any]) -> np.ndarray:
    """레터박스로 정사각형에 맞춘 (1, 3, 입력, 입력) float32."""
    size = settings["input_size"]
    box = Letterbox(image.width, image.height, size)
    resized = image.resize(
        (round(image.width * box.scale), round(image.height * box.scale)),
        Image.Resampling.BILINEAR,
    )
    gray = settings["pad_gray"]
    canvas = Image.new("RGB", (size, size), (gray, gray, gray))
    canvas.paste(resized, (round(box.pad_x), round(box.pad_y)))
    pixels = np.asarray(canvas, dtype=np.float32) / 255.0
    return pixels.transpose(2, 0, 1)[np.newaxis]


def person_boxes(
    interpreter: Any, image: Image.Image, settings: dict[str, Any]
) -> list[Box]:
    """사진 한 장에서 사람 박스를 점수 높은 순으로 돌려준다."""
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    interpreter.set_tensor(input_detail["index"], prepare_input(image, settings))
    interpreter.invoke()
    output = interpreter.get_tensor(output_detail["index"])[0]
    letterbox = Letterbox(image.width, image.height, settings["input_size"])
    persons = decode_persons(output, letterbox, settings)
    return sorted(persons, key=lambda box: box.score, reverse=True)
