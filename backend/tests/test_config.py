import pytest
from pydantic import ValidationError

from app.config import PROCESSED_DIR, Settings


def test_data_paths_default_to_processed_dir() -> None:
    settings = Settings(_env_file=None)

    assert settings.dem_path == PROCESSED_DIR / "seoul_dem_5m.tif"
    assert settings.sensors_path == PROCESSED_DIR / "sdot_sensors.json"


def test_data_paths_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEM_PATH", "custom/dem.tif")

    assert Settings(_env_file=None).dem_path.as_posix() == "custom/dem.tif"


@pytest.mark.parametrize("speed", ["0", "-1"])
def test_walking_speed_must_be_positive(
    monkeypatch: pytest.MonkeyPatch, speed: str
) -> None:
    # 걷는 시간·도착 시각을 이 값으로 나누므로 0 이하면 서버를 켤 때 막는다.
    monkeypatch.setenv("WALKING_SPEED_MPS", speed)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
