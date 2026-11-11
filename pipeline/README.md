# pipeline

백엔드가 읽는 데이터를 만들어 `data/processed/`에 둔다. 원본·가공 데이터(`data/`)는 커밋하지 않는다.

| 만들 데이터 | 파일 | 쓰는 곳 |
| --- | --- | --- |
| DEM (5m 고도 격자) | `data/processed/seoul_dem_5m.tif` | 후보 경로 경사 점수 (`DEM_PATH`) |
| S-DoT 센서 위치 | `data/processed/sdot_sensors.json` | 경로 위 혼잡도 매칭 (`SENSORS_PATH`) |
| 인구·날씨 학습 데이터 | `data/processed/` 아래 | `ml/` 혼잡 예측 |

- DEM은 배리어프리 `pipeline/steps/00_build_dem.py`(1:5000 등고선·표고점 → GeoTIFF) 방식을 가져온다.
- 만든 실수 DEM은 `compress_dem.py`로 cm 정수 GeoTIFF로 바꿔 둔다(46.0MB → 18.2MB, 고도 차이 약 0.005m). 백엔드는 실수·cm 정수 DEM을 모두 읽는다.

  ```bash
  cd backend
  uv run python ../pipeline/compress_dem.py <실수 DEM> ../data/processed/seoul_dem_5m.tif
  ```
