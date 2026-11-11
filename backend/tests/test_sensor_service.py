import json
from pathlib import Path

from app.services.sensor_service import load_sensor_positions, sensors_with_levels
from core.congestion import Sensor


def test_load_sensor_positions(tmp_path: Path) -> None:
    path = tmp_path / "sdot_sensors.json"
    sensors = [{"code": 2992, "lon": 126.833076, "lat": 37.532463, "address": "주소"}]
    path.write_text(json.dumps({"sensors": sensors}), encoding="utf-8")

    assert load_sensor_positions(path) == {2992: (126.833076, 37.532463)}


def test_sensors_with_levels_skips_unknown_codes() -> None:
    positions = {1: (127.0, 37.5)}

    sensors = sensors_with_levels(positions, {1: 150, 2: 300}, full_count=300)

    assert sensors == [Sensor((127.0, 37.5), 0.5)]
