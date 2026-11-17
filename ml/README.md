# ml

YOLO26n 인파 탐지 파인튜닝·LiteRT(`.tflite`) 변환과 LightGBM 혼잡 예측 코드를 둔다.

- 학습 데이터와 가중치(`*.pt`, 변환 중간 파일 `*.onnx`, 배포용 `*.tflite`)는 커밋하지 않는다.
- 배포용 `.tflite`는 Android 앱 assets(`frontend/android/app/src/main/assets/models/`)에 넣어 앱과 함께 배포한다. 앱 빌드 전에 이 폴더로 복사한다.
- 학습 영상은 공개 허용 데이터나 동의받은 촬영분만 쓰고, 얼굴 등은 비식별 처리한다.

## 유동인구 예측 (`foot_traffic/`)

배리어프리 `ml/foot_traffic`을 그대로 가져왔다. 서비스 모델은 다시 학습하지 않고 배리어프리에서 학습한 것을 쓴다.

```bash
cd ml
uv sync
uv run python -m foot_traffic.storage download --dest <폴더>   # 이력·날씨·달력·모델 받기
uv run python -m foot_traffic.daily                           # 오늘·내일·모레 예측 → 수집 DB
uv run pytest
```

- 이력·날씨·달력·모델 파일은 Neon Object storage 버킷(`config.yaml`의 `storage`)에 둔다. 접속 정보는 `ml/.env`(`.env.example` 참고)와 저장소 Secrets에 넣는다.
- 매일 배치는 `.github/workflows/forecast-daily.yml`이 S-DoT 수집 뒤에 돌린다.
- 달력(`interim/calendar/daily.parquet`)은 2026년 12월까지 있다. 그 뒤를 예측하려면 배리어프리 12단계로 달력을 늘려 다시 올린다.
