"""pipeline 단계 공통: 설정 읽기, 데이터 경로, 거리.

배리어프리 pipeline/steps/common.py 에서 13·16 단계가 쓰는 부분만 가져왔다.
데이터 경로는 pipeline/.env 의 DATA_DIR 기준이고, 없으면 저장소의 data/ 를 쓴다.
매일 예측 워크플로(forecast-daily.yml)는 Storage 에서 받은 폴더를 DATA_DIR 로 둔다.
"""

import os
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from dotenv import load_dotenv

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
CONFIG_PATH = PIPELINE_DIR / "config.yaml"
ENV_PATH = PIPELINE_DIR / ".env"
EARTH_RADIUS_M = 6_371_000

load_dotenv(ENV_PATH)


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def data_dir() -> Path:
    """데이터 폴더. DATA_DIR 이 비어 있으면 저장소의 data/."""
    value = os.environ.get("DATA_DIR", "").strip().strip('"')
    return Path(value).expanduser() if value else REPO_ROOT / "data"


def data_path(relative: str) -> Path:
    """config.yaml 의 데이터 경로(interim/…) → 실제 경로."""
    return data_dir() / relative


def repo_path(relative: str) -> Path:
    """config.yaml 의 저장소 경로(data/processed/…) → 실제 경로."""
    return REPO_ROOT / relative


def require_files(*paths: Path) -> None:
    """입력 파일이 없으면 원인과 할 일을 알려 주고 멈춘다."""
    missing = [path for path in paths if not path.exists()]
    if not missing:
        return
    lines = "\n".join(f"  - {path}" for path in missing)
    raise SystemExit(
        f"필요한 파일이 없습니다.\n{lines}\n"
        f"데이터 폴더: {data_dir()}\n"
        "- pipeline/.env 의 DATA_DIR 이 맞는지 확인하세요.\n"
        "- 이력·날씨·달력은 ml/ 에서 "
        "`uv run python -m foot_traffic.storage download --dest <폴더>` 로 받는다."
    )


def distance_m(lon1, lat1, lon2, lat2):
    """두 점(경도, 위도) 사이 대권 거리(m). numpy 배열을 넣으면 배열로 돌려준다."""
    lon1, lat1, lon2, lat2 = (np.radians(v) for v in (lon1, lat1, lon2, lat2))
    a = (
        np.sin((lat2 - lat1) / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))
