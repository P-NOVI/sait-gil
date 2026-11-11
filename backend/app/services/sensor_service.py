"""S-DoT 센서 위치 파일을 읽고, 센서별 유동인구를 혼잡도로 바꾼다."""

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

from core.congestion import Sensor, congestion_level
from core.geo import LngLat


@lru_cache
def load_sensor_positions(path: Path) -> dict[int, LngLat]:
    """pipeline/ 이 만든 sdot_sensors.json({"sensors": [{code, lon, lat}]})을 읽는다."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        int(sensor["code"]): (float(sensor["lon"]), float(sensor["lat"]))
        for sensor in data["sensors"]
    }


def sensors_with_levels(
    positions: Mapping[int, LngLat], counts: Mapping[int, float], full_count: float
) -> list[Sensor]:
    """센서 코드별 10분 유동인구(실시간 또는 예측)를 혼잡도로 바꾼다.

    위치를 모르는 센서는 뺀다.
    """
    return [
        Sensor(positions[code], congestion_level(count, full_count))
        for code, count in counts.items()
        if code in positions
    ]
