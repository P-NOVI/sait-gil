import pytest

from app.config import PROCESSED_DIR, Settings


def test_data_paths_default_to_processed_dir() -> None:
    settings = Settings(_env_file=None)

    assert settings.dem_path == PROCESSED_DIR / "seoul_dem_5m.tif"
    assert settings.sensors_path == PROCESSED_DIR / "sdot_sensors.json"


def test_data_paths_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEM_PATH", "custom/dem.tif")

    assert Settings(_env_file=None).dem_path.as_posix() == "custom/dem.tif"
